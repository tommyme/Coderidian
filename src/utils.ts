import { App, Modal, Notice, Setting } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ApiConfigItem, RequestMethod, FileUploadMethod, createDefaultConfig } from './config/api-config-manager';

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
	title: string;
	message: string;
	confirmText: string;

	constructor(app: App, options: { title: string; message: string; confirmText?: string; onConfirm: () => void }) {
		super(app);
		this.title = options.title;
		this.message = options.message;
		this.confirmText = options.confirmText || '确认';
		this.onConfirm = options.onConfirm;
	}

	onOpen() {
		const { titleEl, contentEl } = this;
		titleEl.setText(this.title);
		contentEl.setText(this.message);

		const btnContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		const confirmButton = btnContainer.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
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

/**
 * 配置管理 Modal
 */
export class ConfigModal extends Modal {
	private apiConfigs: ApiConfigItem[];
	private activeConfigId: string;
	private onSave: (configs: ApiConfigItem[], activeId: string) => void;

	constructor(
		app: App,
		apiConfigs: ApiConfigItem[],
		activeConfigId: string,
		onSave: (configs: ApiConfigItem[], activeId: string) => void
	) {
		super(app);
		this.apiConfigs = apiConfigs.map(c => ({ ...c }));
		this.activeConfigId = activeConfigId;
		this.onSave = onSave;
	}

	onOpen() {
		const { titleEl, contentEl } = this;
		titleEl.setText('配置管理');
		contentEl.style.padding = '16px';

		const listContainer = contentEl.createDiv();
		listContainer.style.maxHeight = '400px';
		listContainer.style.overflowY = 'auto';
		listContainer.style.overflowX = 'hidden';

		// 直接使用已保存的配置（预设 + 自定义）
		const allConfigs = this.apiConfigs;

		// 渲染配置项
		const renderList = () => {
			listContainer.empty();

			if (allConfigs.length === 0) {
				listContainer.createEl('p', {
					text: '暂无配置',
					cls: 'setting-item-description'
				});
				return;
			}

			allConfigs.forEach(config => {
				const isActive = this.activeConfigId === config.id;

				const configDiv = listContainer.createDiv();
				configDiv.style.border = '1px solid var(--background-modifier-border)';
				configDiv.style.borderRadius = '8px';
				configDiv.style.padding = '12px';
				configDiv.style.marginBottom = '8px';

				if (isActive) {
					configDiv.style.borderColor = 'var(--text-accent)';
					configDiv.style.backgroundColor = 'var(--background-primary)';
				}

				// 头部
				const headerDiv = configDiv.createDiv();
				headerDiv.style.display = 'flex';
				headerDiv.style.justifyContent = 'space-between';
				headerDiv.style.alignItems = 'center';
				headerDiv.style.marginBottom = '8px';

				const nameDiv = headerDiv.createDiv();
				nameDiv.style.display = 'flex';
				nameDiv.style.alignItems = 'center';
				nameDiv.style.gap = '8px';

				nameDiv.createEl('strong', { text: config.name });

				// 预设/自定义标签
				const typeBadge = nameDiv.createEl('span', {
					text: config.isPreset ? '预设' : '自定义',
					cls: 'badge'
				});
				typeBadge.style.fontSize = '11px';
				typeBadge.style.color = config.isPreset ? 'var(--text-muted)' : 'var(--text-normal)';
				typeBadge.style.backgroundColor = 'var(--background-secondary)';
				typeBadge.style.padding = '2px 6px';
				typeBadge.style.borderRadius = '4px';

				if (isActive) {
					const activeBadge = nameDiv.createEl('span', {
						text: '当前使用',
						cls: 'badge'
					});
					activeBadge.style.fontSize = '12px';
					activeBadge.style.color = 'var(--text-accent)';
					activeBadge.style.backgroundColor = 'var(--background-secondary)';
					activeBadge.style.padding = '2px 6px';
					activeBadge.style.borderRadius = '4px';
				}

				// 按钮组
				const btnGroup = headerDiv.createDiv();
				btnGroup.style.display = 'flex';
				btnGroup.style.gap = '4px';

				// 启用按钮（切换当前使用配置，直接保存）
				if (!isActive) {
					const enableBtn = btnGroup.createEl('button', { text: '启用' });
					enableBtn.addEventListener('click', () => {
						this.activeConfigId = config.id;
						this.onSave(this.apiConfigs, this.activeConfigId);
						renderList();
					});
				}

				if (!config.isPreset) {
					const editBtn = btnGroup.createEl('button', { text: '编辑' });
					const deleteBtn = btnGroup.createEl('button', { text: '删除', cls: 'mod-warning' });

					editBtn.addEventListener('click', () => {
						this.openEditModal(config);
					});

					deleteBtn.addEventListener('click', () => {
						new ConfirmModal(this.app, {
							title: '确认删除',
							message: `确定要删除配置 "${config.name}" 吗？`,
							confirmText: '删除',
							onConfirm: () => {
								this.apiConfigs = this.apiConfigs.filter(c => c.id !== config.id);
								// 如果删除的是当前启用的配置，切换到空
								if (this.activeConfigId === config.id) {
									this.activeConfigId = '';
								}
								// 立即保存
								this.onSave(this.apiConfigs, this.activeConfigId);
								// 更新引用以便后续渲染
								(allConfigs as any).length = 0;
								this.apiConfigs.forEach((c: ApiConfigItem) => (allConfigs as any).push(c));
								renderList();
							}
						}).open();
					});
				}

				// 详情
				const detailsDiv = configDiv.createDiv();
				detailsDiv.style.fontSize = '13px';
				detailsDiv.style.color = 'var(--text-muted)';
				detailsDiv.createEl('p', { text: `模型: ${config.model}` });
				detailsDiv.createEl('p', { text: `Endpoint: ${config.apiEndpoint.substring(0, 50)}...` });
				if (config.requestMethod) {
					const methodNames: Record<string, string> = {
						'openai': 'OpenAI SDK',
						'requesturl': 'Obsidian requestUrl',
						'minimax': 'Minimax'
					};
					detailsDiv.createEl('p', { text: `请求方式: ${methodNames[config.requestMethod] || config.requestMethod}` });
				}
				if (config.fileUploadMethod) {
					const uploadMethodNames: Record<string, string> = {
						'openai': 'OpenAI SDK',
						'requesturl': 'Obsidian requestUrl',
						'minimax': 'Minimax (Base64)'
					};
					detailsDiv.createEl('p', { text: `文件上传: ${uploadMethodNames[config.fileUploadMethod] || config.fileUploadMethod}` });
				}
			});
		};

		// 渲染初始列表
		renderList();

		// 添加新配置按钮
		const addBtnContainer = contentEl.createDiv();
		addBtnContainer.style.marginTop = '12px';

		new Setting(addBtnContainer)
			.setName('')
			.addButton((button) => {
				button.setButtonText('+ 新增配置');
				button.onClick(() => {
					const newConfig = createDefaultConfig();
					this.apiConfigs.push(newConfig);
					this.openEditModal(newConfig, true);
					renderList();
				});
			});

	}

	/**
	 * 打开编辑 Modal
	 */
	private openEditModal(config: ApiConfigItem, isNew: boolean = false) {
		// 保存当前滚动位置
		const listContainer = this.contentEl.querySelector('div');
		const scrollTop = listContainer ? (listContainer as HTMLElement).scrollTop : 0;

		const editModal = new ConfigEditModal(
			this.app,
			config,
			isNew,
			{
				onSave: (updatedConfig) => {
					// 确保兼容旧配置：补全缺失的字段
					if (!updatedConfig.fileUploadMethod) {
						updatedConfig.fileUploadMethod = 'openai';
					}
					// 同步更新
					const idx = this.apiConfigs.findIndex(c => c.id === config.id);
					if (idx >= 0) {
						this.apiConfigs[idx] = updatedConfig;
					}
					// 立即保存
					this.onSave(this.apiConfigs, this.activeConfigId);
					// 刷新列表（需要先清空再重新渲染）
					this.contentEl.empty();
					this.onOpen();
					// 恢复滚动位置
					const newListContainer = this.contentEl.querySelector('div');
					if (newListContainer) {
						(newListContainer as HTMLElement).scrollTop = scrollTop;
					}
				},
				onCancel: isNew ? () => {
					// 如果是新增配置被取消，删除该配置
					this.apiConfigs = this.apiConfigs.filter(c => c.id !== config.id);
					// 更新 allConfigs 引用
					(allConfigs as any).length = 0;
					this.apiConfigs.forEach((c: ApiConfigItem) => (allConfigs as any).push(c));
					renderList();
				} : undefined
			}
		);
		editModal.open();
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * 配置编辑 Modal
 */
export class ConfigEditModal extends Modal {
	private config: ApiConfigItem;
	private isNew: boolean;
	private onSave: (config: ApiConfigItem) => void;
	private onCancel: (() => void) | null;

	constructor(app: App, config: ApiConfigItem, isNew: boolean, options: { onSave: (config: ApiConfigItem) => void; onCancel?: () => void }) {
		super(app);
		this.config = { ...config };
		this.isNew = isNew;
		this.onSave = options.onSave;
		this.onCancel = options.onCancel || null;
	}

	onOpen() {
		const { titleEl, contentEl } = this;
		titleEl.setText(this.isNew ? '新增配置' : '编辑配置');
		contentEl.style.padding = '16px';

		const formDiv = contentEl.createDiv();
		formDiv.style.display = 'flex';
		formDiv.style.flexDirection = 'column';
		formDiv.style.gap = '12px';

		// 配置名称
		new Setting(formDiv)
			.setName('配置名称')
			.addText((text) => {
				text.setPlaceholder('配置名称');
				text.setValue(this.config.name);
				text.onChange((value) => {
					this.config.name = value;
				});
			});

		// 请求方式
		new Setting(formDiv)
			.setName('请求方式')
			.addDropdown((dropdown) => {
				dropdown.addOption('openai', 'OpenAI SDK');
				dropdown.addOption('requesturl', 'Obsidian requestUrl');
				dropdown.addOption('minimax', 'Minimax');
				dropdown.setValue(this.config.requestMethod);
				dropdown.onChange((value) => {
					this.config.requestMethod = value as RequestMethod;
				});
			});

		// 文件上传方式
		new Setting(formDiv)
			.setName('文件上传方式')
			.addDropdown((dropdown) => {
				dropdown.addOption('openai', 'OpenAI SDK');
				dropdown.addOption('requesturl', 'Obsidian requestUrl');
				dropdown.addOption('minimax', 'Minimax (Base64)');
				dropdown.setValue(this.config.fileUploadMethod);
				dropdown.onChange((value) => {
					this.config.fileUploadMethod = value as FileUploadMethod;
				});
			});

		// API Key
		new Setting(formDiv)
			.setName('API Key')
			.addText((text) => {
				text.setPlaceholder('API Key');
				text.setValue(this.config.apiKey);
				text.inputEl.type = 'password';
				text.onChange((value) => {
					this.config.apiKey = value;
				});
			});

		// API Endpoint
		new Setting(formDiv)
			.setName('API Endpoint')
			.addText((text) => {
				text.setPlaceholder('https://api.example.com/v3/responses');
				text.setValue(this.config.apiEndpoint);
				text.onChange((value) => {
					this.config.apiEndpoint = value;
				});
			});

		// File API Endpoint
		new Setting(formDiv)
			.setName('File API Endpoint')
			.setDesc('文件上传 API（留空复用 API Endpoint）')
			.addText((text) => {
				text.setPlaceholder('留空则复用 API Endpoint');
				text.setValue(this.config.fileApiEndpoint);
				text.onChange((value) => {
					this.config.fileApiEndpoint = value;
				});
			});

		// 模型名称
		new Setting(formDiv)
			.setName('模型名称')
			.addText((text) => {
				text.setPlaceholder('模型名称');
				text.setValue(this.config.model);
				text.onChange((value) => {
					this.config.model = value;
				});
			});

		// 底部按钮
		const footerDiv = contentEl.createDiv({ cls: 'modal-button-container' });
		footerDiv.style.display = 'flex';
		footerDiv.style.justifyContent = 'flex-end';
		footerDiv.style.gap = '8px';
		footerDiv.style.marginTop = '16px';

		const cancelBtn = footerDiv.createEl('button', { text: '取消' });
		cancelBtn.onclick = () => {
			if (this.isNew && this.onCancel) {
				this.onCancel();
			}
			this.close();
		};

		const saveBtn = footerDiv.createEl('button', { text: '保存', cls: 'mod-cta' });
		saveBtn.onclick = () => {
			this.onSave(this.config);
			this.close();
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}
