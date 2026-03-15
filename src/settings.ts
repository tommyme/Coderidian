import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';
import { ApiConfigItem, ApiConfigManager, LlmApiManager } from './config/api-config-manager';
import { ConfigModal } from './utils';
import { EmbeddingConfigItem } from './services/note-similarity/types';

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
	activeConfigId: string;
	apiConfigs: ApiConfigItem[];
	// HTTP Interceptor settings
	enableHttpLogging: boolean;
	// Note Similarity settings
	embeddingEnabled: boolean;
	embeddingConfigs: EmbeddingConfigItem[];
	activeEmbeddingConfigId: string;
	similarNotesLimit: number;
	embeddingExcludeFolders: string[];
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
	activeConfigId: '',
	apiConfigs: [],
	// HTTP Interceptor default settings
	enableHttpLogging: false,
	// Note Similarity default settings
	embeddingEnabled: false,
	embeddingConfigs: [],
	activeEmbeddingConfigId: '',
	similarNotesLimit: 10,
	embeddingExcludeFolders: [],
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

		// 当前使用配置显示
		const activeConfig = this.plugin.settings.apiConfigs.find(c => c.id === this.plugin.settings.activeConfigId);
		new Setting(containerEl)
			.setName('当前使用配置')
			.setDesc(activeConfig ? `${activeConfig.isPreset ? '预设: ' : '自定义: '}${activeConfig.name}` : '未选择')
			.addButton((button) => {
				button.setButtonText('查看配置');
				button.onClick(async () => {
					const modal = new ConfigModal(
						this.app,
						this.plugin.settings.apiConfigs,
						this.plugin.settings.activeConfigId,
						(configs, activeId) => {
							this.plugin.settings.apiConfigs = configs;
							this.plugin.settings.activeConfigId = activeId;
							this.plugin.saveSettings();

							// 更新全局 LLM API 管理器配置
							const newActiveConfig = this.plugin.getActiveApiConfig();
							if (newActiveConfig) {
								LlmApiManager.init(newActiveConfig);
							}

							this.display();
						}
					);
					modal.open();
				});
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

		// Note Similarity settings
		containerEl.createEl('h2', { text: 'Note Similarity Settings' });

		new Setting(containerEl)
			.setName('Enable Note Similarity')
			.setDesc('Build an embedding index of your vault to find related notes. Requires an OpenAI-compatible Embedding API.')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.embeddingEnabled).onChange(async (value) => {
				this.plugin.settings.embeddingEnabled = value;
				await this.plugin.saveSettings();
				await this.plugin.reinitNoteSimilarity();
				this.display();
			}));

		if (this.plugin.settings.embeddingEnabled) {
			const activeEmbedConfig = this.plugin.settings.embeddingConfigs.find(
				(c) => c.id === this.plugin.settings.activeEmbeddingConfigId,
			);

			new Setting(containerEl)
				.setName('Embedding API 配置')
				.setDesc(activeEmbedConfig ? `当前: ${activeEmbedConfig.name} (${activeEmbedConfig.model})` : '未配置')
				.addButton((button) => {
					button.setButtonText('管理配置');
					button.onClick(() => this.openEmbeddingConfigModal());
				});

			new Setting(containerEl)
				.setName('Related Notes Limit')
				.setDesc('Number of related notes to show in the sidebar')
				.addSlider((slider) =>
					slider
						.setLimits(5, 50, 5)
						.setValue(this.plugin.settings.similarNotesLimit)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.similarNotesLimit = value;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName('Exclude Folders')
				.setDesc('Comma-separated folder paths to exclude from indexing (e.g. Templates, Archive)')
				.addText((text) =>
					text
						.setPlaceholder('Templates, Archive')
						.setValue(this.plugin.settings.embeddingExcludeFolders.join(', '))
						.onChange(async (value) => {
							this.plugin.settings.embeddingExcludeFolders = value
								.split(',')
								.map((s) => s.trim())
								.filter(Boolean);
							await this.plugin.saveSettings();
						}),
				);
		}
	}

	private openEmbeddingConfigModal(): void {
		const plugin = this.plugin;
		const settingsTab = this;

		class EmbeddingConfigModal extends Modal {
			constructor(app: App) {
				super(app);
				this.modalEl.addClass('coderidian-embed-config-modal');
			}

			onOpen() {
				this.render();
			}

			render() {
				const { contentEl } = this;
				contentEl.empty();

				// ── Header row: title + Add button ──
				const headerRow = contentEl.createDiv('coderidian-embed-modal-header');
				headerRow.createEl('h3', { text: 'Embedding 模型配置', cls: 'coderidian-modal-title' });
				const addBtn = headerRow.createEl('button', { text: '+ 新增配置', cls: 'mod-cta coderidian-embed-add-btn' });
				addBtn.addEventListener('click', () => {
					const addModal = new EmbeddingAddModal(this.app, async (newCfg) => {
						plugin.settings.embeddingConfigs.push(newCfg);
						if (!plugin.settings.activeEmbeddingConfigId) {
							plugin.settings.activeEmbeddingConfigId = newCfg.id;
						}
						await plugin.saveSettings();
						this.renderList(listEl);
					});
					addModal.open();
				});

				// ── Config list ──
				const listEl = contentEl.createDiv('coderidian-config-list');
				this.renderList(listEl);
			}

			renderList(listEl: HTMLElement) {
				listEl.empty();
				const currentConfigs = plugin.settings.embeddingConfigs;

				if (currentConfigs.length === 0) {
					listEl.createEl('p', { text: '暂无配置，点击右上角「+ 新增配置」添加。', cls: 'coderidian-empty-msg' });
					return;
				}

				for (const cfg of currentConfigs) {
					const isActive = cfg.id === plugin.settings.activeEmbeddingConfigId;
					const row = listEl.createDiv('coderidian-config-row' + (isActive ? ' is-active' : ''));

					// Left: info
					const info = row.createDiv('coderidian-config-info');
					const badge = cfg.providerType === 'local' ? '🏠' : cfg.providerType === 'doubao-multimodal' ? '🌋' : '☁️';
					info.createEl('span', { text: `${badge} ${cfg.name}`, cls: 'coderidian-config-name' });
					info.createEl('span', { text: cfg.model, cls: 'coderidian-config-model' });
					if (cfg.description) {
						info.createEl('span', { text: cfg.description, cls: 'coderidian-config-desc' });
					}

					// Right: buttons
					const btns = row.createDiv('coderidian-config-btns');

					if (isActive) {
						btns.createEl('span', { text: '✓ 使用中', cls: 'coderidian-badge mod-active' });
					} else {
						const useBtn = btns.createEl('button', { text: '使用', cls: 'mod-cta' });
						useBtn.addEventListener('click', async () => {
							plugin.settings.activeEmbeddingConfigId = cfg.id;
							await plugin.saveSettings();
							await plugin.reinitNoteSimilarity();
							this.renderList(listEl);
						});
					}

					if (!cfg.isPreset) {
						const editBtn = btns.createEl('button', { text: '编辑' });
						editBtn.addEventListener('click', () => {
							const modal = new EmbeddingEditModal(this.app, cfg, async (updated) => {
								const idx = plugin.settings.embeddingConfigs.findIndex((c) => c.id === cfg.id);
								if (idx !== -1) {
									plugin.settings.embeddingConfigs[idx] = updated;
									await plugin.saveSettings();
									if (plugin.settings.activeEmbeddingConfigId === updated.id) {
										await plugin.reinitNoteSimilarity();
									}
								}
								this.renderList(listEl);
							});
							modal.open();
						});

						const delBtn = btns.createEl('button', { text: '删除', cls: 'mod-warning' });
						delBtn.addEventListener('click', async () => {
							plugin.settings.embeddingConfigs = plugin.settings.embeddingConfigs.filter(
								(c) => c.id !== cfg.id,
							);
							if (plugin.settings.activeEmbeddingConfigId === cfg.id) {
								plugin.settings.activeEmbeddingConfigId = '';
							}
							await plugin.saveSettings();
							this.renderList(listEl);
						});
					}
				}
			}

			onClose() {
				settingsTab.display();
			}
		}

		new EmbeddingConfigModal(this.app).open();
	}
}

class EmbeddingAddModal extends Modal {
	private onAdd: (cfg: EmbeddingConfigItem) => Promise<void>;

	constructor(app: App, onAdd: (cfg: EmbeddingConfigItem) => Promise<void>) {
		super(app);
		this.onAdd = onAdd;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: '新增 Embedding 配置', cls: 'coderidian-modal-title' });

		type ProviderType = 'openai' | 'doubao-multimodal';
		let providerType: ProviderType = 'openai';
		let name = '', baseUrl = '', apiKey = '', model = 'text-embedding-3-small';

		const DEFAULTS: Record<ProviderType, { baseUrl: string; model: string; placeholder: string }> = {
			'openai': { baseUrl: '', model: 'text-embedding-3-small', placeholder: 'https://api.siliconflow.cn' },
			'doubao-multimodal': { baseUrl: 'https://ark.cn-beijing.volces.com/api', model: 'doubao-embedding-vision-251215', placeholder: 'https://ark.cn-beijing.volces.com/api' },
		};

		new Setting(contentEl)
			.setName('Name')
			.addText((t) => t.setPlaceholder('e.g. SiliconFlow BGE').onChange((v) => (name = v)));

		const baseUrlSetting = new Setting(contentEl)
			.setName('Base URL')
			.addText((t) => { t.setPlaceholder('https://api.siliconflow.cn').onChange((v) => (baseUrl = v)); return t; });

		const modelSetting = new Setting(contentEl)
			.setName('Model')
			.setDesc('e.g. BAAI/bge-m3, text-embedding-3-small')
			.addText((t) => { t.setValue(model).onChange((v) => (model = v)); return t; });

		new Setting(contentEl)
			.setName('API Key')
			.addText((t) => { t.setPlaceholder('sk-...'); t.inputEl.type = 'password'; t.onChange((v) => (apiKey = v)); });

		new Setting(contentEl)
			.setName('Provider Type')
			.addDropdown((dd) => {
				dd.addOption('openai', 'OpenAI Compatible');
				dd.addOption('doubao-multimodal', '豆包 Multimodal');
				dd.setValue(providerType);
				dd.onChange((v) => {
					providerType = v as ProviderType;
					const d = DEFAULTS[providerType];
					const urlInput = baseUrlSetting.controlEl.querySelector('input') as HTMLInputElement | null;
					const modelInput = modelSetting.controlEl.querySelector('input') as HTMLInputElement | null;
					if (urlInput) { urlInput.value = d.baseUrl; baseUrl = d.baseUrl; urlInput.placeholder = d.placeholder; }
					if (modelInput) { modelInput.value = d.model; model = d.model; }
				});
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('添加').setCta().onClick(async () => {
					if (!name || !baseUrl || !apiKey || !model) return;
					await this.onAdd({
						id: `embed-${Date.now()}`,
						name, providerType, baseUrl, apiKey, model,
					});
					this.close();
				}),
			)
			.addButton((btn) => btn.setButtonText('取消').onClick(() => this.close()));
	}

	onClose() {
		this.contentEl.empty();
	}
}

class EmbeddingEditModal extends Modal {
	private cfg: EmbeddingConfigItem;
	private onSave: (updated: EmbeddingConfigItem) => Promise<void>;

	constructor(app: App, cfg: EmbeddingConfigItem, onSave: (updated: EmbeddingConfigItem) => Promise<void>) {
		super(app);
		this.cfg = { ...cfg };
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Edit Configuration', cls: 'coderidian-modal-title' });

		let name = this.cfg.name;
		let baseUrl = this.cfg.baseUrl ?? '';
		let apiKey = this.cfg.apiKey ?? '';
		let model = this.cfg.model;

		new Setting(contentEl)
			.setName('Name')
			.addText((t) => t.setValue(name).onChange((v) => (name = v)));

		new Setting(contentEl)
			.setName('Base URL')
			.addText((t) => t.setValue(baseUrl).onChange((v) => (baseUrl = v)));

		new Setting(contentEl)
			.setName('Model')
			.addText((t) => t.setValue(model).onChange((v) => (model = v)));

		new Setting(contentEl)
			.setName('API Key')
			.addText((t) => {
				t.setValue(apiKey);
				t.inputEl.type = 'password';
				t.onChange((v) => (apiKey = v));
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Save')
					.setCta()
					.onClick(async () => {
						if (!name || !model) return;
						const updated: EmbeddingConfigItem = {
							...this.cfg,
							name,
							baseUrl: baseUrl || undefined,
							apiKey: apiKey || undefined,
							model,
						};
						await this.onSave(updated);
						this.close();
					}),
			)
			.addButton((btn) =>
				btn.setButtonText('Cancel').onClick(() => this.close()),
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
