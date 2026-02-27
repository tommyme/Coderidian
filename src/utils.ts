import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { Notice } from 'obsidian';

export const execPromise = promisify(exec);

/**
 * Zip vault utility
 * @param vaultPath Path to the vault
 * @param zipFilePath Path to the output zip file
 * @param force Whether to force overwrite if file exists
 */
export async function zipVault(vaultPath: string, zipFilePath: string, force: boolean) {
	try {
		let exec_cmd, exec_pre, exec_suf, res_command;
		// 根据平台选择 zip 命令
		if (process.platform === 'win32') {
			exec_pre = 'powershell -command';
			exec_cmd = `Compress-Archive -Path '${vaultPath}\\*' -DestinationPath '${zipFilePath}'`;
		} else {
			exec_pre = '';
			exec_cmd = `zip -r '${zipFilePath}' '${vaultPath}'/*`;
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

/**
 * Confirmation modal for zip operation
 */
export class ConfirmModal extends Modal {
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
