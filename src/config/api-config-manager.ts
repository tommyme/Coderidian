/**
 * API 配置管理模块
 *
 * 管理多个 API 配置项，支持：
 * - 从 Claude Code 读取预设配置
 * - 多个自定义配置
 * - 不同的请求方式（OpenAI SDK / requestUrl）
 */

import { App } from 'obsidian';
import { getClaudeCodeConfig, ClaudeCodeEnvConfig } from './claude-code-config';
import { LLMApiConfig } from '../ai-image-analysis/actions/analyze';
import { UploadProvider } from '../ai-image-analysis/provider/upload';
import { OpenAIFUP } from '../ai-image-analysis/provider/upload/upload-openai';
import { RequestUrlFUP } from '../ai-image-analysis/provider/upload/upload-requesturl';
import { MinimaxFUP } from '../ai-image-analysis/provider/upload/upload-minimax';
import { LlmRequestProvider } from '../ai-image-analysis/provider/llm-request/base';
import { OpenAIRequestProvider, RequestUrlRequestProvider, MinimaxRequestProvider } from '../ai-image-analysis/provider/llm-request';
import { ResponsesMessage } from 'src/ai-image-analysis/api/llm-api';

/** API 请求方式 */
export type RequestMethod = 'openai' | 'requesturl';

/** 文件上传方式 */
export type FileUploadMethod = 'openai' | 'requesturl' | 'minimax';

/** 单个 API 配置项 */
export interface ApiConfigItem {
	id: string;
	name: string;
	requestMethod: RequestMethod;
	fileUploadMethod: FileUploadMethod;
	apiKey: string;
	apiEndpoint: string;
	fileApiEndpoint: string;
	model: string;
	isPreset?: boolean;  // 是否为预设配置（预设不可删除、不可编辑）
}

/**
 * 生成唯一的配置 ID
 */
function generateConfigId(): string {
	return 'custom-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

/**
 * 创建默认的自定义配置
 */
export function createDefaultConfig(name?: string): ApiConfigItem {
	const count = Math.floor(Math.random() * 1000);
	return {
		id: generateConfigId(),
		name: name || `custom-${count}`,
		requestMethod: 'openai',
		fileUploadMethod: 'openai',
		apiKey: '',
		apiEndpoint: '',
		fileApiEndpoint: '',
		model: ''
	};
}

/**
 * API 配置管理器
 */
export class ApiConfigManager {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * 获取 Claude Code 预设配置
	 */
	async getClaudeCodeConfig(): Promise<ClaudeCodeEnvConfig | null> {
		return await getClaudeCodeConfig(this.app);
	}

	/**
	 * 导出配置为 JSON
	 */
	exportConfigs(apiConfigs: ApiConfigItem[]): string {
		return JSON.stringify(apiConfigs, null, 2);
	}

	/**
	 * 从 JSON 导入配置
	 * @param json 导入的 JSON 字符串
	 * @param mode 'merge' 合并到现有配置，'replace' 替换现有配置
	 */
	importConfigs(json: string, currentConfigs: ApiConfigItem[], mode: 'merge' | 'replace'): ApiConfigItem[] {
		try {
			const imported = JSON.parse(json) as ApiConfigItem[];
			if (!Array.isArray(imported)) {
				throw new Error('Invalid format: expected array');
			}

			// 验证每个配置项
			const validConfigs = imported.filter(c =>
				c.id && c.name && c.requestMethod && c.apiEndpoint && c.model
			);

			if (mode === 'replace') {
				return validConfigs;
			} else {
				// 合并：避免 ID 冲突
				const existingIds = new Set(currentConfigs.map(c => c.id));
				const newConfigs = validConfigs
					.filter(c => !existingIds.has(c.id))
					.map(c => ({
						...c,
						id: generateConfigId() // 为导入的配置生成新 ID
					}));
				return [...currentConfigs, ...newConfigs];
			}
		} catch (e) {
			console.error('[ApiConfigManager] Import failed:', e);
			throw e;
		}
	}
}

/**
 * 全局 LLM API 管理器
 * 提供静态成员直接访问当前配置的 provider
 */
export class LlmApiManager {
	static config: LLMApiConfig;
	static uploadProvider: UploadProvider;
	static requestProvider: LlmRequestProvider;

	/**
	 * 初始化全局管理器
	 */
	static init(config: LLMApiConfig): void {
		this.config = config;

		// 创建上传 Provider
		if (config.fileUploadMethod === 'minimax') {
			this.uploadProvider = new MinimaxFUP();
		} else if (config.fileUploadMethod === 'requesturl') {
			this.uploadProvider = new RequestUrlFUP();
		} else {
			this.uploadProvider = new OpenAIFUP();
		}

		// 创建请求 Provider
		if (config.requestMethod === 'minimax') {
			this.requestProvider = new MinimaxRequestProvider();
		} else if (config.requestMethod === 'requesturl') {
			this.requestProvider = new RequestUrlRequestProvider();
		} else {
			this.requestProvider = new OpenAIRequestProvider();
		}
	}

	static async request(input: ResponsesMessage[]): Promise<string> {
		return this.requestProvider.request(input);
	}
	
}
