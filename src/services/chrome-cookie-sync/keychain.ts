import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class KeychainAccessDeniedError extends Error {
    constructor() {
        super('Keychain access denied');
    }
}

// Chromium browsers use different service/account names in Keychain.
// We try each variant in order and return the first non-empty password.
const KEYCHAIN_VARIANTS = [
    { account: 'Chrome', service: 'Chrome Safe Storage' },
    { account: 'Chromium', service: 'Chromium Safe Storage' },
    { account: 'Google Chrome', service: 'Google Chrome Safe Storage' },
    { account: 'Google Chrome Beta', service: 'Google Chrome Beta Safe Storage' },
];

export async function getChromeKeychainPassword(): Promise<string> {
    for (const { account, service } of KEYCHAIN_VARIANTS) {
        try {
            const { stdout } = await execAsync(
                `security find-generic-password -w -a "${account}" -s "${service}"`,
                { timeout: 15_000 },
            );
            const pw = stdout.trim();
            if (pw) return pw;
        } catch {
            // Try next variant
        }
    }
    throw new KeychainAccessDeniedError();
}
