import { Plugin, TFile, WorkspaceLeaf, MarkdownView } from 'obsidian';

/**
 * AI 配套笔记自动打开管理器
 */
export class AiCompanionManager {
	private plugin: Plugin;
	private isOpeningCompanion = false; // 防止递归触发

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.registerEvents();
	}

	private registerEvents(): void {
		// 监听活动叶子变化（文件打开/切换）
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf) {
					this.handleLeafChange(leaf);
				}
			})
		);
	}

	private async handleLeafChange(leaf: WorkspaceLeaf): Promise<void> {
		// 防止递归：打开配套文件时不要再触发
		if (this.isOpeningCompanion) return;

		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;

		const file = view.file;
		if (!file) return;

		// 如果当前打开的就是 .ai 文件，不处理
		if (file.path.endsWith('.ai')) return;

		// 构造配套文件路径
		const companionPath = `${file.path}.ai`;

		// 检查配套文件是否存在
		const companionFile = this.plugin.app.vault.getAbstractFileByPath(companionPath);
		if (!(companionFile instanceof TFile)) return;

		// 检查配套文件是否已经打开
		if (this.isFileAlreadyOpen(companionFile)) return;

		// 打开配套文件
		await this.openCompanionFile(companionFile, leaf);
	}

	/**
	 * 检查文件是否已在某个标签页打开
	 */
	private isFileAlreadyOpen(file: TFile): boolean {
		const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
		return leaves.some(leaf => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				return view.file?.path === file.path;
			}
			return false;
		});
	}

	/**
	 * 在右侧打开配套文件
	 */
	private async openCompanionFile(file: TFile, sourceLeaf: WorkspaceLeaf): Promise<void> {
		this.isOpeningCompanion = true;

		try {
			// 获取或创建右侧分栏
			const rightLeaf = this.plugin.app.workspace.getLeaf('split', 'vertical');

			// 打开文件
			await rightLeaf.openFile(file, { active: false });

			// 保持原文件的焦点
			this.plugin.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });

		} catch (err) {
			console.error('打开 AI 配套笔记失败:', err);
		} finally {
			// 延迟重置标志，确保事件处理完成
			setTimeout(() => {
				this.isOpeningCompanion = false;
			}, 100);
		}
	}

	/**
	 * 手动触发：为当前文件打开/创建配套笔记
	 */
	async openOrCreateCompanion(): Promise<void> {
		const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView?.file) return;

		const file = activeView.file;

		// 如果当前是 .ai 文件，找原文件
		if (file.path.endsWith('.ai')) {
			const originalPath = file.path.slice(0, -3); // 移除 .ai
			const originalFile = this.plugin.app.vault.getAbstractFileByPath(originalPath);
			if (originalFile instanceof TFile) {
				const leaf = this.plugin.app.workspace.getLeaf('split', 'vertical');
				await leaf.openFile(originalFile);
			}
			return;
		}

		// 当前是普通文件，打开或创建 .ai 文件
		const companionPath = `${file.path}.ai`;
		let companionFile = this.plugin.app.vault.getAbstractFileByPath(companionPath);

		if (!(companionFile instanceof TFile)) {
			// 创建配套文件
			const initialContent = `# AI Summary: ${file.basename}\n\n> 原文: [[${file.path}]]\n\n---\n\n`;
			companionFile = await this.plugin.app.vault.create(companionPath, initialContent);
		}

		if (companionFile instanceof TFile) {
			const leaf = this.plugin.app.workspace.getLeaf('split', 'vertical');
			await leaf.openFile(companionFile);
		}
	}

	destroy(): void {
		// 事件会随插件自动清理
	}
}
