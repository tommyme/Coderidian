import { MarkdownView, Notice, Plugin, addIcon, Editor } from 'obsidian';
import { MyPluginSettings, DEFAULT_SETTINGS, SampleSettingTab } from './settings';
import { ApiConfigItem } from './config/api-config-manager';
import { registerCommands } from './commands';
import { VSCodeService } from './services/vscode';
import { registerCodeBlockProcessors } from './services/code-blocks';
import {
	parseNote,
	LLMApiConfig,
	uploadSingleImage,
	analyzeImageWithUploadResult,
	SingleImageRenderer,
	ImageToolbarManager,
	ToolbarButton
} from './ai-image-analysis';
import { createHttpInterceptor } from './interceptors';

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	isBoldMode = true;
	vscodeService: VSCodeService;
	private toolbarManager: ImageToolbarManager | null = null;

	async onload() {
		await this.loadSettings();
		this.vscodeService = new VSCodeService(this.app, this.settings);

		// 初始化 HTTP 请求拦截器
		this.setupHttpInterceptor();

		this.setupIcons();
		registerCommands(this);
		registerCodeBlockProcessors(this);

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

		// 如果当前已有活动视图，立即绑定
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			await this.toolbarManager?.attachToView(activeView);
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
	private getActiveApiConfig(): LLMApiConfig | null {
		// 如果使用 Claude Code 配置，暂时不支持（后续可扩展）
		if (this.settings.useClaudeCodeConfig) {
			new Notice('请先在设置中添加自定义配置');
			return null;
		}

		// 从自定义配置中查找
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
			requestMethod: activeConfig.requestMethod
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

			const uploadResult = await uploadSingleImage(this.app, parsedNote, imageIndex, undefined, config);

			// 3. 分析图片
			notice.setMessage('正在分析图片...');

			const analysis = await analyzeImageWithUploadResult(
				parsedNote,
				imageIndex,
				uploadResult,
				config,
				{ useEnhancedPrompt: true }
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
			console.log('[Coderidian] HTTP Interceptor disabled');
		}
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
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
