import { App, TFile } from 'obsidian';
import { OpenAIFileUploadProvider, OpenAIFileProviderConfig } from '../provider/upload';
import { OpenaiUploadResult } from '../provider/upload/upload-openai';

/**
 * 使用 OpenAI SDK 上传文件（豆包兼容）
 * @deprecated 使用 OpenAIFileUploadProvider 替代
 */
export async function uploadImageWithOpenAISDK(
	app: App,
	file: TFile,
	apiKey: string,
	apiEndpoint: string
): Promise<OpenaiUploadResult> {
	const config: OpenAIFileProviderConfig = {
		apiKey,
		apiEndpoint
	};
	const provider = new OpenAIFileUploadProvider(config);
	const result = await provider.upload(app, file);
	return {
		id: result.id,
		filename: result.filename,
		type: 'file_id'
	};
}
