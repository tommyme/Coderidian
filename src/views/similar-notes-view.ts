import { ItemView, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { NoteSimilarityService } from '../services/note-similarity/note-similarity-service';
import { SimilarNote } from '../services/note-similarity/types';

export const SIMILAR_NOTES_VIEW_TYPE = 'coderidian-similar-notes';

export class SimilarNotesView extends ItemView {
	private service: NoteSimilarityService | null = null;
	private limit: number;
	private excludeFolders: string[];
	private statusEl!: HTMLElement;
	private listEl!: HTMLElement;
	private currentNoteEl!: HTMLElement;
	private indexedCount = 0;
	private totalCount = 0;
	/** Track last active markdown file to avoid losing context when panel is clicked */
	private lastFile: TFile | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		service: NoteSimilarityService | null,
		limit: number,
		excludeFolders: string[] = [],
	) {
		super(leaf);
		this.service = service;
		this.limit = limit;
		this.excludeFolders = excludeFolders;
	}

	getViewType(): string {
		return SIMILAR_NOTES_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Related Notes';
	}

	getIcon(): string {
		return 'links-coming-in';
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass('coderidian-similar-notes-root');

		// 标题栏
		const header = root.createDiv('coderidian-sn-header');
		header.createSpan({ text: 'Related Notes', cls: 'coderidian-sn-title' });
		const refreshBtn = header.createEl('button', { cls: 'coderidian-sn-btn', attr: { title: 'Refresh', 'aria-label': 'Refresh' } });
		refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
		refreshBtn.addEventListener('click', () => this.refresh());

		// 当前笔记提示
		this.currentNoteEl = root.createDiv('coderidian-sn-current-note');

		// 状态栏
		this.statusEl = root.createDiv('coderidian-sn-status');
		this.renderStatus();

		// 笔记列表
		this.listEl = root.createDiv('coderidian-sn-list');

		// 底部操作
		const footer = root.createDiv('coderidian-sn-footer');
		const reindexBtn = footer.createEl('button', {
			cls: 'coderidian-sn-reindex-btn',
			text: 'Reindex All',
		});
		reindexBtn.addEventListener('click', () => this.handleReindex());

		// 监听 service 状态变化
		this.wireService(this.service);

		// 监听当前活动文件变化
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				const view = leaf?.view;
				if (view instanceof MarkdownView && view.file) {
					const prevFile = this.lastFile;
					const newFile = view.file;

					// 切离时：后台静默 embed 上一篇（fire-and-forget，不影响当前操作）
					if (prevFile && prevFile !== newFile && this.service) {
						this.service.embedFileIfChanged(prevFile).catch(() => {});
					}

					this.lastFile = newFile;

					// 先用缓存立即刷新，再后台确保当前文件向量最新，完成后再刷新一次
					this.refresh();
					if (this.service) {
						this.service.embedFileIfChanged(newFile)
							.then(() => this.refresh())
							.catch(() => {});
					}
				}
				// 切到非 MarkdownView（如本面板）时保留 lastFile
			}),
		);

		// Seed lastFile from currently active MarkdownView，并确保其向量是最新的
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file) {
			this.lastFile = activeView.file;
			if (this.service) {
				this.service.embedFileIfChanged(activeView.file)
					.then(() => this.refresh())
					.catch(() => {});
			}
		}

		await this.refresh();
	}

	async onClose(): Promise<void> {
		if (this.service) {
			this.service.onProgressChange = undefined;
			this.service.onReadyChange = undefined;
		}
	}

	private wireService(service: NoteSimilarityService | null): void {
		if (!service) return;
		service.onProgressChange = (current, total) => {
			this.indexedCount = current;
			this.totalCount = total;
			this.renderStatus();
		};
		service.onReadyChange = () => {
			this.renderStatus();
			this.refresh();
		};
	}

	private renderStatus(): void {
		if (!this.statusEl) return;
		if (!this.service) {
			this.statusEl.setText('Not configured');
			return;
		}
		const { isReady, isIndexing, isLoading, indexed } = this.service.getIndexStatus();
		if (isLoading) {
			this.statusEl.setText('Loading…');
		} else if (isIndexing) {
			this.statusEl.setText(`Indexing ${this.indexedCount}/${this.totalCount}…`);
		} else if (!isReady) {
			this.statusEl.setText('Initializing…');
		} else {
			this.statusEl.setText(`${indexed} notes indexed`);
		}
	}

	async refresh(): Promise<void> {
		if (!this.listEl) return;
		this.listEl.empty();

		if (!this.service) {
			this.currentNoteEl.setText('');
			this.showMessage('Note similarity is not configured.\nEnable it in Settings → Note Similarity.');
			return;
		}

		const { isReady, isLoading } = this.service.getIndexStatus();
		if (isLoading) {
			this.showMessage('Loading saved index…');
			return;
		}
		if (!isReady) {
			this.showMessage('Building index, please wait…');
			return;
		}

		const file = this.lastFile;
		if (!file) {
			this.currentNoteEl.setText('');
			this.showMessage('Open a note to see related notes.');
			return;
		}

		// Show current note name
		const noteName = file.basename;
		this.currentNoteEl.empty();
		this.currentNoteEl.createSpan({ cls: 'coderidian-sn-current-label', text: 'Current: ' });
		this.currentNoteEl.createSpan({ cls: 'coderidian-sn-current-name', text: noteName });

		this.showMessage('Loading…');
		const results = await this.service.findSimilar(file, this.limit);
		this.listEl.empty();

		if (results.length === 0) {
			this.showMessage('No related notes found.');
			return;
		}

		this.renderResults(results);
	}

	private showMessage(text: string): void {
		this.listEl.empty();
		this.listEl.createDiv({ cls: 'coderidian-sn-empty', text });
	}

	private renderResults(results: SimilarNote[]): void {
		for (const result of results) {
			const item = this.listEl.createDiv('coderidian-sn-item');

			const parts = result.path.split('/');
			const filename = parts[parts.length - 1].replace(/\.md$/, '');
			const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
			const pct = Math.round(result.score * 100);

			// Title row: score tag · bullet · link
			const titleRow = item.createDiv('coderidian-sn-title-row');
			titleRow.createSpan({ cls: 'coderidian-sn-badge', text: `${pct}%` });
			titleRow.createSpan({ cls: 'coderidian-sn-bullet', text: '·' });
			const link = titleRow.createEl('a', { cls: 'coderidian-sn-link', text: filename });
			link.setAttribute('title', result.path);

			// Path (secondary, only if nested)
			if (folder) {
				item.createDiv({ cls: 'coderidian-sn-path', text: folder });
			}

			// Matched chunk excerpt
			if (result.matchedChunk) {
				item.createDiv({ cls: 'coderidian-sn-excerpt', text: result.matchedChunk });
			}

			item.addEventListener('click', () => {
				const f = this.app.vault.getAbstractFileByPath(result.path);
				if (f instanceof TFile) {
					this.app.workspace.getLeaf('tab').openFile(f);
				}
			});
		}
	}

	private async handleReindex(): Promise<void> {
		if (!this.service) return;
		await this.service.reindexAll(this.excludeFolders, (current, total) => {
			this.indexedCount = current;
			this.totalCount = total;
			this.renderStatus();
		});
	}

	/** 外部调用，更新 service 引用（settings 变更时）*/
	updateService(service: NoteSimilarityService | null, limit: number, excludeFolders?: string[]): void {
		// Unwire old service
		if (this.service && this.service !== service) {
			this.service.onProgressChange = undefined;
			this.service.onReadyChange = undefined;
		}
		this.service = service;
		this.limit = limit;
		if (excludeFolders) this.excludeFolders = excludeFolders;
		this.wireService(service);
		this.renderStatus();
		this.refresh();
	}
}
