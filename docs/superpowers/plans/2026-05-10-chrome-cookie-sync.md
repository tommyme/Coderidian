# Chrome Cookie Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Obsidian command that reads all Chrome cookies (macOS), decrypts them, and injects them into Obsidian's Electron session so Surfing plugin webviews work without re-logging in.

**Architecture:** Five focused modules under `src/services/chrome-cookie-sync/` — keychain password retrieval, AES key derivation + decryption, SQLite DB reading via the macOS-bundled `sqlite3` CLI, Electron session injection, and a top-level orchestrator. The orchestrator is wired as an Obsidian command in `commands.ts`.

**Tech Stack:** Node.js built-ins (`crypto`, `child_process`, `os`, `path`), macOS system CLIs (`security`, `sqlite3`), Electron `remote.session` API (same pattern already used in `local-graph-panel.ts`).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/services/chrome-cookie-sync/keychain.ts` | Create | Call `security` CLI → return keychain password string |
| `src/services/chrome-cookie-sync/decrypt.ts` | Create | PBKDF2-SHA1 key derivation + AES-128-CBC decryption |
| `src/services/chrome-cookie-sync/db.ts` | Create | Call `sqlite3` CLI → return raw cookie rows |
| `src/services/chrome-cookie-sync/injector.ts` | Create | Map rows → Electron `cookies.set()` calls |
| `src/services/chrome-cookie-sync/index.ts` | Create | Orchestrate all steps, surface errors as Notices |
| `src/commands.ts` | Modify | Register the `[Browser] Import Chrome Cookies` command |

---

## Task 1: `keychain.ts` — Retrieve Chrome encryption password

**Files:**
- Create: `src/services/chrome-cookie-sync/keychain.ts`

The `security find-generic-password` command retrieves the raw password Chrome uses as input to its PBKDF2 key derivation. On first run, macOS shows a dialog asking the user to allow Obsidian access — this is expected.

- [ ] **Step 1: Create the file**

```typescript
// src/services/chrome-cookie-sync/keychain.ts
import { execSync } from 'child_process';

export function getChromeKeychainPassword(): string {
    const result = execSync(
        'security find-generic-password -w -a "Chrome" -s "Chrome Safe Storage"',
        { encoding: 'utf-8', timeout: 15000 }
    );
    return result.trim();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/chrome-cookie-sync/keychain.ts
git commit -m "feat: chrome-cookie-sync — keychain password retrieval"
```

---

## Task 2: `decrypt.ts` — AES key derivation and decryption

**Files:**
- Create: `src/services/chrome-cookie-sync/decrypt.ts`

Chrome derives a 16-byte AES key via PBKDF2-SHA1 (salt `"saltysalt"`, 1003 iterations). Encrypted cookie values are stored as `v10<ciphertext>`, encrypted with AES-128-CBC using an IV of 16 space characters. After decryption, PKCS7 padding is stripped manually (we disable Node's auto-padding to control the buffer ourselves).

- [ ] **Step 1: Create the file**

```typescript
// src/services/chrome-cookie-sync/decrypt.ts
import { pbkdf2Sync, createDecipheriv } from 'crypto';

const SALT = Buffer.from('saltysalt');
const ITERATIONS = 1003;
const KEY_LENGTH = 16;
const IV = Buffer.alloc(16, 0x20); // 16 space characters
const V10_PREFIX = Buffer.from('v10');

export function deriveKey(password: string): Buffer {
    return pbkdf2Sync(password, SALT, ITERATIONS, KEY_LENGTH, 'sha1');
}

export function decryptValue(encryptedHex: string, key: Buffer): string {
    const encrypted = Buffer.from(encryptedHex, 'hex');

    // Non-v10 prefix means plaintext stored in encrypted_value (rare, legacy)
    if (!encrypted.slice(0, 3).equals(V10_PREFIX)) {
        return encrypted.toString('utf-8');
    }

    const payload = encrypted.slice(3);
    const decipher = createDecipheriv('aes-128-cbc', key, IV);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);

    // Strip PKCS7 padding: last byte is the pad length
    const padLen = decrypted[decrypted.length - 1];
    return decrypted.slice(0, decrypted.length - padLen).toString('utf-8');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/chrome-cookie-sync/decrypt.ts
git commit -m "feat: chrome-cookie-sync — AES-128-CBC decryption + PBKDF2 key derivation"
```

---

## Task 3: `db.ts` — Read Chrome Cookies via sqlite3 CLI

**Files:**
- Create: `src/services/chrome-cookie-sync/db.ts`

The Chrome Cookies file is a SQLite database. We use the macOS-bundled `sqlite3` CLI (always present) with `-json` output mode. `encrypted_value` is a BLOB, so we wrap it in `hex()` to get a hex string safe for JSON. If the file is write-locked by Chrome at the moment of the call, `sqlite3` exits non-zero and we throw `CookieDbLockedError`.

- [ ] **Step 1: Create the file**

```typescript
// src/services/chrome-cookie-sync/db.ts
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

export interface RawCookieRow {
    name: string;
    host_key: string;
    path: string;
    encrypted_hex: string; // hex(encrypted_value), may be empty string
    value: string;         // plaintext value for non-encrypted cookies
    expires_utc: number;   // microseconds since 1601-01-01; 0 = session cookie
    is_secure: number;     // 1 or 0
    is_httponly: number;   // 1 or 0
    samesite: number;      // -1=unspecified, 0=None, 1=Lax, 2=Strict
}

export class CookieDbLockedError extends Error {
    constructor() {
        super('Chrome cookie database is locked — Chrome may be writing. Please retry.');
    }
}

export function readChromeCookies(): RawCookieRow[] {
    const dbPath = join(
        homedir(),
        'Library/Application Support/Google/Chrome/Default/Cookies'
    );
    const query =
        'SELECT name, host_key, path, hex(encrypted_value) as encrypted_hex, ' +
        'value, expires_utc, is_secure, is_httponly, samesite FROM cookies';

    let output: string;
    try {
        output = execSync(`sqlite3 -json "${dbPath}" '${query}'`, {
            encoding: 'utf-8',
            timeout: 10000,
            maxBuffer: 20 * 1024 * 1024, // 20 MB — Chrome can have thousands of cookies
        });
    } catch {
        throw new CookieDbLockedError();
    }

    return JSON.parse(output || '[]') as RawCookieRow[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/chrome-cookie-sync/db.ts
git commit -m "feat: chrome-cookie-sync — SQLite cookie reader via sqlite3 CLI"
```

---

## Task 4: `injector.ts` — Map rows and inject into Electron session

**Files:**
- Create: `src/services/chrome-cookie-sync/injector.ts`

Converts Chrome's raw DB rows into Electron `Cookies.Details` objects and calls `session.defaultSession.cookies.set()` for each. Key conversions needed:
- **Timestamp**: Chrome stores `expires_utc` as microseconds since 1601-01-01 Windows epoch. Electron needs Unix seconds (since 1970-01-01). Offset is 11,644,473,600 seconds. Value `0` = session cookie → omit `expirationDate`.
- **SameSite**: Chrome stores as int (-1/0/1/2) → Electron expects string `"unspecified"/"no_restriction"/"lax"/"strict"`.
- **URL**: Required by Electron; reconstructed from `is_secure` + `host_key` + `path`. Leading dot on `host_key` (e.g. `.example.com`) is stripped for URL construction but the cookie domain is set from the URL.
- **Value**: Use `decryptValue` when `encrypted_hex` is non-empty; fall back to plain `value`.

Individual injection failures are swallowed and counted — one bad cookie shouldn't block the rest.

- [ ] **Step 1: Create the file**

```typescript
// src/services/chrome-cookie-sync/injector.ts
import { RawCookieRow } from './db';
import { decryptValue } from './decrypt';

// Seconds between Windows epoch (1601-01-01) and Unix epoch (1970-01-01)
const CHROME_EPOCH_OFFSET_S = 11_644_473_600;

function mapSameSite(v: number): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
    if (v === 0) return 'no_restriction';
    if (v === 1) return 'lax';
    if (v === 2) return 'strict';
    return 'unspecified';
}

function chromeTimeToUnix(chromeTime: number): number | undefined {
    if (chromeTime === 0) return undefined;
    return Math.floor(chromeTime / 1_000_000) - CHROME_EPOCH_OFFSET_S;
}

interface ElectronCookieDetails {
    url: string;
    name: string;
    value: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
    expirationDate?: number;
}

interface ElectronSession {
    cookies: {
        set(details: ElectronCookieDetails): Promise<void>;
    };
}

export async function injectCookies(
    rows: RawCookieRow[],
    key: Buffer
): Promise<{ success: number; failed: number }> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { remote } = require('electron') as {
        remote: { session: { defaultSession: ElectronSession } };
    };
    const cookieStore = remote.session.defaultSession.cookies;

    let success = 0;
    let failed = 0;

    for (const row of rows) {
        try {
            const value = row.encrypted_hex
                ? decryptValue(row.encrypted_hex, key)
                : row.value;

            const protocol = row.is_secure ? 'https' : 'http';
            const host = row.host_key.startsWith('.') ? row.host_key.slice(1) : row.host_key;
            const url = `${protocol}://${host}${row.path}`;

            const details: ElectronCookieDetails = {
                url,
                name: row.name,
                value,
                path: row.path,
                secure: row.is_secure === 1,
                httpOnly: row.is_httponly === 1,
                sameSite: mapSameSite(row.samesite),
            };

            const expirationDate = chromeTimeToUnix(row.expires_utc);
            if (expirationDate !== undefined) {
                details.expirationDate = expirationDate;
            }

            await cookieStore.set(details);
            success++;
        } catch {
            failed++;
        }
    }

    return { success, failed };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/chrome-cookie-sync/injector.ts
git commit -m "feat: chrome-cookie-sync — Electron session cookie injector"
```

---

## Task 5: `index.ts` — Orchestrator

**Files:**
- Create: `src/services/chrome-cookie-sync/index.ts`

Wires all four modules together and surfaces user-facing Notices. Includes a macOS platform guard (this feature only works on macOS — using `process.platform` avoids an Obsidian API dependency here).

- [ ] **Step 1: Create the file**

```typescript
// src/services/chrome-cookie-sync/index.ts
import { Notice } from 'obsidian';
import { getChromeKeychainPassword } from './keychain';
import { deriveKey } from './decrypt';
import { readChromeCookies, CookieDbLockedError } from './db';
import { injectCookies } from './injector';

export async function importChromeCookies(): Promise<void> {
    if (process.platform !== 'darwin') {
        new Notice('Chrome cookie sync is only supported on macOS');
        return;
    }

    const progress = new Notice('Importing Chrome cookies…', 0);

    try {
        const password = getChromeKeychainPassword();
        const key = deriveKey(password);
        const rows = readChromeCookies();
        const { success, failed } = await injectCookies(rows, key);
        progress.hide();
        new Notice(
            `Chrome cookies imported: ${success} succeeded${failed > 0 ? `, ${failed} failed` : ''}`
        );
    } catch (err) {
        progress.hide();
        if (err instanceof CookieDbLockedError) {
            new Notice('Chrome is writing cookies — please retry in a moment');
        } else {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`Cookie import failed: ${msg}`);
            console.error('[coderidian] chrome-cookie-sync error:', err);
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/chrome-cookie-sync/index.ts
git commit -m "feat: chrome-cookie-sync — orchestrator with user-facing Notices"
```

---

## Task 6: Wire the command in `commands.ts`

**Files:**
- Modify: `src/commands.ts`

- [ ] **Step 1: Add the import at the top of `commands.ts`**

Add after the existing import block (around line 10):

```typescript
import { importChromeCookies } from './services/chrome-cookie-sync';
```

- [ ] **Step 2: Register the command**

Add inside `registerCommands(plugin)`, near the end of the function (before the closing `}`):

```typescript
plugin.addCommand({
    id: 'import-chrome-cookies',
    name: '[Browser] Import Chrome Cookies',
    callback: () => { importChromeCookies(); },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/commands.ts
git commit -m "feat: register Import Chrome Cookies command"
```

---

## Task 7: Build and manual test

**Files:** none

- [ ] **Step 1: Compile and deploy**

```bash
pnpm compile && pnpm test
```

Expected: compiles without TypeScript errors, copies to Obsidian plugin directory, reloads.

- [ ] **Step 2: Run the command in Obsidian**

Open Obsidian command palette → search "Import Chrome Cookies" → run it.

Expected sequence:
1. macOS Keychain dialog appears (first run only) — click "Allow"
2. A "Importing Chrome cookies…" Notice appears
3. After a few seconds (depends on cookie count): "Chrome cookies imported: X succeeded" Notice

- [ ] **Step 3: Verify cookies are active in Surfing**

Open the Surfing plugin and navigate to a site you're logged into in Chrome (e.g. GitHub). You should be logged in without entering credentials.

- [ ] **Step 4: Test the locked-DB error path**

Trigger the command rapidly twice in succession. If Chrome happens to be writing during the second call, you'll see the retry Notice. (This is hard to force-trigger; observing the happy path is sufficient.)
