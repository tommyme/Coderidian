import { App, TFile } from 'obsidian';
import OpenAI from 'openai';
import { UploadProvider, UploadResult, OpenAIFileProviderConfig } from './base';

/**
 * OpenAI 兼容文件上传 Provider
 * 使用 OpenAI SDK 上传文件到兼容 OpenAI Files API 的服务器
 */
export class OpenAIFileUploadProvider implements UploadProvider {
	readonly name = 'openai-file';

	private config: Required<OpenAIFileProviderConfig>;
	private openai: OpenAI;

	constructor(config: OpenAIFileProviderConfig) {
		this.config = {
			maxRetries: config.maxRetries ?? 3,
			timeout: config.timeout ?? 30000,
			apiKey: config.apiKey,
			apiEndpoint: config.apiEndpoint
		};

		const baseUrl = this.config.apiEndpoint.replace(/\/responses$/, '');
		this.openai = new OpenAI({
			apiKey: this.config.apiKey,
			baseURL: baseUrl,
			dangerouslyAllowBrowser: true,
			timeout: this.config.timeout
		});
	}

	/**
	 * 从 Obsidian 文件上传
	 */
	async upload(app: App, file: TFile): Promise<UploadResult> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
			try {
				return await this.doUpload(app, file);
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (attempt < this.config.maxRetries) {
					await this.delay(1000 * attempt);
				}
			}
		}

		throw lastError || new Error('上传失败');
	}

	/**
	 * 执行实际上传
	 */
	private async doUpload(app: App, file: TFile): Promise<UploadResult> {
		const arrayBuffer = await app.vault.readBinary(file);
		const fileData = new Uint8Array(arrayBuffer);

		const fileObject = await this.openai.files.create({
			file: new File([fileData], file.name, { type: getMimeType(file.extension) }),
			purpose: 'user_data'
		});

		return {
			id: fileObject.id,
			filename: file.name,
			type: 'file_id'
		};
	}

	/**
	 * 延迟
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

/**
 * 获取 MIME 类型
 */
function getMimeType(extension: string): string {
	const ext = extension.toLowerCase();
	switch (ext) {
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'gif':
			return 'image/gif';
		case 'webp':
			return 'image/webp';
		case 'bmp':
			return 'image/bmp';
		default:
			return 'image/png';
	}
}

export interface OpenaiUploadResult extends UploadResult {
	id: string;
	filename: string;
	type: 'file_id';
}

