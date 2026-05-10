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
	let cookieStore: ElectronSession['cookies'];
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { remote } = require('electron') as {
			remote: { session: { defaultSession: ElectronSession } };
		};
		cookieStore = remote.session.defaultSession.cookies;
	} catch {
		return { success: 0, failed: rows.length };
	}

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
