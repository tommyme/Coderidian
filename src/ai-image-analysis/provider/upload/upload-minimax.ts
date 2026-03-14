import { App, TFile } from 'obsidian';
import { UploadProvider, UploadResult } from './base';
import { getMimeType } from './index';

/**
 * Minimax 文件上传 Provider
 * 将图片转换为 base64 data URL（不实际上传到服务器）
 */
export class MinimaxFUP implements UploadProvider {
	readonly name = 'minimax-base64';

	transformUrl(baseUrl: string): string {
		// 不需要转换 URL，因为不进行实际上传
		return baseUrl;
	}

	parseResponse(response: any): UploadResult {
		// 不需要解析响应，因为不进行 HTTP 请求
		return {} as UploadResult;
	}

	/**
	 * 将 file 转换成 base64 data url
	 */
	async upload(app: App, file: TFile): Promise<UploadResult> {
		// 读取文件二进制数据
		const arrayBuffer = await app.vault.readBinary(file);
		const mimeType = getMimeType(file.extension);

		// 转换为 base64
		const base64 = this.arrayBufferToBase64(arrayBuffer);

		// 构造 Data URL
		const dataUrl = `data:${mimeType};base64,${base64}`;

		return {
			content: dataUrl,
			filename: file.name,
			type: 'url'
		};
	}

	/**
	 * ArrayBuffer 转 base64 字符串
	 */
	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	buildContent(item: UploadResult) {
		return {
			type: 'image_url',
			image_url: {
				url: item.content
			}
		};
	}
}
