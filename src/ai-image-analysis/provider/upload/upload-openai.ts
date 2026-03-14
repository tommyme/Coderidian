import { App, TFile } from 'obsidian';
import OpenAI from 'openai';
import { UploadProvider, UploadResult } from './base';
import { getMimeType } from './index';
import { LlmApiManager } from 'src/config/api-config-manager';
import { ResponsesContent } from 'src/ai-image-analysis/api/llm-api';

/**
 * OpenAI 兼容文件上传 Provider
 * 使用 OpenAI SDK 上传文件到兼容 OpenAI Files API 的服务器
 */
export class OpenAIFUP implements UploadProvider {
	/**
	 * 转换 baseUrl（OpenAI SDK 处理）
	 */
	transformUrl(baseUrl: string): string {
		return baseUrl;
	}

	/**
	 * 把文件上传的 response 解析为 UploadResult
	 */
	parseResponse(response: OpenAI.Files.FileObject, ...args: any[]): UploadResult {
		let [filename, _] = args;
		return { content: response.id, filename: filename, type:'file_id' };
	}

	buildContent(item: UploadResult): ResponsesContent {
		return {
			type: 'input_image',
			file_id: item.content
		}
	}

	/**
	 * 从 Obsidian 文件上传
	 */
	async upload(app: App, file: TFile): Promise<UploadResult> {
		let openai = new OpenAI({
			apiKey: LlmApiManager.config.apiKey,
			baseURL: this.transformUrl(LlmApiManager.config.fileApiEndpoint),
			dangerouslyAllowBrowser: true
		});
		const arrayBuffer = await app.vault.readBinary(file);
		const fileData = new Uint8Array(arrayBuffer);

		const fileObject = await openai.files.create({
			file: new File([fileData], file.name, { type: getMimeType(file.extension) }),
			purpose: 'user_data'
		});

		return this.parseResponse(fileObject, file.name);
	}
}