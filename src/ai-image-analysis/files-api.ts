import { App, TFile } from 'obsidian';
import OpenAI from 'openai';

export interface FileUploadResult {
	id: string;
	filename: string;
}

/**
 * 使用 OpenAI SDK 上传文件（豆包兼容）
 */
export async function uploadImageWithOpenAISDK(
	app: App,
	file: TFile,
	apiKey: string,
	apiEndpoint: string
): Promise<FileUploadResult> {
	const arrayBuffer = await app.vault.readBinary(file);
	const fileData = new Uint8Array(arrayBuffer);

	const baseUrl = apiEndpoint.replace(/\/responses$/, '');

	const openai = new OpenAI({
		apiKey: apiKey,
		baseURL: baseUrl,
		dangerouslyAllowBrowser: true
	});

	const fileObject = await openai.files.create({
		file: new File([fileData], file.name, { type: getMimeType(file.extension) }),
		purpose: 'user_data'
	});

	return {
		id: fileObject.id,
		filename: file.name
	};
}

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
