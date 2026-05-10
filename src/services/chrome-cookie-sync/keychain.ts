import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class KeychainAccessDeniedError extends Error {
    constructor() {
        super('Keychain access denied');
    }
}

export async function getChromeKeychainPassword(): Promise<string> {
    try {
        const { stdout } = await execAsync(
            'security find-generic-password -w -a "Chrome" -s "Chrome Safe Storage"',
            { timeout: 15000 }
        );
        return stdout.trim();
    } catch {
        throw new KeychainAccessDeniedError();
    }
}
