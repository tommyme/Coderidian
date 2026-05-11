import { App, TFile } from 'obsidian';
import { GraphData, GraphEdge, GraphNode } from './types';

export class LocalGraphService {
	constructor(private app: App) {}

	async buildGraph(currentFile: TFile, depth: number): Promise<GraphData> {
		const nodes = new Map<string, GraphNode>();
		const edgeMap = new Map<string, 'forward' | 'bidirectional'>();

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
				const dest = this.app.metadataCache.getFirstLinkpathDest(link.link.split('#')[0], item.path);
				if (!dest) continue;
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
