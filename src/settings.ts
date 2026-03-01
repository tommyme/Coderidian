import { App, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';

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
	visionApiKey: string;
	visionApiEndpoint: string;
	visionModel: string;
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
	visionApiKey: "",
	visionApiEndpoint: "https://ark.cn-beijing.volces.com/api/v3/responses",
	visionModel: "doubao-seed-1-6-250815"
};

export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
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

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('视觉模型 API Key')
			.addText((text) => text
				.setPlaceholder('请输入 API Key')
				.setValue(this.plugin.settings.visionApiKey)
				.onChange(async (value) => {
					this.plugin.settings.visionApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API Endpoint')
			.setDesc('API 请求地址')
			.addText((text) => text
				.setValue(this.plugin.settings.visionApiEndpoint)
				.onChange(async (value) => {
					this.plugin.settings.visionApiEndpoint = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('模型名称')
			.setDesc('使用的视觉模型')
			.addText((text) => text
				.setValue(this.plugin.settings.visionModel)
				.onChange(async (value) => {
					this.plugin.settings.visionModel = value;
					await this.plugin.saveSettings();
				}));
	}
}
