// src/services/chrome-cookie-sync/index.ts
import { App, Notice } from 'obsidian';
import { getChromeKeychainPassword, KeychainAccessDeniedError } from './keychain';
import { deriveKey } from './decrypt';
import { readChromeCookies, CookieDbLockedError } from './db';
import { injectCookies } from './injector';

export { getCookiesForUrl } from './injector';

export async function importChromeCookies(app: App): Promise<void> {
    if (process.platform !== 'darwin') {
        new Notice('Chrome cookie sync is only supported on macOS');
        return;
    }

    // persist:vault-<appId> — the partition used by Obsidian's built-in WebViewer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webviewPartition = (app as any).getWebviewPartition?.() as string | undefined;

    const progress = new Notice('Importing Chrome cookies…', 0);

    try {
        const password = await getChromeKeychainPassword();
        const key = deriveKey(password);
        const rows = await readChromeCookies();
        const { success, failed, successDomains, failedDomains, sessionLabels } =
            await injectCookies(rows, key, webviewPartition);
        progress.hide();
        new Notice(
            `Chrome cookies imported: ${success} succeeded${failed > 0 ? `, ${failed} failed` : ''}`
        );
        if (sessionLabels.length > 0) {
            console.log('[coderidian] cookie injection targets:', sessionLabels);
        } else {
            console.warn('[coderidian] cookie injection: no Electron session available — cookies in memory only');
        }
        console.log('[coderidian] cookie import — success domains:', successDomains);
        if (failedDomains.length > 0) {
            console.warn('[coderidian] cookie import — failed domains:', failedDomains);
        }
    } catch (err) {
        progress.hide();
        if (err instanceof CookieDbLockedError) {
            new Notice('Chrome is writing cookies — please retry in a moment');
        } else if (err instanceof KeychainAccessDeniedError) {
            new Notice('Keychain access denied — allow Obsidian in System Settings > Privacy & Security');
        } else {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`Cookie import failed: ${msg}`);
            console.error('[coderidian] chrome-cookie-sync error:', err);
        }
    }
}
