/* eslint-disable @typescript-eslint/no-explicit-any */
import { CliRunner } from '../cli/runner';
import { LarkDoc } from './types';

const LARK_COMMAND = 'lark-cli drive +search --mine --doc-types docx';

export class LarkCliClient {
	constructor(private runner: CliRunner) {}

	async fetchDocs(): Promise<LarkDoc[]> {
		const stdout = await this.runner.run(LARK_COMMAND);
		const raw = JSON.parse(stdout);
		return LarkCliClient.normalize(raw);
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
