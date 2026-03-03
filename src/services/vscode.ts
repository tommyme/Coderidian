import { App, MarkdownView, Notice, Platform } from 'obsidian';
import { exec } from 'child_process';
import { MyPluginSettings } from '../settings';

export class VSCodeService {
	constructor(private app: App, private settings: MyPluginSettings) {}

	public open(file?: any) {
		const vaultPath = (this.app.vault.adapter as any).basePath;
		const filePath = file ? file.path : (this.app.workspace.getActiveFile()?.path || "");
		
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const line = activeView ? activeView.editor.getCursor().line + 1 : 0;
		const ch = activeView ? activeView.editor.getCursor().ch + 1 : 0;

		const command = this.interpolateTemplate(this.settings.codeCommandTemplate, {
			vaultpath: vaultPath,
			filepath: filePath,
			folderpath: file?.parent?.path || "",
			line, ch
		});

		const execOptions: any = {};
		if (Platform.isMacOS) {
			execOptions.env = {
				...process.env,
				PATH: '/usr/local/bin:/Applications/Visual Studio Code.app/Contents/Resources/app/bin:' + (process.env.PATH || '')
			};
		} else if (Platform.isWin) {
			execOptions.shell = 'cmd.exe';
		}

		exec(command, execOptions, (err, stdout, stderr) => {
			if (err) {
				console.error("Error executing VSCode command:", err);
				this.tryAlternativeMethods(vaultPath, filePath, line, ch, err);
			}
		});
	}

	public openViaURL(file?: any) {
		const vaultPath = (this.app.vault.adapter as any).basePath;
		const filePath = file ? file.path : (this.settings.urlOpenFile ? this.app.workspace.getActiveFile()?.path || "" : "");
		
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const line = activeView ? activeView.editor.getCursor().line + 1 : 0;
		const ch = activeView ? activeView.editor.getCursor().ch + 1 : 0;

		const workspacePath = this.interpolateTemplate(this.settings.urlWorkspacePath, {
			vaultpath: vaultPath, filepath: filePath, folderpath: file?.parent?.path || "", line, ch
		});

		let url = `${this.settings.urlProtocol}file/${encodeURIComponent(workspacePath)}`;
		if (filePath) {
			url += `:${encodeURIComponent(filePath)}${line && ch ? `:${line}:${ch}` : ''}`;
		}

		try {
			this.app.workspace.openLinkText(url, "", false);
		} catch (error) {
			new Notice("Failed to open VSCode via URL: " + error);
		}
	}

	private tryAlternativeMethods(vaultPath: string, filePath: string, line: number, ch: number, originalError: any) {
		if (Platform.isMacOS) {
			const altCommand = filePath ? `open -a "Visual Studio Code" "${vaultPath}/${filePath}"` : `open -a "Visual Studio Code" "${vaultPath}"`;
			exec(altCommand, (err) => {
				if (err) new Notice("Failed to open VSCode: " + originalError.message);
			});
		} else if (Platform.isWin) {
			const possiblePaths = [
				'"C:\\Program Files\\Microsoft VS Code\\bin\\code"',
				'"C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code"'
			];
			// 简化后的 Windows fallback 逻辑...
			new Notice("VSCode command failed. Ensure it is in your PATH.");
		}
	}

	private interpolateTemplate(template: string, variables: Record<string, any>) {
		return template.replace(/{{(\w+)}}/g, (_, key) => variables[key] || "");
	}
}
