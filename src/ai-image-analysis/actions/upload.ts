import { App, TFile, requestUrl } from 'obsidian';
import { UploadResult } from '../provider/upload/base';
import { LLMApiConfig } from './analyze';

/**
 * 上传图片到 API
 * 根据 requestMethod 选择使用 OpenAI SDK 或 requestUrl
 */
export async function uploadImage(
	app: App,
	file: TFile,
	config: LLMApiConfig
): Promise<UploadResult> {
	const fileApiEndpoint = config.fileApiEndpoint || config.apiEndpoint;

	if (config.requestMethod === 'requesturl') {
		return await uploadWithRequestUrl(app, file, config.apiKey, fileApiEndpoint);
	} else {
		return await uploadWithOpenAI(app, file, config.apiKey, fileApiEndpoint);
	}
}

/**
 * 使用 OpenAI SDK 上传
 */
async function uploadWithOpenAI(
	app: App,
	file: TFile,
	apiKey: string,
	apiEndpoint: string
): Promise<UploadResult> {
	const OpenAI = await import('openai');
	const baseUrl = apiEndpoint.replace(/\/responses$/, '');

	const openai = new OpenAI.default({
		apiKey: apiKey,
		baseURL: baseUrl,
		dangerouslyAllowBrowser: true
	});

	const arrayBuffer = await app.vault.readBinary(file);
	const fileData = new Uint8Array(arrayBuffer);

	const fileObject = await openai.files.create({
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
 * 使用 requestUrl 上传
 */
async function uploadWithRequestUrl(
	app: App,
	file: TFile,
	apiKey: string,
	apiEndpoint: string
): Promise<UploadResult> {
	const baseUrl = apiEndpoint.replace(/\/responses$/, '');
	const arrayBuffer = await app.vault.readBinary(file);
	const fileData = new Uint8Array(arrayBuffer);

	// 将二进制转换为 base64
	const binary = String.fromCharCode(...fileData);
	const base64 = btoa(binary);

	// 构建 multipart form-data 请求
	const boundary = '----FormBoundary' + Date.now();
	const fileName = file.name;
	const mimeType = getMimeType(file.extension);

	const body = [
		`--${boundary}`,
		`Content-Disposition: form-data; name="file"; filename="${fileName}"`,
		`Content-Type: ${mimeType}`,
		'',
		base64,
		`--${boundary}`,
		`Content-Disposition: form-data; name="purpose"`,
		'',
		'user_data',
		`--${boundary}--`
	].join('\r\n');

	const response = await window.requestUrl({
		url: `${baseUrl}/files`,
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': `multipart/form-data; boundary=${boundary}`
		},
		body: body
	});

	if (response.status !== 200) {
		throw new Error(`上传失败: ${response.status} - ${response.text}`);
	}

	const result = response.json;
	return {
		id: result.id,
		filename: result.filename || file.name,
		type: 'file_id'
	};
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
