import { App, Editor, MarkdownView, Notice, Plugin, Platform, Modal, addIcon } from 'obsidian';
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { basename } from 'path'
import { exec } from 'child_process';
import { MyPluginSettings, DEFAULT_SETTINGS, SampleSettingTab } from './settings';
import { registerCommands, wrap_content } from './commands';
import { zipVault, ConfirmModal } from './utils';

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

		// Register all commands
		registerCommands(this);

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

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// 添加一种代码块
		this.registerMarkdownCodeBlockProcessor(`htmlx`, (source, el, ctx) => {
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
