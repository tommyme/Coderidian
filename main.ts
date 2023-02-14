import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import {readFileSync} from 'fs'
import {homedir} from 'os'
import {basename} from 'path'
// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();
		const data = readFileSync(`${homedir}/Library/Application Support/obsidian/obsidian.json`);
		const parsed = JSON.parse(data.toString())
		Object.entries(parsed.vaults).forEach(([key, value], idx) => {
			console.log(key, value)
			let vault_dirname = basename(value.path)

			this.addCommand({
				id: `jump2vault :: ${vault_dirname}`,
				name: `jump2vault :: ${vault_dirname}`,
				callback: () => {
					window.open(`obsidian://open?vault=${key}`)
					this.app.commands.executeCommandById("workspace:close-window")
				}
			})
		})


		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'quick switcher', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			const view = this.app.workspace.getActiveViewOfType(MarkdownView)
			// const editor = view.editor;
			window.view = view
			window.view.editor.focus();
			const cmd = this.app.commands.commands['switcher:open'].callback
			// cmd()
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'wrap-gray',
			name: 'wrap gray',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selected = editor.getSelection();
				if (selected === '') {
					editor.replaceRange('<font color="#888888"></font>', editor.getCursor())
					const justifyLen = '<font color="#888888">'.length
					const newCursor = editor.getCursor()
					console.log(newCursor)
					newCursor.ch += justifyLen
					editor.setCursor(newCursor)
				} else {
					editor.replaceSelection(`<font color="#888888">${selected}</font>`);
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// class SampleModal extends Modal {
// 	constructor(app: App) {
// 		super(app);
// 	}

// 	onOpen() {
// 		const {contentEl} = this;
// 		contentEl.setText('Woah!');
// 	}

// 	onClose() {
// 		const {contentEl} = this;
// 		contentEl.empty();
// 	}
// }

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

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
	}
}
