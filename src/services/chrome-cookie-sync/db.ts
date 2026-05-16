import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { copyFileSync, unlinkSync, existsSync } from 'fs';

const execAsync = promisify(exec);

export interface RawCookieRow {
    name: string;
    host_key: string;
    path: string;
    encrypted_hex: string; // hex(encrypted_value), empty string when not encrypted
    value: string;         // plaintext value for legacy unencrypted cookies
    expires_utc: number;   // microseconds since 1601-01-01; 0 = session cookie
    is_secure: number;
    is_httponly: number;
    samesite: number;      // -1=unspecified, 0=None, 1=Lax, 2=Strict
}

export class CookieDbLockedError extends Error {
    constructor() {
        super('Chrome cookie database is locked — Chrome may be writing. Please retry.');
    }
}

const CHROME_DB = join(
    homedir(),
    'Library/Application Support/Google/Chrome/Default/Cookies',
);

const QUERY =
    'SELECT name, host_key, path, hex(encrypted_value) as encrypted_hex, ' +
    'value, expires_utc, is_secure, is_httponly, samesite FROM cookies';

export async function readChromeCookies(): Promise<RawCookieRow[]> {
    if (!existsSync(CHROME_DB)) {
        throw new Error(
            'Chrome Cookies database not found — is Chrome installed at the default location?',
        );
    }

    // Copy DB + WAL + SHM to a temp path before reading.
    // Chrome uses WAL mode, so copying all three files gives a consistent
    // snapshot and avoids SQLite "database is locked" errors while Chrome runs.
    const tmpDb = join(tmpdir(), `coderidian-chrome-cookies-${Date.now()}.db`);
    try {
        copyFileSync(CHROME_DB, tmpDb);
        for (const ext of ['-wal', '-shm']) {
            const src = CHROME_DB + ext;
            if (existsSync(src)) copyFileSync(src, tmpDb + ext);
        }

        let output: string;
        try {
            const result = await execAsync(`sqlite3 -json "${tmpDb}" '${QUERY}'`, {
                timeout: 10_000,
                maxBuffer: 20 * 1024 * 1024,
            });
            output = result.stdout;
        } catch {
            throw new CookieDbLockedError();
        }

        try {
            return JSON.parse(output || '[]') as RawCookieRow[];
        } catch {
            throw new CookieDbLockedError();
        }
    } finally {
        for (const ext of ['', '-wal', '-shm']) {
            try { unlinkSync(tmpDb + ext); } catch { /* ignore */ }
        }
    }
}
