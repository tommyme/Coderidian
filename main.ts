import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, Platform, Modal } from 'obsidian';
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { basename } from 'path'
import { exec } from 'child_process';
import { promisify } from 'util';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

const execPromise = promisify(exec);

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	private isBoldMode = true;

	async onload() {
		await this.loadSettings();
		if (Platform.isDesktop && (Platform.isMacOS || Platform.isWin)) {
			let ob_vault_json_path;
			if (Platform.isMacOS) {		// currently, only avaliable on macos
				ob_vault_json_path = `${homedir}/Library/Application Support/obsidian/obsidian.json`;
			} else {
				ob_vault_json_path = `${homedir}\\AppData\\Roaming\\obsidian\\obsidian.json`;
			}
			const data = readFileSync(ob_vault_json_path);
			const parsed = JSON.parse(data.toString())
			Object.entries(parsed.vaults).forEach(([key, value], idx) => {
				console.log(key, value)
				const vault_dirname = basename(value.path)

				this.addCommand({
					id: `jump2vault :: ${vault_dirname}`,
					name: `jump2vault :: ${vault_dirname}`,
					callback: () => {
						window.open(`obsidian://open?vault=${key}`)
						this.app.commands.executeCommandById("workspace:close-window")
					}
				})
			})
		}

		//#region ribbonIcons
		const ribbonIconEl = this.addRibbonIcon('dice', 'quick switcher', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			const view = this.app.workspace.getActiveViewOfType(MarkdownView)
			window.view = view
			window.view.editor.focus();
			const cmd = this.app.commands['switcher:open'].callback
		});
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		this.addRibbonIcon('switch', 'bind switched (bold/left sidebar)', () => {
            this.toggleSidebarOrBoldMode();
        });
		//#endregion

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		//#region add commands
        this.addCommand({
            id: 'toggle-bold-or-sidebar',
            name: 'Toggle Bold or Sidebar (depending on config)',
            hotkeys: [
                {
                    modifiers: ["Ctrl"],
                    key: "b"
                }
            ],
            callback: () => {
                if (this.isBoldMode) {
                    this.app.commands.executeCommandById('editor:toggle-bold');
                } else {
                    this.app.commands.executeCommandById('app:toggle-left-sidebar');
                }
            }
        });
        this.addCommand({
            id: 'toggle-bold-or-sidebar-switch',
            name: 'Toggle Bold or Sidebar (do switch)',
            callback: () => this.toggleSidebarOrBoldMode()
        });
		this.addCommand({
			id: 'wrap-html-gray',
			name: 'wrap html gray',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				wrap_content(editor, '<font color="#888888">', '</font>');
			}
		});
		this.addCommand({
			id: 'wrap-html-a',
			name: 'wrap html a',
			editorCallback(editor, ctx) {
				wrap_content(editor, '<a href="">', '</a>');
			},
		})
		// h1~h4 title style
		for (let i=1;i<4;i++) {
			let tag_name = `h${String(i)}`;
			this.addCommand({
				id: `wrap-html-${tag_name}`,
				name: `wrap html ${tag_name}`,
				editorCallback(editor, ctx) {
					wrap_content(editor, `<${tag_name}>`, `</${tag_name}>`);
				},
			})
		}
		this.addCommand({
			id: 'zip-the-vault',
			name: 'zip the vault',
			async editorCallback(editor, ctx) {
				const vaultPath = app.vault.adapter.basePath;
				const zipFilePath = `${vaultPath}.zip`;

				if (existsSync(zipFilePath)) {
					new ConfirmModal(() => zipVault(vaultPath, zipFilePath, true)).open();
				} else {
					await zipVault(vaultPath, zipFilePath, false);
				}
			},
		})
		this.addCommand({
			id: 'copy-selected-lf-content',
			name: 'copy selected lf content',
			async editorCallback(editor, ctx) {
				let selectedText = editor.getSelection();
				selectedText = selectedText.replace(/\n/g, '\r\n');
				await navigator.clipboard.writeText(selectedText);
			},
		})
		//#endregion
		
		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// 添加一种代码块
		this.registerMarkdownCodeBlockProcessor(`htmlx`, (source, el, ctx) => {
			// window.__el = el;
			// window.__source = source;
			// window.__ctx = ctx;
			// window.__this = this;

			const div = document.createElement("div");
			div.innerHTML = source;
			el.appendChild(div)
		});
		this.registerMarkdownCodeBlockProcessor(`hidden-js`, (source, el, ctx) => {

			const xxscript = document.createElement("script");
			xxscript.textContent = source
			el.appendChild(xxscript)
			const prompt = document.createElement("div");
			prompt.textContent = 'here is some hidden javascript code'
			el.appendChild(prompt);
		});
		this.registerMarkdownCodeBlockProcessor(`buttonjs`, (source, el, ctx) => {
			function processText(source: string) {
				const lines = source.split('\n');
				const name = lines[0];
				const content = lines.slice(1).join('\n');
				return { name, content };
			}

			const { name, content } = processText(source)

			// source line 1 is the label of button
			const btn = document.createElement("button");
			btn.addEventListener("click", () => {
				eval(content);
			})
			btn.textContent = name
			el.appendChild(btn);
		});
	}

	onunload() {

	}

	updateNotice() {
        const mode = this.isBoldMode ? '加粗 (Bold)' : '侧边栏 (Sidebar)';
        new Notice(`快捷键模式已切换至: ${mode}`);
    }

	toggleSidebarOrBoldMode() {
        // 翻转状态
        this.isBoldMode = !this.isBoldMode;
        // 显示提示，告知用户当前模式
        this.updateNotice();
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
class ConfirmModal extends Modal {
	constructor(onConfirm) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		this.titleEl.setText('确认覆盖');
		this.contentEl.setText('目标 zip 文件已存在，是否覆盖？');

		const confirmButton = document.createElement('button');
		confirmButton.innerText = '覆盖';
		confirmButton.onclick = () => {
			this.onConfirm();
			this.close();
		};

		const cancelButton = document.createElement('button');
		cancelButton.innerText = '取消';
		cancelButton.onclick = () => this.close();

		this.contentEl.appendChild(confirmButton);
		this.contentEl.appendChild(cancelButton);
	}
}
class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for my awesome plugin.' });

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

function wrap_content(editor: Editor, pre: string, suf: string) {
	const selected = editor.getSelection();
	if (selected === '') {
		editor.replaceRange(pre + suf, editor.getCursor())
		const justifyLen = pre.length
		const newCursor = editor.getCursor()
		console.log(newCursor)
		newCursor.ch += justifyLen
		editor.setCursor(newCursor)
	} else {
		editor.replaceSelection(pre + selected + suf);
	}
}

async function zipVault(vaultPath: string, zipFilePath: string, force: boolean) {
	try {
			let exec_cmd, exec_pre, exec_suf, res_command;
			// 根据平台选择 zip 命令
			if (process.platform === 'win32') {
				exec_pre = 'powershell -command';
				exec_cmd = `Compress-Archive -Path '${vaultPath}\\*' -DestinationPath '${zipFilePath}'`;
				// exec_suf = "";
			} else {
				exec_pre = '';
				exec_cmd = `zip -r '${zipFilePath}' '${vaultPath}'/*`;
				// exec_suf = '';
			}

			if (force && process.platform === 'win32') {
				exec_cmd += " -Force"
			} else {
				new Notice("platform isn't win32, force not support")
			}
			// build command
			res_command = [exec_pre, exec_cmd].join(" ")
			console.log(res_command)
			let no = new Notice('zipping...', 300000);
			await execPromise(res_command);
			no.hide()
			new Notice('Vault zipped successfully!');
	} catch (error) {
			console.error('Error zipping the vault:', error);
			new Notice('Failed to zip the vault.');
	}
}