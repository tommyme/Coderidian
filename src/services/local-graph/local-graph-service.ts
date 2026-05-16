import { App, TFile } from 'obsidian';
import { LarkCliClient } from '../lark';
import { GraphData, GraphEdge, GraphNode } from './types';

export class LocalGraphService {
	private titleCache = new Map<string, string>();

	constructor(private app: App, private larkClient?: LarkCliClient) {}

	async buildGraph(currentFile: TFile, depth: number): Promise<GraphData> {
		const nodes = new Map<string, GraphNode>();
		const edgeMap = new Map<string, 'forward' | 'bidirectional'>();
		const feishuLinks: Array<{ url: string; sourcePath: string }> = [];

		const visited = new Set<string>();
		const queue: Array<{ path: string; hops: number }> = [
			{ path: currentFile.path, hops: 0 },
		];

		while (queue.length > 0) {
			const item = queue.shift()!;
			if (visited.has(item.path)) continue;
			visited.add(item.path);

			const file = this.app.vault.getAbstractFileByPath(item.path);
			if (!(file instanceof TFile)) continue;

			if (!nodes.has(item.path)) {
				nodes.set(item.path, {
					id: item.path,
					label: file.basename,
					lineCount: 1,
					isCurrent: item.path === currentFile.path,
				});
			}

			if (item.hops >= depth) continue;

			// Outgoing links
			const cache = this.app.metadataCache.getFileCache(file);
			for (const link of cache?.links ?? []) {
				const rawLink = link.link.split('#')[0];
				if (this.isFeishuUrl(rawLink)) {
					feishuLinks.push({ url: rawLink, sourcePath: item.path });
					continue;
				}
				const dest = this.app.metadataCache.getFirstLinkpathDest(rawLink, item.path);
				if (!dest) {
					if (!nodes.has(rawLink)) {
						nodes.set(rawLink, {
							id: rawLink,
							label: rawLink,
							lineCount: 1,
							isCurrent: false,
							isUnresolved: true,
						});
					}
					this.recordEdge(edgeMap, item.path, rawLink);
					continue;
				}
				this.recordEdge(edgeMap, item.path, dest.path);
				if (!visited.has(dest.path)) {
					queue.push({ path: dest.path, hops: item.hops + 1 });
				}
			}

			// Incoming links — .data may be a Map or a plain object depending on Obsidian version
			const backlinks = this.app.metadataCache.getBacklinksForFile(file);
			const blData = backlinks?.data as any;
			const blPaths: string[] = blData
				? (typeof blData.keys === 'function' ? [...blData.keys()] : Object.keys(blData))
				: [];
			for (const sourcePath of blPaths) {
				this.recordEdge(edgeMap, sourcePath, item.path);
				if (!visited.has(sourcePath)) {
					queue.push({ path: sourcePath, hops: item.hops + 1 });
				}
			}
		}

		// Add Feishu external nodes immediately — use cached title or placeholder
		if (feishuLinks.length > 0 && this.larkClient) {
			for (const { url, sourcePath } of feishuLinks) {
				if (!nodes.has(url)) {
					nodes.set(url, {
						id: url,
						label: this.titleCache.get(url) ?? '飞书文档',
						lineCount: 1,
						isCurrent: false,
						isExternal: true,
						url,
					});
				}
				this.recordEdge(edgeMap, sourcePath, url);
			}
		}

		// Batch resolve line counts concurrently
		await Promise.all(
			Array.from(nodes.values()).map(async (node) => {
				const file = this.app.vault.getAbstractFileByPath(node.id);
				if (file instanceof TFile) {
					try {
						const content = await this.app.vault.cachedRead(file);
						node.lineCount = content.split('\n').length;
					} catch {
						node.lineCount = 1;
					}
				}
			})
		);

		const edges: GraphEdge[] = [];
		for (const [key, type] of edgeMap) {
			const sep = key.indexOf('|||');
			const source = key.slice(0, sep);
			const target = key.slice(sep + 3);
			if (nodes.has(source) && nodes.has(target) && source !== target) {
				edges.push({ source, target, type });
			}
		}

		return { nodes: Array.from(nodes.values()), edges };
	}

	async resolveFeishuTitles(urls: string[]): Promise<Map<string, string>> {
		if (!this.larkClient || urls.length === 0) return new Map();
		const uncached = urls.filter(u => !this.titleCache.has(u));
		if (uncached.length > 0) {
			try {
				const vaultPath = (this.app.vault.adapter as any).basePath as string;
				const fetched = await this.larkClient.fetchDocTitles(uncached, vaultPath);
				for (const [url, title] of fetched) this.titleCache.set(url, title);
			} catch {}
		}
		const result = new Map<string, string>();
		for (const url of urls) {
			const title = this.titleCache.get(url);
			if (title) result.set(url, title);
		}
		return result;
	}

	private isFeishuUrl(s: string): boolean {
		return /^https?:\/\/[^/]*\.(feishu\.cn|larksuite\.com)\//.test(s);
	}

	private recordEdge(
		edgeMap: Map<string, 'forward' | 'bidirectional'>,
		source: string,
		target: string,
	): void {
		const fwdKey = `${source}|||${target}`;
		const revKey = `${target}|||${source}`;
		if (edgeMap.has(fwdKey)) {
			// already recorded, no-op
		} else if (edgeMap.has(revKey)) {
			edgeMap.set(revKey, 'bidirectional');
		} else {
			edgeMap.set(fwdKey, 'forward');
		}
	}
}
