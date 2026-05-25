import { App, TFile, requestUrl } from 'obsidian';
import * as nodePath from 'path';
import * as fs from 'fs';
import { LarkCliClient } from './client';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

const RE_OB_IMAGE = /!\[\[([^\]|]+\.(png|jpg|jpeg|gif|webp|bmp|svg))(\|[^\]]*)?\]\]/gi;
const RE_OB_EXCALIDRAW = /!\[\[([^\]|]+\.excalidraw)(\|[^\]]*)?\]\]/gi;
const RE_EXT_IMAGE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const RE_FRONTMATTER = /^---\n[\s\S]*?\n---\n*/;

interface PendingItem {
	original: string;
	relPath: string;  // relative to vaultPath, for lark-cli --file
	absPath: string;  // absolute, for size reading and cleanup
	isTmp: boolean;
	userWidth?: number;  // explicit width from ![[img|500]]
}

interface UploadedItem {
	original: string;
	token: string;
	width?: number;
	height?: number;
	userWidth?: number;
}

export async function preprocessMarkdownForLark(
	content: string,
	docUrl: string,
	app: App,
	vaultPath: string,
	client: LarkCliClient,
	onProgress?: (msg: string) => void,
): Promise<string> {
	const tmpRelDir = `.coderidian-lark-tmp-${Date.now()}`;
	const tmpAbsDir = nodePath.join(vaultPath, tmpRelDir);
	fs.mkdirSync(tmpAbsDir, { recursive: true });

	const pending: PendingItem[] = [];
	const seen = new Set<string>();

	const enqueue = (item: PendingItem) => {
		if (seen.has(item.original)) return;
		seen.add(item.original);
		pending.push(item);
	};

	try {
		// Obsidian image attachments: ![[filename.ext]] or ![[filename.ext|500]]
		for (const m of content.matchAll(RE_OB_IMAGE)) {
			const resolved = resolveVaultFile(m[1], app, vaultPath);
			if (!resolved) continue;
			const userWidth = m[3] ? (parseInt(m[3].replace(/\D/g, '')) || undefined) : undefined;
			enqueue({ original: m[0], ...resolved, isTmp: false, userWidth });
		}

		// Excalidraw embeds: ![[xxx.excalidraw]]
		for (const m of content.matchAll(RE_OB_EXCALIDRAW)) {
			const result = await exportExcalidraw(m[1], app, vaultPath, tmpRelDir, tmpAbsDir);
			if (result) enqueue({ original: m[0], ...result, isTmp: true });
		}

		// External image URLs: ![alt](https://...)
		for (const m of content.matchAll(RE_EXT_IMAGE)) {
			const result = await downloadImage(m[2], vaultPath, tmpRelDir, tmpAbsDir);
			if (result) enqueue({ original: m[0], ...result, isTmp: true });
		}

		// Upload each image, read dimensions
		const uploaded: UploadedItem[] = [];
		for (const item of pending) {
			onProgress?.(`上传图片: ${nodePath.basename(item.absPath)}`);
			try {
				const token = await client.insertMedia(docUrl, item.relPath, vaultPath);
				const size = readImageSize(item.absPath);
				console.log(`[lark-preprocess] uploaded ${item.relPath} → token: ${token}, size: ${size?.width}x${size?.height}`);
				uploaded.push({ original: item.original, token, width: size?.width, height: size?.height, userWidth: item.userWidth });
			} catch (e) {
				console.warn('[lark-preprocess] upload failed:', item.relPath, e);
			}
		}

		const xml = convertMarkdownToXml(content, uploaded);
		console.log('[lark-preprocess] XML:\n' + xml);
		return xml;
	} finally {
		for (const item of pending) {
			if (item.isTmp) try { fs.unlinkSync(item.absPath); } catch {}
		}
		try { fs.rmdirSync(tmpAbsDir); } catch {}
	}
}

function readImageSize(absPath: string): { width: number; height: number } | null {
	try {
		const ext = absPath.split('.').pop()?.toLowerCase();
		if (ext === 'png') return readPngSize(absPath);
		if (ext === 'jpg' || ext === 'jpeg') return readJpegSize(absPath);
	} catch {}
	return null;
}

function readPngSize(absPath: string): { width: number; height: number } | null {
	const buf = Buffer.allocUnsafe(24);
	const fd = fs.openSync(absPath, 'r');
	const n = fs.readSync(fd, buf, 0, 24, 0);
	fs.closeSync(fd);
	if (n < 24) return null;
	if (buf[0] !== 0x89 || buf.slice(1, 4).toString() !== 'PNG') return null;
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readJpegSize(absPath: string): { width: number; height: number } | null {
	// Read first 64KB — SOF marker is near the start for typical images
	const fd = fs.openSync(absPath, 'r');
	try {
		const buf = Buffer.allocUnsafe(65536);
		const n = fs.readSync(fd, buf, 0, 65536, 0);
		let pos = 2; // skip SOI (FF D8)
		while (pos < n - 8) {
			if (buf[pos] !== 0xFF) break;
			const marker = buf.readUInt16BE(pos);
			const segLen = buf.readUInt16BE(pos + 2);
			if (marker === 0xFFC0 || marker === 0xFFC2) {
				// SOF: marker(2) + len(2) + precision(1) + height(2) + width(2)
				return { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7) };
			}
			pos += 2 + segLen;
		}
	} finally {
		fs.closeSync(fd);
	}
	return null;
}

function convertMarkdownToXml(content: string, uploaded: UploadedItem[]): string {
	const imageMap = new Map<string, UploadedItem>(uploaded.map(u => [u.original, u]));
	content = content.replace(RE_FRONTMATTER, '');

	const parts: string[] = [];
	const lines = content.split('\n');
	let i = 0;

	while (i < lines.length) {
		const stripped = lines[i].trim();

		// Code block: collect until closing fence, emit <pre lang="..."><code>...</code></pre>
		const fenceMatch = stripped.match(/^```(\w*)/);
		if (fenceMatch) {
			const raw = fenceMatch[1];
			const lang = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'PlainText';
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].trim().startsWith('```')) {
				codeLines.push(lines[i]);
				i++;
			}
			const body = codeLines.join('<br/>') + (codeLines.length ? '<br/>' : '');
			parts.push(`<pre lang="${lang}"><code>${body}</code></pre>`);
			i++; // skip closing ```
			continue;
		}

		if (!stripped) { i++; continue; }

		// Image line (exact match against uploaded originals)
		const imgItem = imageMap.get(stripped);
		if (imgItem) { parts.push(imgTag(imgItem)); i++; continue; }

		// Heading
		const hm = stripped.match(/^(#{1,6})\s+(.*)/);
		if (hm) { parts.push(`<h${hm[1].length}>${hm[2].trim()}</h${hm[1].length}>`); i++; continue; }

		// Horizontal rule
		if (/^-{3,}$/.test(stripped)) { parts.push('<hr/>'); i++; continue; }

		parts.push(`<p>${stripped}</p>`);
		i++;
	}

	return parts.join('');
}

function imgTag({ token, width, height, userWidth }: UploadedItem): string {
	let w = userWidth ?? width;
	let h = height;
	if (userWidth && width && height) {
		h = Math.round(height * userWidth / width);
		w = userWidth;
	}
	const sizeAttr = w && h ? ` width="${w}" height="${h}"` : '';
	return `<img src="${token}" mime="image/png"${sizeAttr}/>`;
}

function resolveVaultFile(filename: string, app: App, vaultPath: string): { relPath: string; absPath: string } | null {
	const byPath = app.vault.getAbstractFileByPath(filename);
	if (byPath instanceof TFile) {
		return { relPath: byPath.path, absPath: nodePath.join(vaultPath, byPath.path) };
	}
	const byName = app.vault.getFiles().find(f => f.name === filename);
	if (byName) {
		return { relPath: byName.path, absPath: nodePath.join(vaultPath, byName.path) };
	}
	return null;
}

async function exportExcalidraw(
	filename: string,
	app: App,
	vaultPath: string,
	tmpRelDir: string,
	tmpAbsDir: string,
): Promise<{ relPath: string; absPath: string } | null> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const plugin = (app as any).plugins?.plugins?.['obsidian-excalidraw-plugin'];
		if (!plugin) { console.warn('[lark-preprocess] excalidraw plugin not found'); return null; }
		const file = app.metadataCache.getFirstLinkpathDest(filename, '') ?? app.vault.getFiles().find(f => f.name === filename || f.name === filename + '.md' || f.path === filename);
		if (!(file instanceof TFile)) { console.warn('[lark-preprocess] excalidraw file not found:', filename); return null; }
		const ea = plugin.ea;
		if (!ea) return null;
		if (!ea.createPNG) { console.warn('[lark-preprocess] excalidraw no createPNG'); return null; }
		ea.reset();
		const blob: Blob | undefined = await ea.createPNG(file.path);
		if (!blob) return null;
		const fname = `${file.basename}-${Date.now()}.png`;
		const relPath = `${tmpRelDir}/${fname}`;
		const absPath = nodePath.join(tmpAbsDir, fname);
		fs.writeFileSync(absPath, Buffer.from(await blob.arrayBuffer()));
		return { relPath, absPath };
	} catch (e) {
		console.warn('[lark-preprocess] excalidraw export failed:', filename, e);
		return null;
	}
}

async function downloadImage(
	url: string,
	vaultPath: string,
	tmpRelDir: string,
	tmpAbsDir: string,
): Promise<{ relPath: string; absPath: string } | null> {
	try {
		const resp = await requestUrl({ url, method: 'GET' });
		if (resp.status !== 200) return null;
		const ct = (resp.headers['content-type'] ?? '') as string;
		let ext = 'png';
		if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg';
		else if (ct.includes('gif')) ext = 'gif';
		else if (ct.includes('svg')) ext = 'svg';
		else if (ct.includes('webp')) ext = 'webp';
		else {
			const urlExt = url.split('.').pop()?.split('?')[0]?.toLowerCase();
			if (urlExt && IMAGE_EXTS.has(urlExt)) ext = urlExt;
		}
		const fname = `dl-${Date.now()}.${ext}`;
		const relPath = `${tmpRelDir}/${fname}`;
		const absPath = nodePath.join(tmpAbsDir, fname);
		fs.writeFileSync(absPath, Buffer.from(resp.arrayBuffer));
		return { relPath, absPath };
	} catch (e) {
		console.warn('[lark-preprocess] download failed:', url, e);
		return null;
	}
}
