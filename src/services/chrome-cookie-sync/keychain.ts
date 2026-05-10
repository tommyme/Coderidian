import { execSync } from 'child_process';

export function getChromeKeychainPassword(): string {
    const result = execSync(
        'security find-generic-password -w -a "Chrome" -s "Chrome Safe Storage"',
        { encoding: 'utf-8', timeout: 15000 }
    );
    return result.trim();
}
