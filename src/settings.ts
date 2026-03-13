import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';
import { ApiConfigItem, RequestMethod, ApiConfigManager, createDefaultConfig } from './config/api-config-manager';

export interface MyPluginSettings {
	mySetting: string;
	// Open VSCode settings
	ribbonIcon: boolean;
	ribbonMethodCode: boolean;
	codeCommandTemplate: string;
	urlOpenFile: boolean;
	urlWorkspacePath: string;
	urlProtocol: string;
	// AI Image Analysis settings
	useClaudeCodeConfig: boolean;
	activeConfigId: string;
	apiConfigs: ApiConfigItem[];
	// HTTP Interceptor settings
	enableHttpLogging: boolean;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	// Open VSCode default settings
	ribbonIcon: true,
	ribbonMethodCode: true,
	codeCommandTemplate: 'code "{{vaultpath}}" "{{vaultpath}}/{{filepath}}"',
	urlOpenFile: false,
	urlWorkspacePath: "{{vaultpath}}",
	urlProtocol: "vscode://",
	// AI Image Analysis default settings
	useClaudeCodeConfig: false,
	activeConfigId: '',
	apiConfigs: [],
	// HTTP Interceptor default settings
	enableHttpLogging: false
};

export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for Coderidian Plugin.' });

		// Original setting
		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));

		// Open VSCode settings
		containerEl.createEl('h2', { text: 'Open in VSCode Settings' });

		new Setting(containerEl)
			.setName('Display Ribbon Icon')
			.setDesc('Whether to show the ribbon icon in the left sidebar')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.ribbonIcon).onChange(async (value) => {
				this.plugin.settings.ribbonIcon = value;
				await this.plugin.saveSettings();
				// Reload the plugin to apply changes to the ribbon icon
				window.location.reload();
			}));

		new Setting(containerEl)
			.setName('Ribbon opens via `code`')
			.setDesc('Whether the ribbon button should use the `code` command or the URL method')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.ribbonMethodCode).onChange(async (value) => {
				this.plugin.settings.ribbonMethodCode = value;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('Code Command Template')
			.setDesc('Template for the command to open VSCode')
			.addTextArea((text) => text.setValue(this.plugin.settings.codeCommandTemplate).onChange(async (value) => {
				this.plugin.settings.codeCommandTemplate = value;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('Open current file (URL method)')
			.setDesc('Whether to open the current file rather than the entire vault')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.urlOpenFile).onChange(async (value) => {
				this.plugin.settings.urlOpenFile = value;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('VSCode Workspace Path (URL method)')
			.setDesc('Path to the VSCode workspace file')
			.addText((text) => text.setValue(this.plugin.settings.urlWorkspacePath).onChange(async (value) => {
				this.plugin.settings.urlWorkspacePath = value;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('VSCode URL Protocol')
			.setDesc('Protocol to use for opening VSCode')
			.addText((text) => text.setValue(this.plugin.settings.urlProtocol).onChange(async (value) => {
				this.plugin.settings.urlProtocol = value;
				await this.plugin.saveSettings();
			}));

		// AI Image Analysis settings
		containerEl.createEl('h2', { text: 'AI Image Analysis Settings' });

		// 配置管理器
		const configManager = new ApiConfigManager(this.plugin.app);

		// 预设配置显示
		containerEl.createEl('h3', { text: '预设配置' });
		const claudeCodeConfig = await configManager.getClaudeCodeConfig();
		if (claudeCodeConfig) {
			new Setting(containerEl)
				.setName('Claude Code 配置')
				.setDesc(`模型: ${claudeCodeConfig.model}, Endpoint: ${claudeCodeConfig.apiEndpoint.substring(0, 30)}...`)
				.addToggle((toggle) => toggle.setValue(this.plugin.settings.useClaudeCodeConfig).onChange(async (value) => {
					this.plugin.settings.useClaudeCodeConfig = value;
					await this.plugin.saveSettings();
					this.display();
				}));
		} else {
			containerEl.createEl('p', { text: '无法读取 Claude Code 配置，请检查 ~/.claude/settings.json', cls: 'setting-item-description' });
		}

		// 当前激活配置
		containerEl.createEl('h3', { text: '当前配置' });
		const configOptions: { label: string; value: string }[] = [
			{ label: '预设: Claude Code', value: 'claude-code' }
		];
		this.plugin.settings.apiConfigs.forEach(config => {
			configOptions.push({ label: `自定义: ${config.name}`, value: config.id });
		});

		new Setting(containerEl)
			.setName('使用配置')
			.setDesc('选择当前使用的 API 配置')
			.addDropdown((dropdown) => {
				dropdown.addOption('claude-code', '预设: Claude Code');
				this.plugin.settings.apiConfigs.forEach(config => {
					dropdown.addOption(config.id, `自定义: ${config.name}`);
				});
				dropdown.setValue(this.plugin.settings.useClaudeCodeConfig ? 'claude-code' : (this.plugin.settings.activeConfigId || 'claude-code'));
				dropdown.onChange(async (value) => {
					if (value === 'claude-code') {
						this.plugin.settings.useClaudeCodeConfig = true;
					} else {
						this.plugin.settings.useClaudeCodeConfig = false;
						this.plugin.settings.activeConfigId = value;
					}
					await this.plugin.saveSettings();
				});
			});

		// 自定义配置列表
		containerEl.createEl('h3', { text: '自定义配置' });

		// 渲染单个配置项
		const renderConfigItem = (config: ApiConfigItem) => {
			const configDiv = containerEl.createDiv();
			configDiv.style.border = '1px solid var(--background-modifier-border)';
			configDiv.style.borderRadius = '8px';
			configDiv.style.padding = '12px';
			configDiv.style.marginBottom = '12px';

			const headerDiv = configDiv.createDiv();
			headerDiv.style.display = 'flex';
			headerDiv.style.justifyContent = 'space-between';
			headerDiv.style.alignItems = 'center';
			headerDiv.style.marginBottom = '8px';

			headerDiv.createEl('strong', { text: config.name });

			const btnGroup = headerDiv.createDiv();
			btnGroup.style.display = 'flex';
			btnGroup.style.gap = '4px';

			const editBtn = btnGroup.createEl('button', { text: '编辑' });
			const deleteBtn = btnGroup.createEl('button', { text: '删除', cls: 'mod-warning' });

			const detailsDiv = configDiv.createDiv();
			detailsDiv.style.display = 'none';
			detailsDiv.style.flexDirection = 'column';
			detailsDiv.style.gap = '8px';

			// 编辑按钮切换
			editBtn.addEventListener('click', () => {
				detailsDiv.style.display = detailsDiv.style.display === 'none' ? 'flex' : 'none';
			});

			// 删除按钮
			deleteBtn.addEventListener('click', async () => {
				this.plugin.settings.apiConfigs = this.plugin.settings.apiConfigs.filter(c => c.id !== config.id);
				await this.plugin.saveSettings();
				this.display();
			});

			// 请求方式
			new Setting(detailsDiv)
				.setName('请求方式')
				.addDropdown((dropdown) => {
					dropdown.addOption('openai', 'OpenAI SDK');
					dropdown.addOption('requesturl', 'Obsidian requestUrl');
					dropdown.setValue(config.requestMethod);
					dropdown.onChange(async (value) => {
						config.requestMethod = value as RequestMethod;
						await this.plugin.saveSettings();
					});
				});

			// API Key
			new Setting(detailsDiv)
				.setName('API Key')
				.addText((text) => text
					.setPlaceholder('API Key')
					.setValue(config.apiKey)
					.onChange(async (value) => {
						config.apiKey = value;
						await this.plugin.saveSettings();
					}));

			// API Endpoint
			new Setting(detailsDiv)
				.setName('API Endpoint')
				.addText((text) => text
					.setPlaceholder('https://api.example.com/v1')
					.setValue(config.apiEndpoint)
					.onChange(async (value) => {
						config.apiEndpoint = value;
						await this.plugin.saveSettings();
					}));

			// File API Endpoint
			new Setting(detailsDiv)
				.setName('File API Endpoint')
				.setDesc('文件上传 API（留空复用 API Endpoint）')
				.addText((text) => text
					.setPlaceholder('留空则复用 API Endpoint')
					.setValue(config.fileApiEndpoint)
					.onChange(async (value) => {
						config.fileApiEndpoint = value;
						await this.plugin.saveSettings();
					}));

			// 模型名称
			new Setting(detailsDiv)
				.setName('模型名称')
				.addText((text) => text
					.setPlaceholder('模型名称')
					.setValue(config.model)
					.onChange(async (value) => {
						config.model = value;
						await this.plugin.saveSettings();
					}));
		};

		// 渲染现有配置
		this.plugin.settings.apiConfigs.forEach(config => renderConfigItem(config));

		// 添加新配置按钮
		new Setting(containerEl)
			.setName('')
			.addButton((button) => {
				button.setButtonText('+ 添加新配置');
				button.onClick(async () => {
					const newConfig = createDefaultConfig();
					this.plugin.settings.apiConfigs.push(newConfig);
					await this.plugin.saveSettings();
					this.display();
				});
			});

		// 导入/导出按钮
		const importExportDiv = containerEl.createDiv();
		importExportDiv.style.display = 'flex';
		importExportDiv.style.gap = '8px';
		importExportDiv.style.marginTop = '8px';

		const exportBtn = importExportDiv.createEl('button', { text: '导出配置' });
		const importBtn = importExportDiv.createEl('button', { text: '导入配置' });

		exportBtn.addEventListener('click', async () => {
			const json = configManager.exportConfigs(this.plugin.settings.apiConfigs);
			const blob = new Blob([json], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'coderidian-api-configs.json';
			a.click();
			URL.revokeObjectURL(url);
			new Notice('配置已导出');
		});

		importBtn.addEventListener('click', () => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.json';
			input.onchange = async (e) => {
				const file = (e.target as HTMLInputElement).files?.[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = async (event) => {
					try {
						const json = event.target?.result as string;
						const imported = configManager.importConfigs(json, this.plugin.settings.apiConfigs, 'merge');
						this.plugin.settings.apiConfigs = imported;
						await this.plugin.saveSettings();
						new Notice(`成功导入 ${imported.length} 个配置`);
						this.display();
					} catch (err) {
						new Notice('导入失败: ' + (err as Error).message);
					}
				};
				reader.readAsText(file);
			};
			input.click();
		});

		// HTTP Interceptor settings
		containerEl.createEl('h2', { text: 'HTTP Interceptor Settings' });

		new Setting(containerEl)
			.setName('Enable HTTP Logging')
			.setDesc('Enable request/response logging interceptors for debugging')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.enableHttpLogging).onChange(async (value) => {
				this.plugin.settings.enableHttpLogging = value;
				await this.plugin.saveSettings();
				// Dynamically add or remove logging interceptors
				this.plugin.updateHttpLogging(value);
			}));
	}
}
