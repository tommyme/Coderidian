import { App, TFile } from 'obsidian';

/**
 * 上传结果类型
 */
export interface UploadResult {
	/** 上传后的标识（URL 或 file_id） */
	id: string;
	/** 原始文件名 */
	filename: string;
	/** 上传类型 */
	type: 'url' | 'file_id';
}

/**
 * 上传 Provider 基础接口
 */
export interface UploadProvider {
	/** Provider 名称 */
	readonly name: string;

	/**
	 * 上传图片
	 * @param app Obsidian App 实例
	 * @param file 要上传的文件
	 * @returns 上传结果
	 */
	upload(app: App, file: TFile): Promise<UploadResult>;

	/**
	 * 从 Buffer 上传图片
	 * @param buffer 图片二进制数据
	 * @param filename 文件名
	 * @returns 上传结果
	 */
	uploadBuffer?(buffer: Buffer, filename: string): Promise<UploadResult>;
}

/**
 * Provider 配置基类
 */
export interface ProviderConfig {
	/** 重试次数，默认 3 */
	maxRetries?: number;
	/** 超时时间（毫秒），默认 30000 */
	timeout?: number;
}

/**
 * ttl.sh Provider 配置
 */
export interface TtlshProviderConfig extends ProviderConfig {
	/** 过期时间，默认 1h */
	ttl?: string;
}

/**
 * OpenAI 兼容文件上传 Provider 配置
 */
export interface OpenAIFileProviderConfig extends ProviderConfig {
	apiKey: string;
	apiEndpoint: string;
}
