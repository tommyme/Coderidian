import { Plugin, TFile, TAbstractFile, Notice } from 'obsidian';
import { EmbeddingConfigItem, NoteChunk, SimilarNote } from './types';
import { createEmbeddingProvider, EmbeddingProvider, LocalEmbeddingProvider } from './embed-provider';
import { findTopK } from './similarity-engine';
import { loadStore, DebouncedStorage } from './storage';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const CHUNK_MAX = 500;     // 每个 chunk 最大字符数（中文 ~500 token，英文 ~125 token，安全边界）
const CHUNK_OVERLAP = 50;  // 相邻 chunk 之间的重叠字符数，避免边界语义断裂
const CHUNK_MIN = 80;      // 过短的 chunk 无意义，直接跳过

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 笔记内容 FNV-1a 32-bit hash：检测变化，避免重复 embed */
function hashContent(content: string): string {
	let h = 2166136261;
	for (let i = 0; i < content.length; i++) {
		h ^= content.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16);
}

/** 去掉 frontmatter、代码块、行内代码、图片嵌入，返回纯文本 */
function cleanText(content: string): string {
	let text = content.replace(/^---[\s\S]*?---\n?/, '');
	text = text.replace(/```[\s\S]*?```/g, '');
	text = text.replace(/`[^`]+`/g, '');
	text = text.replace(/!\[\[.*?\]\]/g, '');
	return text.trim();
}

/**
 * 将笔记纯文本按 Markdown 结构拆分成若干 chunk。
 *
 * 策略（三级降级）：
 *   Level 1：按 H1/H2/H3 标题行切 section，标题保留在 section 开头
 *   Level 2：section 过长 → 按段落（双换行）贪心合并，超出则 flush + overlap
 *   Level 3：单段落仍过长 → 按字符强切，保留 overlap
 */
export function chunkText(text: string): { text: string; heading?: string }[] {
	// ── Level 1: 按标题切 section ──────────────────────────────────────────
	const lines = text.split('\n');
	const sections: { content: string; heading?: string }[] = [];
	let current: string[] = [];

	for (const line of lines) {
		if (/^#{1,3} /.test(line) && current.length > 0) {
			const s = current.join('\n').trim();
			if (s) sections.push({ content: s, heading: s.match(/^#{1,3} (.+)/m)?.[1]?.trim() });
			current = [line];
		} else {
			current.push(line);
		}
	}
	if (current.length > 0) {
		const s = current.join('\n').trim();
		if (s) sections.push({ content: s, heading: s.match(/^#{1,3} (.+)/m)?.[1]?.trim() });
	}

	// ── Level 2 & 3: 每个 section 按段落 / 字符进一步切分 ──────────────────
	const chunks: { text: string; heading?: string }[] = [];

	for (const { content: section, heading } of sections) {
		if (!section) continue;

		if (section.length <= CHUNK_MAX) {
			if (section.length >= CHUNK_MIN) chunks.push({ text: section, heading });
			continue;
		}

		// 按段落（双换行）切
		const paras = section.split(/\n\n+/).filter((p) => p.trim());
		let buf = '';

		for (const para of paras) {
			const separator = buf ? '\n\n' : '';

			if (buf.length + separator.length + para.length <= CHUNK_MAX) {
				buf += separator + para;
			} else {
				// flush 当前 buf
				if (buf.length >= CHUNK_MIN) chunks.push({ text: buf, heading });

				// 下一个 buf 以 overlap 开头
				const overlap = buf.slice(-CHUNK_OVERLAP);
				buf = overlap ? overlap + '\n\n' + para : para;

				// Level 3：单段落（含 overlap）仍超长 → 字符强切
				while (buf.length > CHUNK_MAX) {
					const slice = buf.slice(0, CHUNK_MAX);
					if (slice.length >= CHUNK_MIN) chunks.push({ text: slice, heading });
					buf = buf.slice(CHUNK_MAX - CHUNK_OVERLAP);
				}
			}
		}
		if (buf.length >= CHUNK_MIN) chunks.push({ text: buf, heading });
	}

	// 保底：如果什么都没切出来（如整篇笔记很短），直接取全文，不受 CHUNK_MIN 限制
	if (chunks.length === 0 && text.length > 0) {
		chunks.push({ text: text.slice(0, CHUNK_MAX) });
	}

	return chunks;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export type IndexProgressCallback = (current: number, total: number) => void;

export class NoteSimilarityService {
	private storage!: DebouncedStorage;
	private provider!: EmbeddingProvider;
	private isReady = false;
	private isIndexing = false;
	private isLoading = false; // 正在从磁盘恢复已有索引（短暂，100–800ms）
	private aborted = false;   // destroy() 后设为 true，让后台循环提前退出

	// 外部订阅，用于更新侧边栏 UI
	onProgressChange?: IndexProgressCallback;
	onReadyChange?: (ready: boolean) => void;

	private activeProgressNotice: Notice | null = null;
	private vaultEventRefs: ReturnType<typeof this.plugin.app.vault.on>[] = [];

	constructor(private plugin: Plugin) {}

	/**
	 * 初始化：立即返回（不阻塞 onload），后台异步加载磁盘索引再建索引。
	 * 期间 isLoading=true，UI 显示 "Loading saved index…"。
	 */
	initialize(config: EmbeddingConfigItem, excludeFolders: string[]): void {
		this.provider = createEmbeddingProvider(config);

		// 本地模型：监听下载进度，通过 Notice 告知用户
		if (this.provider instanceof LocalEmbeddingProvider) {
			let loadingNotice: Notice | null = null;
			let noticeShown = false;
			let isDownloading = false;
			this.provider.onModelDownload = (event) => {
				if (event.status === 'download' && !isDownloading) {
					// 真正从网络下载（首次使用）
					isDownloading = true;
					loadingNotice?.hide();
					loadingNotice = new Notice(`⬇️ 正在下载本地模型 ${config.name}，首次使用需要一段时间…`, 0);
					noticeShown = true;
				} else if (event.status === 'initiate' && !noticeShown) {
					// 从 IndexedDB 缓存加载
					noticeShown = true;
					loadingNotice = new Notice(`⏳ 正在从缓存加载模型 ${config.name}…`, 0);
				} else if (event.status === 'ready') {
					loadingNotice?.hide();
					new Notice(`✅ 模型 ${config.name} 加载完成`, 3000);
				}
			};
		}

		// 立即创建空 storage（modelId 用于确定写入哪个文件），使 vault 事件可以立即注册
		this.storage = new DebouncedStorage(this.plugin, { modelId: config.model, notes: {} });

		// 立即注册 vault 事件，不丢失 initialize 期间发生的文件变更
		this._registerVaultEvents();

		// 后台异步：读磁盘 → 合并到 storage → 建索引
		this._loadAndIndex(config, excludeFolders);
	}

	private _registerVaultEvents(): void {
		this.vaultEventRefs = [
			this.plugin.app.vault.on('delete', (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === 'md') {
					delete this.storage.getStore().notes[file.path];
					this.storage.markDirty();
				}
			}),
			this.plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile && file.extension === 'md') {
					const s = this.storage.getStore();
					if (s.notes[oldPath]) {
						s.notes[file.path] = s.notes[oldPath];
						delete s.notes[oldPath];
						this.storage.markDirty();
					}
				}
			}),
		];
	}

	private async _loadAndIndex(config: EmbeddingConfigItem, excludeFolders: string[]): Promise<void> {
		this.isLoading = true;
		this.onReadyChange?.(false); // 通知 UI 刷新状态

		const stored = await loadStore(this.plugin, config.model);

		// 直接合并：每个模型独立文件，无需检查 modelId 是否匹配
		this.storage.getStore().notes = stored.notes;

		this.isLoading = false;
		this.onReadyChange?.(false); // 触发 UI 再次刷新（从 "Loading…" 过渡到 "Indexing…" 或 "N indexed"）

		if (this.aborted) return;
		await this.buildIndexInBackground(excludeFolders);
	}

	private async buildIndexInBackground(excludeFolders: string[]): Promise<void> {
		const allFiles = this.plugin.app.vault.getMarkdownFiles().filter((f) => {
			return !excludeFolders.some((folder) => f.path.startsWith(folder));
		});

		const store = this.storage.getStore();
		const toEmbed: TFile[] = [];

		for (const file of allFiles) {
			const existing = store.notes[file.path];
			if (!existing) {
				toEmbed.push(file);
				continue;
			}
			// chunks 字段不存在 → 旧格式（升级前的数据），需重新 embed
			if (!existing.chunks) {
				toEmbed.push(file);
				continue;
			}
			// chunks 为空数组 → 哨兵记录（该文件无有效内容），只在 mtime 变化时重试
			if (existing.chunks.length > 0 && existing.chunks.some((c) => !c.vec?.length || typeof c.vec[0] !== 'number')) {
				toEmbed.push(file);
				continue;
			}
			// 只读 stat，不读内容，快速判断是否需要更新
			const stat = await this.plugin.app.vault.adapter.stat(file.path);
			if (stat && stat.mtime > existing.updatedAt) {
				console.log(`[NoteSimilarity] toEmbed reason=mtime_changed path=${file.path} mtime=${stat.mtime} updatedAt=${existing.updatedAt} diff=${stat.mtime - existing.updatedAt}ms`);
				toEmbed.push(file);
			}
		}

		if (toEmbed.length === 0) {
			this.setReady(true);
			const allNotes = Object.values(store.notes);
			const skipped = allNotes.filter((n) => n.chunks.length === 0).length;
			const indexed = allNotes.length - skipped;
			new Notice(
				`✅ 索引已是最新\n共 ${allFiles.length} 篇笔记\n已处理 ${indexed} 篇，过滤 ${skipped} 篇（无内容或内容过少）`,
				4000,
			);
			return;
		}

		this.isIndexing = true;
		const totalFiles = allFiles.length;
		const alreadyDone = totalFiles - toEmbed.length;
		let done = alreadyDone;
		this.onProgressChange?.(done, totalFiles);

		this.activeProgressNotice = new Notice('', 0);
		const noticeEl1 = (this.activeProgressNotice as unknown as { noticeEl: HTMLElement }).noticeEl;
		const labelEl = noticeEl1.createDiv({
			text: `正在建立笔记索引 (${done}/${totalFiles})…`,
			cls: 'coderidian-progress-label',
		});
		const progressBar = noticeEl1.createEl('progress');
		progressBar.max = totalFiles;
		progressBar.value = done;
		progressBar.style.width = '100%';

		const batchSize = this.provider.batchSize;
		let failed = false;
		for (let i = 0; i < toEmbed.length; i += batchSize) {
			if (this.aborted) break;
			const batch = toEmbed.slice(i, i + batchSize);
			try {
				await this.embedFileBatch(batch);
			} catch (e) {
				console.error(`[NoteSimilarity] Batch embed failed:`, e);
				this.activeProgressNotice?.hide();
				this.activeProgressNotice = null;
				new Notice(`❌ 索引中断：${e instanceof Error ? e.message : String(e)}`, 6000);
				failed = true;
				break;
			}
			done += batch.length;
			progressBar.value = done;
			labelEl.textContent = `正在建立笔记索引 (${done}/${totalFiles})…`;
			this.onProgressChange?.(done, totalFiles);
			if (this.provider.batchDelayMs > 0) await sleep(this.provider.batchDelayMs);
		}

		this.activeProgressNotice?.hide();
		this.activeProgressNotice = null;
		this.isIndexing = false;
		if (this.aborted || failed) {
			// 保存已完成的部分进度，下次切回该模型时可从断点续跑
			await this.storage.flush();
			return;
		}
		const allNotes = Object.values(store.notes);
		const skipped = allNotes.filter((n) => n.chunks.length === 0).length;
		const indexed = allNotes.length - skipped;
		new Notice(
			`✅ 索引完成\n共 ${totalFiles} 篇笔记\n已处理 ${indexed} 篇，过滤 ${skipped} 篇（无内容或内容过少）`,
			6000,
		);
		this.setReady(true);
		await this.storage.flush();
	}

	/**
	 * 批量 embed 一组文件。
	 * 每个文件先 chunkText，所有 chunk 汇总成一个大 batch 一次调用 embedBatch，
	 * 再按文件归并回 chunks 数组存储。
	 */
	private async embedFileBatch(files: TFile[]): Promise<void> {
		// 收集需要重新 embed 的文件及其 chunks
		const fileItems: Array<{
			file: TFile;
			hash: string;
			chunks: Array<{ text: string; preview: string; heading?: string }>;
		}> = [];

		for (const file of files) {
			const content = await this.plugin.app.vault.cachedRead(file);
			const hash = hashContent(content);
			const existing = this.storage.getStore().notes[file.path];
			if (existing && existing.hash === hash) continue;

			const raw = cleanText(content);
			if (!raw) {
				this.storage.getStore().notes[file.path] = { chunks: [], hash, updatedAt: Date.now() };
				continue;
			}

			const chunkItems = chunkText(raw);
			if (chunkItems.length === 0) {
				this.storage.getStore().notes[file.path] = { chunks: [], hash, updatedAt: Date.now() };
				continue;
			}

			fileItems.push({
				file,
				hash,
				chunks: chunkItems.map((c) => ({ text: c.text, preview: c.text.slice(0, 80), heading: c.heading })),
			});
		}

		if (fileItems.length === 0) return;

		// 把所有文件的所有 chunk 打平成一个大 batch
		// 每个 chunk 前缀加文件标题，帮助模型理解上下文语义
		// chunk 按需截短，保证总长度不超过 CHUNK_MAX
		const allTexts: string[] = [];
		for (const item of fileItems) {
			const title = item.file.basename;
			const prefix = `${title}\n\n`;
			const maxBody = CHUNK_MAX - prefix.length;
			for (const chunk of item.chunks) {
				allTexts.push(prefix + chunk.text.slice(0, maxBody));
			}
		}

		const allVecs = await this.provider.embedBatch(allTexts);

		// 按文件归并向量
		const now = Date.now();
		const store = this.storage.getStore();
		let vecIdx = 0;
		for (const item of fileItems) {
			const noteChunks: NoteChunk[] = item.chunks.map((chunk) => ({
				vec: allVecs[vecIdx++],
				preview: chunk.preview,
				heading: chunk.heading,
			}));
			store.notes[item.file.path] = {
				chunks: noteChunks,
				hash: item.hash,
				updatedAt: now,
			};
		}
		// 标记有新数据，让 abort/complete 时的 flush() 知道需要写盘
		this.storage.setDirty();
	}

	/** 单文件 embed：检查哈希，有变化才重新 embed，完成后防抖写盘。
	 * 供外部（view 的 open/leave 触发）调用，幂等，可安全并发。
	 */
	async embedFileIfChanged(file: TFile): Promise<void> {
		await this.embedFileBatch([file]);
		this.storage.markDirty();
	}

	private setReady(ready: boolean): void {
		this.isReady = ready;
		this.onReadyChange?.(ready);
	}

	/** 查找与指定文件最相似的笔记 */
	async findSimilar(file: TFile, limit = 10): Promise<SimilarNote[]> {
		if (!this.isReady) return [];
		const store = this.storage.getStore();
		const entry = store.notes[file.path];
		if (!entry?.chunks?.length) {
			// 尝试现场 embed
			try {
				await this.embedFileIfChanged(file);
			} catch {
				return [];
			}
		}
		const queryVecs = this.storage.getStore().notes[file.path]?.chunks?.map((c) => c.vec) ?? [];
		if (queryVecs.length === 0) return [];
		// 让出主线程，避免阻塞 UI（findTopK 是同步计算，推迟到浏览器渲染之后执行）
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		return findTopK(store, queryVecs, limit, file.path);
	}

	/** 手动触发全量重建（会清空已有向量） */
	async reindexAll(
		excludeFolders: string[],
		onProgress?: IndexProgressCallback,
	): Promise<void> {
		if (this.aborted) return;
		const store = this.storage.getStore();
		store.notes = {};
		this.storage.markDirty();
		this.isIndexing = true;
		this.setReady(false);

		const allFiles = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((f) => !excludeFolders.some((folder) => f.path.startsWith(folder)));

		let done = 0;
		const total = allFiles.length;
		onProgress?.(0, total);
		this.onProgressChange?.(0, total);

		this.activeProgressNotice = new Notice('', 0);
		const noticeEl2 = (this.activeProgressNotice as unknown as { noticeEl: HTMLElement }).noticeEl;
		const labelEl = noticeEl2.createDiv({
			text: `重建索引中 (0/${total})…`,
			cls: 'coderidian-progress-label',
		});
		const progressBar = noticeEl2.createEl('progress');
		progressBar.max = total;
		progressBar.value = 0;
		progressBar.style.width = '100%';

		const batchSize = this.provider.batchSize;
		let failed = false;
		for (let i = 0; i < allFiles.length; i += batchSize) {
			if (this.aborted) break;
			const batch = allFiles.slice(i, i + batchSize);
			try {
				await this.embedFileBatch(batch);
			} catch (e) {
				console.error(`[NoteSimilarity] Batch embed failed:`, e);
				this.activeProgressNotice?.hide();
				this.activeProgressNotice = null;
				new Notice(`❌ 重建中断：${e instanceof Error ? e.message : String(e)}`, 6000);
				failed = true;
				break;
			}
			done += batch.length;
			progressBar.value = done;
			labelEl.textContent = `重建索引中 (${done}/${total})…`;
			onProgress?.(done, total);
			this.onProgressChange?.(done, total);
			if (this.provider.batchDelayMs > 0) await sleep(this.provider.batchDelayMs);
		}

		this.activeProgressNotice?.hide();
		this.activeProgressNotice = null;
		if (this.aborted || failed) {
			await this.storage.flush();
			return;
		}
		new Notice(`✅ 索引重建完成，共 ${total} 篇笔记`, 4000);
		this.setReady(true);
		await this.storage.flush();
	}


	/** 测试命令：对当前文件做一次 embed，返回向量维度、chunk 数和耗时 */
	async testEmbedCurrentFile(): Promise<{
		textPreview: string;
		dims: number;
		chunks: number;
		durationMs: number;
	}> {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) throw new Error('没有打开的文件');

		const content = await this.plugin.app.vault.cachedRead(activeFile);
		const raw = cleanText(content);
		if (!raw) throw new Error('无法从文件中提取文本内容');

		const chunkItems = chunkText(raw);
		const chunkTexts = chunkItems.map((c) => c.text);
		const t0 = Date.now();
		const vecs = await this.provider.embedBatch(chunkTexts);
		const durationMs = Date.now() - t0;

		return {
			textPreview: chunkTexts[0]?.slice(0, 100) ?? '',
			dims: vecs[0]?.length ?? 0,
			chunks: chunkTexts.length,
			durationMs,
		};
	}

	/** 调试用：返回完整的 embedding store（含所有向量） */
	getStore(): import('./types').EmbeddingStore {
		return this.storage?.getStore() ?? { modelId: '', notes: {} };
	}

	getIndexStatus(): { indexed: number; isReady: boolean; isIndexing: boolean; isLoading: boolean } {
		return {
			indexed: Object.keys(this.storage?.getStore().notes ?? {}).length,
			isReady: this.isReady,
			isIndexing: this.isIndexing,
			isLoading: this.isLoading,
		};
	}

	async destroy(): Promise<void> {
		this.aborted = true;
		for (const ref of this.vaultEventRefs) {
			this.plugin.app.vault.offref(ref);
		}
		this.vaultEventRefs = [];
		this.activeProgressNotice?.hide();
		this.activeProgressNotice = null;
		this.provider?.destroy?.();
		// 强制写盘：把内存里已有的数据保存下来。
		// 不能只依赖后台循环的 setDirty()，因为 loadStore() 在后台循环
		// 调用 flush() 之前就已经执行了，会读到旧数据。
		this.storage?.setDirty();
		await this.storage?.flush();
	}

	/** 插件卸载时调用，清理所有本地模型 iframe */
	static destroyAllProviders(): void {
		LocalEmbeddingProvider.destroyAll();
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
