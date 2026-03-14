import { App, TFile } from 'obsidian';
import { ResponsesContent } from 'src/ai-image-analysis/api/llm-api';

/**
 * 上传结果类型
 */
export interface UploadResult {
	/** 上传/处理后得到的内容（URL, file_id, base64 data url） */
	content: string;
	/** 原始文件名 */
	filename: string;
	/** 上传类型 */
	type: 'url' | 'file_id';
}


/**
 * ttl.sh Provider 配置
 */
export interface TtlshProviderConfig {
	/** 过期时间，默认 1h */
	ttl?: string;
}

/**
 * 上传 Provider 接口
 */
export interface UploadProvider {
	/**
	 * 转换 baseUrl 为完整的上传 URL
	 */
	transformUrl(baseUrl: string): string;

	/**
	 * 从响应中解析上传结果
	 */
	parseResponse(response: any, ...args: any[]): UploadResult;

	/**
	 * 从 Obsidian 文件上传
	 * @param app Obsidian App 实例
	 * @param file 要上传的文件
	 * @returns 上传结果
	 */
	upload(app: App, file: TFile): Promise<UploadResult>;

	buildContent(item: UploadResult): ResponsesContent|any;
}
