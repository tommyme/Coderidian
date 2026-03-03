import { App, Modal, Notice } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';

export const execPromise = promisify(exec);

export async function zipVault(vaultPath: string, zipFilePath: string, force: boolean) {
	try {
		let exec_cmd, exec_pre;
		
		if (process.platform === 'win32') {
			exec_pre = 'powershell -command';
			exec_cmd = `Compress-Archive -Path '${vaultPath}\\*' -DestinationPath '${zipFilePath}'`;
			if (force) exec_cmd += " -Force";
		} else {
			exec_pre = '';
			exec_cmd = `zip -r '${zipFilePath}' '${vaultPath}'/*`;
			if (force) {
				new Notice("macOS/Linux 暂不支持 zip 命令的 force 覆盖参数", 3000);
			}
		}

		const res_command = [exec_pre, exec_cmd].filter(Boolean).join(" ");
		console.log("Executing zip:", res_command);
		
		const notice = new Notice('Zipping vault...', 300000);
		await execPromise(res_command);
		notice.hide();
		new Notice('Vault zipped successfully!');
	} catch (error) {
		console.error('Error zipping the vault:', error);
		new Notice('Failed to zip the vault.');
	}
}

export class ConfirmModal extends Modal {
	onConfirm: () => void;

    // 修复：必须传入 app 实例
	constructor(app: App, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { titleEl, contentEl } = this;
		titleEl.setText('确认覆盖');
		contentEl.setText('目标 zip 文件已存在，是否覆盖？');

		const btnContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		
		const confirmButton = btnContainer.createEl('button', { text: '覆盖', cls: 'mod-warning' });
		confirmButton.onclick = () => {
			this.onConfirm();
			this.close();
		};

		const cancelButton = btnContainer.createEl('button', { text: '取消' });
		cancelButton.onclick = () => this.close();
	}
	
	onClose() {
		this.contentEl.empty();
	}
}
