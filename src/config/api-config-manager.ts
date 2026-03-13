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

/** API 请求方式 */
export type RequestMethod = 'openai' | 'requesturl';

/** 单个 API 配置项 */
export interface ApiConfigItem {
	id: string;
	name: string;
	requestMethod: RequestMethod;
	apiKey: string;
	apiEndpoint: string;
	fileApiEndpoint: string;
	model: string;
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
		apiKey: '',
		apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/responses',
		fileApiEndpoint: '',
		model: 'doubao-seed-1-6-250815'
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
