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
