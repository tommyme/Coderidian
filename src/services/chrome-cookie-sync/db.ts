import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { join } from 'path';

const execAsync = promisify(exec);

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

export async function readChromeCookies(): Promise<RawCookieRow[]> {
    const dbPath = join(
        homedir(),
        'Library/Application Support/Google/Chrome/Default/Cookies'
    );
    const query =
        'SELECT name, host_key, path, hex(encrypted_value) as encrypted_hex, ' +
        'value, expires_utc, is_secure, is_httponly, samesite FROM cookies';

    let output: string;
    try {
        const result = await execAsync(`sqlite3 -json "${dbPath}" '${query}'`, {
            timeout: 10000,
            maxBuffer: 20 * 1024 * 1024, // 20 MB — Chrome can have thousands of cookies
        });
        output = result.stdout;
    } catch (e: unknown) {
        const msg = (e as { message?: string })?.message ?? '';
        if (msg.includes('unable to open') || msg.includes('no such file')) {
            throw new Error('Chrome Cookies database not found — is Chrome installed at the default location?');
        }
        throw new CookieDbLockedError();
    }

    try {
        return JSON.parse(output || '[]') as RawCookieRow[];
    } catch {
        throw new CookieDbLockedError();
    }
}
