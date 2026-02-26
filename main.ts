import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, Platform, Modal, addIcon } from 'obsidian';
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { basename } from 'path'
import { exec } from 'child_process';
import { promisify } from 'util';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
	// Open VSCode settings
	ribbonIcon: boolean;
	ribbonMethodCode: boolean;
	codeCommandTemplate: string;
	urlOpenFile: boolean;
	urlWorkspacePath: string;
	urlProtocol: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	// Open VSCode default settings
	ribbonIcon: true,
	ribbonMethodCode: true,
	codeCommandTemplate: 'code "{{vaultpath}}" "{{vaultpath}}/{{filepath}}"',
	urlOpenFile: false,
	urlWorkspacePath: "{{vaultpath}}",
	urlProtocol: "vscode://"
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

		// Open VSCode functionality - custom VSCode icon
		const vscodeIconId = "vscode-logo";
		const vscodeIconSvgContent = `
<svg role="img" viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg">
    <title>Visual Studio Code</title>
    <path
        fill="currentColor"
        d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
    />
</svg>
`;

		// Register custom icon - add to DOM
		const styleEl = document.createElement('style');
		addIcon(vscodeIconId, vscodeIconSvgContent);

		document.head.appendChild(styleEl);
		this.register(() => styleEl.remove()); // Cleanup on unload

		if (this.settings.ribbonIcon) {
			this.addRibbonIcon(vscodeIconId, 'Open in VSCode', () => {
				this.ribbonHandler();
			});
		}

		this.addCommand({
			id: 'open-vscode',
			name: 'Open Vault in VSCode',
			callback: () => {
				this.openVSCode();
			}
		});

		this.addCommand({
			id: 'open-vscode-via-url',
			name: 'Open Vault in VSCode (via URL)',
			callback: () => {
				this.openVSCodeViaURL();
			}
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				menu.addItem((item) => {
					item
						.setTitle('Open in VSCode')
						.setIcon('vscode-logo')
						.onClick(() => {
							this.openVSCode(file);
						});
				});
			})
		);

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

	// Open VSCode methods
	ribbonHandler() {
		if (this.settings.ribbonMethodCode) {
			this.openVSCode();
		} else {
			this.openVSCodeViaURL();
		}
	}

	openVSCode(file?: any) {
		const vaultPath = (this.app.vault.adapter as any).basePath;
		let filePath = "";

		if (file) {
			filePath = file.path;
		} else if (this.app.workspace.getActiveFile()) {
			filePath = this.app.workspace.getActiveFile().path;
		}

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const line = activeView ? activeView.editor.getCursor().line + 1 : 0;
		const ch = activeView ? activeView.editor.getCursor().ch + 1 : 0;

		let command = this.interpolateTemplate(this.settings.codeCommandTemplate, {
			vaultpath: vaultPath,
			filepath: filePath,
			folderpath: file?.parent?.path || "",
			line: line,
			ch: ch
		});

		console.log("Executing command:", command);

		// 根据平台设置适当的执行选项
		const execOptions: any = {};
		if (Platform.isMacOS) {
			// macOS 中 VSCode 的 code 命令通常安装在以下位置
			execOptions.env = {
				...process.env,
				PATH: '/usr/local/bin:/Applications/Visual Studio Code.app/Contents/Resources/app/bin:' + (process.env.PATH || '')
			};
		} else if (Platform.isWin) {
			// Windows 系统使用 cmd 作为 shell，确保能找到 code 命令
			execOptions.shell = 'cmd.exe';
		}

		try {
			exec(command, execOptions, (err, stdout, stderr) => {
				if (err) {
					console.error("Error executing command:", err);
					console.error("Stderr:", stderr);
					// 如果命令失败，尝试备用方案
					this.tryAlternativeVSCodeMethods(vaultPath, filePath, line, ch, err);
				} else {
					console.log("Command executed successfully");
				}
			});
		} catch (error) {
			console.error("Error executing command:", error);
			this.tryAlternativeVSCodeMethods(vaultPath, filePath, line, ch, error);
		}
	}

	// 尝试备用方法打开 VSCode
	tryAlternativeVSCodeMethods(vaultPath: string, filePath: string, line: number, ch: number, originalError: any) {
		console.log("Trying alternative methods to open VSCode");

		if (Platform.isMacOS) {
			// macOS 备用方法：直接使用 open 命令打开 VSCode
			let altCommand = `open -a "Visual Studio Code" "${vaultPath}"`;
			if (filePath) {
				altCommand = `open -a "Visual Studio Code" "${vaultPath}/${filePath}"`;
			}

			console.log("Trying macOS open command:", altCommand);
			exec(altCommand, (err, stdout, stderr) => {
				if (err) {
					console.error("Alternative method failed:", err);
					new Notice("Failed to open VSCode: " + originalError.message);
				} else {
					console.log("Alternative macOS method succeeded");
				}
			});
		} else if (Platform.isWin) {
			// Windows 备用方法：尝试直接调用 code 命令的完整路径
			const possiblePaths = [
				'"C:\\Program Files\\Microsoft VS Code\\bin\\code"',
				'"C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code"'
			];

			let triedPaths = 0;
			const tryNextPath = () => {
				if (triedPaths >= possiblePaths.length) {
					new Notice("Failed to open VSCode: " + originalError.message);
					return;
				}

				const vscodePath = possiblePaths[triedPaths];
				let altCommand = this.settings.codeCommandTemplate.replace('code ', `${vscodePath} `);
				altCommand = this.interpolateTemplate(altCommand, {
					vaultpath: vaultPath,
					filepath: filePath,
					folderpath: "",
					line: line,
					ch: ch
				});

				console.log("Trying Windows VSCode path:", altCommand);
				exec(altCommand, { shell: 'cmd.exe' }, (err, stdout, stderr) => {
					if (err) {
						console.error(`Path ${vscodePath} failed:`, err);
						triedPaths++;
						tryNextPath();
					} else {
						console.log("Alternative Windows method succeeded");
					}
				});
			};

			tryNextPath();
		} else {
			// 其他平台（Linux）
			new Notice("Failed to open VSCode: " + originalError.message);
		}
	}

	openVSCodeViaURL(file?: any) {
		const vaultPath = (this.app.vault.adapter as any).basePath;
		let filePath = "";

		if (file) {
			filePath = file.path;
		} else if (this.settings.urlOpenFile && this.app.workspace.getActiveFile()) {
			filePath = this.app.workspace.getActiveFile().path;
		}

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const workspacePath = this.interpolateTemplate(this.settings.urlWorkspacePath, {
			vaultpath: vaultPath,
			filepath: filePath,
			folderpath: file?.parent?.path || "",
			line: activeView ? activeView.editor.getCursor().line + 1 : 0,
			ch: activeView ? activeView.editor.getCursor().ch + 1 : 0
		});

		let url = this.settings.urlProtocol + "file/" + encodeURIComponent(workspacePath);

		if (filePath) {
			url += ":" + encodeURIComponent(filePath);
			const line = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getCursor().line + 1;
			const ch = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getCursor().ch + 1;
			if (line && ch) {
				url += ":" + line + ":" + ch;
			}
		}

		console.log("Opening URL:", url);

		try {
			this.app.workspace.openLinkText(url, "", false);
		} catch (error) {
			console.error("Error opening URL:", error);
			new Notice("Failed to open VSCode via URL: " + error);
		}
	}

	interpolateTemplate(template: string, variables: any) {
		return template.replace(/{{(\w+)}}/g, (match, key) => {
			return variables[key] || "";
		});
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