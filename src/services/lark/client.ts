/* eslint-disable @typescript-eslint/no-explicit-any */
import { CliRunner } from '../cli/runner';
import { LarkDoc } from './types';

const LARK_COMMAND = 'lark-cli drive +search --mine --doc-types docx';
const DOC_TIMEOUT_MS = 60_000;

function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

export class LarkCliClient {
	constructor(private runner: CliRunner) {}

	async fetchDocs(): Promise<LarkDoc[]> {
		const stdout = await this.runner.run(LARK_COMMAND);
		const raw = JSON.parse(stdout);
		return LarkCliClient.normalize(raw);
	}

	async createDoc(title: string, vaultPath: string, wikiSpace?: string): Promise<string> {
		let cmd = `lark-cli docs +create --title ${shellQuote(title)} --markdown ${shellQuote('.')}`;
		if (wikiSpace) cmd += ` --wiki-space ${shellQuote(wikiSpace)}`;
		cmd += ' 2>/dev/null';
		const stdout = await this.runner.run(cmd, DOC_TIMEOUT_MS, vaultPath);
		return LarkCliClient.parseCreateOutput(stdout);
	}

	// 3-step: upload XML (v2) → set title (v1, clears body) → re-upload XML (v2)
	async updateDoc(docUrl: string, newTitle: string, xmlContent: string, vaultPath: string): Promise<void> {
		await this.uploadXml(docUrl, xmlContent, vaultPath);
		await this.runner.run(
			`lark-cli docs +update --doc ${shellQuote(docUrl)} --mode overwrite --markdown ${shellQuote('.')} --new-title ${shellQuote(newTitle)} 2>/dev/null`,
			DOC_TIMEOUT_MS,
			vaultPath,
		);
		await this.uploadXml(docUrl, xmlContent, vaultPath);
	}

	private async uploadXml(docUrl: string, xmlContent: string, vaultPath: string): Promise<void> {
		const cmd = [
			'NODE_OPTIONS=""',
			'lark-cli docs +update',
			'--api-version v2',
			`--doc ${shellQuote(docUrl)}`,
			'--command overwrite',
			'--doc-format xml',
			`--content ${shellQuote(xmlContent)}`,
			'2>/dev/null',
		].join(' ');
		await this.runner.run(cmd, DOC_TIMEOUT_MS, vaultPath);
	}

	// relFilePath: relative to vaultPath; lark-cli +media-insert uses the doc URL directly
	async insertMedia(docUrl: string, relFilePath: string, vaultPath: string): Promise<string> {
		const cmd = [
			'NODE_OPTIONS=""',
			'lark-cli docs +media-insert',
			`--doc ${shellQuote(docUrl)}`,
			`--file ${shellQuote(relFilePath)}`,
			'2>/dev/null',
		].join(' ');
		const stdout = await this.runner.run(cmd, 30_000, vaultPath);
		const json = JSON.parse(stdout.trim());
		const token = json?.data?.file_token;
		if (!token) throw new Error(`media-insert returned no file_token: ${stdout.slice(0, 200)}`);
		return token;
	}

	async checkDocExists(docUrl: string, vaultPath: string): Promise<boolean> {
		const token = /\/wiki\/([A-Za-z0-9]+)/.exec(docUrl)?.[1];
		if (!token) return true; // 非 wiki URL，无法判断，按存在处理
		const data = JSON.stringify({ request_docs: [{ doc_token: token, doc_type: 'wiki' }] });
		const stdout = await this.runner.run(
			`lark-cli api POST /open-apis/drive/v1/metas/batch_query --data ${shellQuote(data)} 2>/dev/null`,
			10_000,
			vaultPath,
		);
		try {
			const json = JSON.parse(stdout.trim());
			return Array.isArray(json?.data?.metas) && json.data.metas.length > 0;
		} catch {
			return true; // 解析失败，保守按存在处理
		}
	}

	async fetchDocTitles(urls: string[], vaultPath: string): Promise<Map<string, string>> {
		const entries = urls
			.map(url => ({ url, token: /\/wiki\/([A-Za-z0-9]+)/.exec(url)?.[1] }))
			.filter((e): e is { url: string; token: string } => !!e.token);

		const result = new Map<string, string>();
		if (entries.length === 0) return result;

		const data = JSON.stringify({
			request_docs: entries.map(e => ({ doc_token: e.token, doc_type: 'wiki' })),
		});

		try {
			const stdout = await this.runner.run(
				`lark-cli api POST /open-apis/drive/v1/metas/batch_query --data ${shellQuote(data)} 2>/dev/null`,
				10_000,
				vaultPath,
			);
			const json = JSON.parse(stdout.trim());
			for (const meta of json?.data?.metas ?? []) {
				// doc_token in response is the resolved docx token, not the original wiki token.
				// The original request token is preserved in request_doc_info.doc_token.
				const requestToken = meta.request_doc_info?.doc_token ?? meta.doc_token;
				const entry = entries.find(e => e.token === requestToken);
				if (entry && meta.title) result.set(entry.url, meta.title);
			}
		} catch {}

		return result;
	}

	private static parseCreateOutput(stdout: string): string {
		stdout = stdout.trim();
		try {
			const json = JSON.parse(stdout);
			const url = json?.url ?? json?.data?.doc_url ?? json?.data?.url ?? json?.data?.node?.url;
			if (url) return url;
			const token =
				json?.token ??
				json?.data?.token ??
				json?.data?.node?.obj_token ??
				json?.data?.node?.node_token;
			if (token) return token;
		} catch {}
		return stdout;
	}

	// Accepts:
	//   [{title, url}, ...]                 — simple custom format
	//   lark-cli native {data:{results:[]}} — title_highlighted + result_meta.url
	private static normalize(raw: any): LarkDoc[] {
		if (raw && typeof raw === 'object' && Array.isArray(raw.data?.results)) {
			return raw.data.results
				.map((r: any) => ({
					title: r.title_highlighted || r.result_meta?.title || r.result_meta?.token || '(untitled)',
					url: r.result_meta?.url ?? '',
				}))
				.filter((d: LarkDoc) => d.url);
		}
		if (Array.isArray(raw)) {
			return raw.filter(
				(d): d is LarkDoc => d && typeof d.title === 'string' && typeof d.url === 'string',
			);
		}
		throw new Error('Unrecognized CLI output format — expected [{title, url}] or lark-cli JSON');
	}
}
