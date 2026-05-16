import { LarkDoc } from './types';

const DB_NAME = 'coderidian';
const STORE_NAME = 'lark-docs';
const DB_VERSION = 1;
export const CACHE_TTL_MS = 24 * 3_600_000;

export interface LarkCacheEntry {
	timestamp: number;
	docs: LarkDoc[];
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function readLarkCache(): Promise<LarkCacheEntry | null> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const req = tx.objectStore(STORE_NAME).get('docs');
		req.onsuccess = () => resolve((req.result as LarkCacheEntry) ?? null);
		req.onerror = () => reject(req.error);
		tx.oncomplete = () => db.close();
	});
}

export async function writeLarkCache(entry: LarkCacheEntry): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		tx.objectStore(STORE_NAME).put(entry, 'docs');
		tx.oncomplete = () => { db.close(); resolve(); };
		tx.onerror = () => reject(tx.error);
	});
}

export function isLarkCacheFresh(entry: LarkCacheEntry): boolean {
	return Date.now() - entry.timestamp < CACHE_TTL_MS;
}
