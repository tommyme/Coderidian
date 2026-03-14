import { App, RequestUrlResponse, TFile, requestUrl } from 'obsidian';
import { UploadProvider, UploadResult, UploadProviderConfig } from './base';
import { getMimeType } from './index';
import { LlmApiManager } from 'src/config/api-config-manager';

/**
 * URL 文件上传 Provider
 * 使用 requestUrl 上传文件 因为obsidian requestUrl 无法直接处理formdata 所以自己构造formdata
 */
export class RequestUrlFUP implements UploadProvider {
	/**
	 * 转换 baseUrl 为完整的上传 URL
	 */
	transformUrl(baseUrl: string): string {
		return `${baseUrl}/files/upload`;
	}

	/**
	 * 从响应中解析上传结果
	 */
	parseResponse(response: RequestUrlResponse): UploadResult {
		let data = response.json;
		return {
			content: data.fileId,
			filename: data.filename || data.file.name,
			type: 'file_id'
		};
	}

	buildContent(item: UploadResult) {
		return {
			type: 'image_url',
			image_url: {
				url: item.content
			} 
		}
	}

	/**
	 * 从 Obsidian 文件上传
	 */
	async upload(app: App, file: TFile): Promise<UploadResult> {
		const uploadUrl = this.transformUrl(LlmApiManager.config.fileApiEndpoint);
		let { boundary, bodyBuffer } = await buildFormDataFromFile(app, file);

		const response = await requestUrl({
			url: uploadUrl,
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${LlmApiManager.config.apiKey}`,
				'Content-Type': `multipart/form-data; boundary=${boundary}`
			},
			body: bodyBuffer.buffer
		});

		if (response.status !== 200) {
			throw new Error(`上传失败: ${response.status} - ${response.text}`);
		}

		const result = response.json;
		return this.parseResponse(result);
	}
}


// ❌ 不支持：Obsidian requestUrl 无法直接处理 FormData 对象
// ✅ 解决方案：手动构造 multipart/form-data 的二进制数据
async function buildFormDataFromFile(app: App, file: TFile) {
	const arrayBuffer = await app.vault.readBinary(file);
	const mimeType = getMimeType(file.extension);

	const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
	const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
	const headerBuffer = new TextEncoder().encode(header);
	const footer = `\r\n--${boundary}--\r\n`;
	const footerBuffer = new TextEncoder().encode(footer);

	const totalLength = headerBuffer.length + arrayBuffer.byteLength + footerBuffer.length;
	const bodyBuffer = new Uint8Array(totalLength);
	bodyBuffer.set(headerBuffer, 0);
	bodyBuffer.set(new Uint8Array(arrayBuffer), headerBuffer.length);
	bodyBuffer.set(footerBuffer, headerBuffer.length + arrayBuffer.byteLength);
	return {
		boundary,
		bodyBuffer
	};
}