import { RawCookieRow } from './db';
import { decryptValue } from './decrypt';

const CHROME_EPOCH_OFFSET_S = 11_644_473_600;

function mapSameSite(v: number): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
    if (v === 0) return 'no_restriction';
    if (v === 1) return 'lax';
    if (v === 2) return 'strict';
    return 'unspecified';
}

function chromeTimeToUnix(t: number): number | undefined {
    if (t === 0) return undefined;
    return Math.floor(t / 1_000_000) - CHROME_EPOCH_OFFSET_S;
}

export interface ImportedCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
    expiresAt?: number; // Unix timestamp seconds
}

// In-memory cookie jar: host_key → cookies.
// Survives for the lifetime of the Obsidian session; cleared on each import.
const cookieJar = new Map<string, ImportedCookie[]>();

/**
 * Returns a `Cookie: …` header value for the given URL, matching domain/path/
 * secure constraints and filtering expired cookies.
 */
export function getCookiesForUrl(url: string): string {
    let u: URL;
    try { u = new URL(url); } catch { return ''; }

    const hostname = u.hostname;
    const now = Date.now() / 1000;
    const matched: ImportedCookie[] = [];

    for (const [domain, cookies] of cookieJar) {
        // .example.com matches example.com and sub.example.com
        const bare = domain.startsWith('.') ? domain.slice(1) : domain;
        if (hostname !== bare && !hostname.endsWith('.' + bare)) continue;

        for (const c of cookies) {
            if (c.expiresAt !== undefined && c.expiresAt < now) continue;
            if (c.secure && u.protocol !== 'https:') continue;
            if (!u.pathname.startsWith(c.path)) continue;
            matched.push(c);
        }
    }

    return matched.map(c => `${c.name}=${c.value}`).join('; ');
}

interface ElectronCookieStore {
    set(details: Record<string, unknown>): Promise<void>;
}

// Obsidian uses @electron/remote which re-exposes require('electron').remote.
// The WebViewer uses partition = app.getWebviewPartition() = 'persist:vault-<appId>'.
// We inject into both defaultSession (for requestUrl) and the webview partition
// (for the built-in WebViewer), matching how Obsidian itself accesses the session.
export function resolveElectronCookieStores(
    webviewPartition?: string,
): { stores: ElectronCookieStore[]; labels: string[] } {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
        const remote = (require('electron') as any).remote;
        if (!remote?.session) return { stores: [], labels: [] };

        const stores: ElectronCookieStore[] = [remote.session.defaultSession.cookies];
        const labels: string[] = ['defaultSession'];

        if (webviewPartition) {
            stores.push(remote.session.fromPartition(webviewPartition).cookies);
            labels.push(webviewPartition);
        }

        return { stores, labels };
    } catch {
        return { stores: [], labels: [] };
    }
}

export interface InjectResult {
    success: number;
    failed: number;
    successDomains: string[];
    failedDomains: string[];
    sessionLabels: string[];  // which Electron sessions were injected into
}

export async function injectCookies(
    rows: RawCookieRow[],
    key: Buffer,
    webviewPartition?: string,
): Promise<InjectResult> {
    cookieJar.clear();

    const { stores: electronStores, labels: sessionLabels } = resolveElectronCookieStores(webviewPartition);

    let success = 0;
    let failed = 0;
    const successDomains = new Set<string>();
    const failedDomains = new Set<string>();

    for (const row of rows) {
        try {
            const value = row.encrypted_hex
                ? decryptValue(row.encrypted_hex, key)
                : row.value;

            const expiresAt = chromeTimeToUnix(row.expires_utc);

            // Always store in the in-memory jar for getCookiesForUrl().
            const bucket = cookieJar.get(row.host_key) ?? [];
            bucket.push({
                name: row.name,
                value,
                domain: row.host_key,
                path: row.path,
                secure: row.is_secure === 1,
                httpOnly: row.is_httponly === 1,
                sameSite: mapSameSite(row.samesite),
                expiresAt,
            });
            cookieJar.set(row.host_key, bucket);

            // Inject into every resolved Electron session.
            if (electronStores.length > 0) {
                const protocol = row.is_secure ? 'https' : 'http';
                const host = row.host_key.startsWith('.') ? row.host_key.slice(1) : row.host_key;
                const details: Record<string, unknown> = {
                    url: `${protocol}://${host}${row.path}`,
                    name: row.name,
                    value,
                    domain: row.host_key, // preserve leading dot for domain-wide cookies
                    path: row.path,
                    secure: row.is_secure === 1,
                    httpOnly: row.is_httponly === 1,
                    sameSite: mapSameSite(row.samesite),
                };
                if (expiresAt !== undefined) details.expirationDate = expiresAt;

                await Promise.all(electronStores.map(s => s.set(details)));
            }

            successDomains.add(row.host_key);
            success++;
        } catch {
            failedDomains.add(row.host_key);
            failed++;
        }
    }

    return {
        success,
        failed,
        successDomains: [...successDomains].sort(),
        failedDomains: [...failedDomains].sort(),
        sessionLabels,
    };
}
