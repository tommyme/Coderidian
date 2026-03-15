import { MarkdownView, Notice, Plugin, addIcon, Editor } from 'obsidian';
import { MyPluginSettings, DEFAULT_SETTINGS, SampleSettingTab } from './settings';
import { ApiConfigItem, LlmApiManager } from './config/api-config-manager';
import { registerCommands } from './commands';
import { VSCodeService } from './services/vscode';
import { registerCodeBlockProcessors } from './services/code-blocks';
import {
	parseNote,
	LLMApiConfig,
	uploadAllImages,
	analyzeImageWithUploadResult,
	SingleImageRenderer,
	ImageToolbarManager,
	ToolbarButton
} from './ai-image-analysis';
import { createHttpInterceptor, HttpInterceptor } from './interceptors';
import { AiCompanionManager } from './services/ai-note-compare';
import { NoteSimilarityService } from './services/note-similarity/note-similarity-service';
import { SIMILAR_NOTES_VIEW_TYPE, SimilarNotesView } from './views/similar-notes-view';

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	isBoldMode = true;
	vscodeService: VSCodeService;
	private toolbarManager: ImageToolbarManager | null = null;
	private aiCompanionManager: AiCompanionManager | null = null;
	noteSimilarityService: NoteSimilarityService | null = null;

	async onload() {
		await this.loadSettings();
		this.vscodeService = new VSCodeService(this.app, this.settings);
		this.registerExtensions(['ai'], 'markdown');
		this.aiCompanionManager = new AiCompanionManager(this);

		// 初始化全局 LLM API 管理器
		const activeConfig = this.getActiveApiConfig();
		if (activeConfig) {
			LlmApiManager.init(activeConfig);
		}

		// 初始化 HTTP 请求拦截器
		this.setupHttpInterceptor();

		this.setupIcons();
		registerCommands(this);
		registerCodeBlockProcessors(this);

		// 注册 Note Similarity 侧边栏视图
		this.registerView(SIMILAR_NOTES_VIEW_TYPE, (leaf) => {
			return new SimilarNotesView(
				leaf,
				this.noteSimilarityService,
				this.settings.similarNotesLimit,
				this.settings.embeddingExcludeFolders,
			);
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));

		// 创建工具栏管理器
		this.setupImageToolbar();

		// 注册文件菜单事件
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				menu.addItem((item) => {
					item.setTitle('Open in VSCode')
						.setIcon('vscode-logo')
						.onClick(() => this.vscodeService.open(file));
				});
			})
		);

		// 监听活动视图变化
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', async (leaf) => {
				const view = leaf?.view;
				if (view instanceof MarkdownView) {
					await this.toolbarManager?.attachToView(view);
				} else {
					this.toolbarManager?.detach();
				}
			})
		);

		// layout ready 后：vault 已就绪，再初始化 Note Similarity 和工具栏
		this.app.workspace.onLayoutReady(async () => {
			// Note Similarity 必须在 vault ready 后启动，否则 getMarkdownFiles() 返回空列表
			this.initNoteSimilarity();

			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				await this.toolbarManager?.attachToView(activeView);
			}
		});

		// 非关键：注入 Claude Code API 配置（后台异步，不阻塞 onload）
		this._injectClaudeCodeConfig();
	}

	private async _injectClaudeCodeConfig(): Promise<void> {
		const { getClaudeCodeConfig } = await import('./config/claude-code-config');
		const claudeConfig = await getClaudeCodeConfig(this.app);
		if (!claudeConfig) return;
		const exists = this.settings.apiConfigs.some((c) => c.id === 'claude-code');
		if (!exists) {
			this.settings.apiConfigs.push({
				id: 'claude-code',
				name: 'Claude Code',
				requestMethod: 'openai',
				fileUploadMethod: 'requesturl',
				apiKey: claudeConfig.apiKey,
				apiEndpoint: claudeConfig.apiEndpoint,
				fileApiEndpoint: '',
				model: claudeConfig.model,
				isPreset: true,
			});
			if (!this.settings.activeConfigId) {
				this.settings.activeConfigId = 'claude-code';
			}
			await this.saveSettings();
		}
	}

	/**
	 * 设置图片工具栏
	 */
	private setupImageToolbar(): void {
		const buttons: ToolbarButton[] = [
			{
				id: 'analyze',
				icon: '🔍',
				tooltip: '分析此图',
				action: async (imageIndex: number) => {
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (activeView && activeView.editor) {
						await this.handleAnalyzeSingleImage(imageIndex, activeView.editor);
					}
				}
			}
			// 未来可扩展：
			// {
			//   id: 'reupload',
			//   icon: '🔄',
			//   tooltip: '重新上传',
			//   action: ...
			// }
		];

		this.toolbarManager = new ImageToolbarManager(this.app, buttons);
	}

	/**
	 * 获取当前激活的 API 配置
	 */
	public getActiveApiConfig(): LLMApiConfig | null {
		// 从配置中查找
		const activeConfig = this.settings.apiConfigs.find(
			(c: ApiConfigItem) => c.id === this.settings.activeConfigId
		);

		if (!activeConfig) {
			return null;
		}

		return {
			apiKey: activeConfig.apiKey,
			apiEndpoint: activeConfig.apiEndpoint,
			fileApiEndpoint: activeConfig.fileApiEndpoint,
			model: activeConfig.model,
			requestMethod: activeConfig.requestMethod,
			fileUploadMethod: activeConfig.fileUploadMethod
		};
	}

	/**
	 * 处理单图分析
	 */
	private async handleAnalyzeSingleImage(imageIndex: number, editor: Editor): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('请先打开一个笔记');
			return;
		}

		const config = this.getActiveApiConfig();
		if (!config) {
			new Notice('请先在设置中配置 API');
			return;
		}

		const notice = new Notice(`正在分析图片 ${imageIndex + 1}...`, 0);

		try {
			// 1. 解析笔记
			notice.setMessage('正在解析笔记...');
			const parsedNote = await parseNote(this.app, activeFile);

			if (!parsedNote.images[imageIndex]) {
				notice.hide();
				new Notice(`找不到第 ${imageIndex + 1} 张图片`);
				return;
			}

			// 2. 上传图片
			notice.setMessage('正在上传图片...');

			const image = parsedNote.images[imageIndex];
			const results = await uploadAllImages(this.app, [image]);
			if (results.length === 0) {
				notice.hide();
				new Notice(`图片上传失败`);
				return;
			}

			// 3. 分析图片
			notice.setMessage('正在分析图片...');

			const analysis = await analyzeImageWithUploadResult(
				parsedNote,
				imageIndex,
				results[0],
			);

			// 4. 插入结果
			notice.setMessage('正在更新笔记...');

			SingleImageRenderer.insertAnalysis(editor, parsedNote, imageIndex, analysis);

			notice.hide();
			new Notice(`图片 ${imageIndex + 1} 分析完成！`);
		} catch (err) {
			notice.hide();
			console.error('分析图片失败:', err);
			new Notice(`分析失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	onunload() {
		this.toolbarManager?.destroy();
		this.aiCompanionManager?.destroy();
		this.noteSimilarityService?.destroy();
		NoteSimilarityService.destroyAllProviders();
		this.app.workspace.detachLeavesOfType(SIMILAR_NOTES_VIEW_TYPE);
	}

	/**
	 * 初始化 Note Similarity 服务（首次加载）
	 */
	private initNoteSimilarity(): void {
		if (!this.settings.embeddingEnabled) return;

		const config = this.settings.embeddingConfigs.find(
			(c) => c.id === this.settings.activeEmbeddingConfigId,
		);
		if (!config) return;

		this.noteSimilarityService = new NoteSimilarityService(this);
		this.noteSimilarityService.initialize(config, this.settings.embeddingExcludeFolders);
	}

	/**
	 * 重新初始化 Note Similarity 服务（设置变更时调用）
	 */
	async reinitNoteSimilarity(): Promise<void> {
		await this.noteSimilarityService?.destroy();
		this.noteSimilarityService = null;

		// 更新已打开的侧边栏视图
		this.app.workspace.getLeavesOfType(SIMILAR_NOTES_VIEW_TYPE).forEach((leaf) => {
			(leaf.view as SimilarNotesView).updateService(null, this.settings.similarNotesLimit);
		});

		await this.initNoteSimilarity();

		// 把新 service 注入视图
		this.app.workspace.getLeavesOfType(SIMILAR_NOTES_VIEW_TYPE).forEach((leaf) => {
			(leaf.view as SimilarNotesView).updateService(
				this.noteSimilarityService,
				this.settings.similarNotesLimit,
				this.settings.embeddingExcludeFolders,
			);
		});
	}

	/**
	 * 打开 / 聚焦相关笔记侧边栏
	 */
	async openSimilarNotesView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(SIMILAR_NOTES_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: SIMILAR_NOTES_VIEW_TYPE, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	/**
	 * 设置 HTTP 请求拦截器
	 */
	private setupHttpInterceptor(): void {
		// 根据设置决定是否启用拦截器
		if (this.settings.enableHttpLogging) {
			createHttpInterceptor();
			console.log('[Coderidian] HTTP Interceptor enabled');
		} else {
			const interceptor = HttpInterceptor.getInstance();
			interceptor.restore();
			console.log('[Coderidian] HTTP Interceptor disabled');
		}
	}

	/**
	 * 动态更新 HTTP 日志拦截器
	 */
	updateHttpLogging(enable: boolean): void {
		this.settings.enableHttpLogging = enable;
		// 重新设置拦截器
		this.setupHttpInterceptor();
	}

	private setupIcons() {
		const vscodeIconId = "vscode-logo";
		const vscodeIconSvgContent = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>`;
		addIcon(vscodeIconId, vscodeIconSvgContent);

		if (this.settings.ribbonIcon) {
			this.addRibbonIcon(vscodeIconId, 'Open in VSCode', () => {
				this.settings.ribbonMethodCode
					? this.vscodeService.open()
					: this.vscodeService.openViaURL();
			});
		}

		this.addRibbonIcon('dice', 'Quick switcher', () => {
			this.app.commands.executeCommandById('switcher:open');
		}).addClass('my-plugin-ribbon-class');

		this.addRibbonIcon('switch', 'Toggle mode (bold/sidebar)', () => {
			this.toggleSidebarOrBoldMode();
		});
	}

	toggleSidebarOrBoldMode() {
		this.isBoldMode = !this.isBoldMode;
		new Notice(`快捷键模式已切换至: ${this.isBoldMode ? '加粗 (Bold)' : '侧边栏 (Sidebar)'}`);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		// 注入本地 Embedding 预设（首次安装时）
		const LOCAL_PRESETS = [
			{
				id: 'local-bge-micro-v2',
				name: 'BGE-micro-v2 (384d)',
				model: 'TaylorAI/bge-micro-v2',
				description: '⚡ 最小最快，~23MB，适合低配设备或快速体验',
			},
			{
				id: 'local-bge-small-en',
				name: 'BGE-small-en-v1.5 (384d)',
				model: 'Xenova/bge-small-en-v1.5',
				description: '📈 同维度质量优于 micro，~34MB，纯英文笔记推荐',
			},
			{
				id: 'local-jina-zh',
				name: 'Jina-v2-base-zh (768d)',
				model: 'Xenova/jina-embeddings-v2-base-zh',
				description: '🇨🇳 中英双语，768维，8192 token，~140MB，中文笔记首选',
			},
			{
				id: 'local-nomic-v1.5',
				name: 'Nomic-embed-v1.5 (768d)',
				model: 'nomic-ai/nomic-embed-text-v1.5',
				description: '🌍 通用多语言，768维，2048 token，~274MB，综合质量最佳',
			},
		] as const;

		let needsSave = false;
		for (const preset of LOCAL_PRESETS) {
			if (!this.settings.embeddingConfigs.some((c) => c.id === preset.id)) {
				this.settings.embeddingConfigs.push({
					...preset,
					providerType: 'local',
					isPreset: true,
				});
				needsSave = true;
			}
		}
		if (!this.settings.activeEmbeddingConfigId) {
			this.settings.activeEmbeddingConfigId = 'local-bge-micro-v2';
			needsSave = true;
		}
		if (needsSave) await this.saveSettings();
		// Claude Code 配置注入已移至 _injectClaudeCodeConfig()（onload 后台执行，不阻塞）
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
