# Chrome Cookie Sync — Design Spec

**Date:** 2026-05-10  
**Platform:** macOS only  
**Scope:** All Chrome cookies → Obsidian Electron session

---

## Goal

Provide an Obsidian command that imports all Chrome session cookies into Obsidian's Electron session, so Surfing plugin webviews (and any other webview using `session.defaultSession`) can access sites without re-logging in.

---

## Architecture

New module: `src/services/chrome-cookie-sync/`

Registered as a single Obsidian command in `src/commands.ts`. No settings UI needed.

---

## Data Flow

```
Command triggered
  → keychain.ts   — shell: security find-generic-password → raw password string
  → decrypt.ts    — PBKDF2-SHA1(password, "saltysalt", 1003, 16) → AES key
  → db.ts         — shell: sqlite3 CLI reads Chrome Cookies DB → row array
  → decrypt.ts    — AES-128-CBC decrypt each encrypted_value (skip "v10" prefix, strip PKCS7 padding)
  → injector.ts   — session.defaultSession.cookies.set() per cookie
  → Notice        — "X cookies imported" or error message
```

---

## Components

### `keychain.ts`
- Runs: `security find-generic-password -wa "Chrome" -s "Chrome Safe Storage"`
- Returns the password string (trimmed)
- Throws a typed error if the command exits non-zero (user denied Keychain access)

### `decrypt.ts`
- `deriveKey(password: string): Buffer`
  - PBKDF2-SHA1, salt=`"saltysalt"`, iterations=1003, keylen=16
  - Uses Node.js built-in `crypto.pbkdf2Sync`
- `decryptValue(encryptedValue: Buffer, key: Buffer): string`
  - Input must start with `v10` prefix — strip first 3 bytes
  - AES-128-CBC, IV = 16 space characters (`0x20`)
  - Strip PKCS7 padding from result
  - Returns plaintext string; throws on malformed input
- Plaintext (non-`v10`) cookie values pass through unchanged

### `db.ts`
- Chrome Cookies path: `~/Library/Application Support/Google/Chrome/Default/Cookies`
- Runs `sqlite3 -json <path> "SELECT ..."` (macOS built-in sqlite3)
- Selected columns: `name`, `host_key`, `path`, `encrypted_value`, `value`, `expires_utc`, `is_secure`, `is_httponly`, `samesite`
- If sqlite3 exits non-zero → throw `CookieDbLockedError` (user sees retry prompt)
- Returns raw row array with `encrypted_value` as hex string (sqlite3 JSON output)

### `injector.ts`
- Converts each DB row to Electron `Cookies.Details`:
  - `url`: reconstruct from `is_secure` + `host_key` + `path`
  - `expirationDate`: convert Chrome's microseconds-since-1601 to Unix timestamp in seconds
  - `sameSite`: map Chrome int (0/1/2) → `"no_restriction"` / `"lax"` / `"strict"`
- Calls `session.defaultSession.cookies.set(details)` per cookie (Promise, awaited)
- Collects success/failure counts; individual failures are skipped (logged to console)
- Returns `{ success: number, failed: number }`

### `index.ts`
- `importChromeCookies()`: orchestrates the four steps above
- Wraps in try/catch; maps known error types to user-facing Notice messages

---

## Error Handling

| Scenario | User-facing message |
|----------|-------------------|
| sqlite3 DB locked | "Chrome is writing cookies, please retry in a moment" |
| Keychain access denied | "Keychain access denied — allow Obsidian in System Settings > Privacy" |
| `security` or `sqlite3` CLI missing | "Required macOS system tool not found" |
| Individual cookie injection failure | Skipped silently; counted in final tally |
| All cookies failed | Notice with failure count + suggestion to check console |

---

## Session Injection Target

- Primary: `session.defaultSession` — covers Surfing and most Obsidian webviews
- Future: if Surfing is found to use a named partition (e.g. `persist:surfing`), add `session.fromPartition(...)` injection in `injector.ts` with no other changes needed

---

## Electron API Access

```typescript
const { session } = require('electron').remote;
// or if Obsidian exposes @electron/remote:
const { session } = require('@electron/remote');
```

Use whichever is available at runtime; wrap in try/catch and fall back.

---

## Constraints

- macOS only — no Windows/Linux handling needed
- No npm packages added — only Node.js built-ins (`crypto`, `child_process`) and macOS system CLIs (`sqlite3`, `security`)
- Chrome profile: Default only (`~/Library/Application Support/Google/Chrome/Default/Cookies`)
- No periodic sync — command is manual, one-shot
