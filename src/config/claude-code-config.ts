/**
 * Claude Code 配置读取模块
 *
 * 从 ~/.claude/settings.json 读取 API 配置
 */

import { App } from 'obsidian';

/** Claude Code 配置接口 */
export interface ClaudeCodeEnvConfig {
	apiKey: string;
	apiEndpoint: string;
	model: string;
}

/**
 * 读取 Claude Code 配置（通过 shell 命令）
 */
export async function getClaudeCodeConfig(app: App): Promise<ClaudeCodeEnvConfig | null> {
	try {
		// 使用 shell 命令读取配置文件
		const { execSync } = require('child_process');
		const content = execSync('cat ~/.claude/settings.json', { encoding: 'utf-8' });
		const settings = JSON.parse(content);

		if (!settings.env) {
			console.warn('[ClaudeCode Config] No env section in settings.json');
			return null;
		}

		const { env } = settings;

		// 提取配置
		const apiKey = env.ANTHROPIC_AUTH_TOKEN || '';
		const apiEndpoint = env.ANTHROPIC_BASE_URL || '';
		const model = env.ANTHROPIC_MODEL || '';

		if (!apiKey || !apiEndpoint || !model) {
			console.warn('[ClaudeCode Config] Missing required env variables');
			return null;
		}

		console.log('[ClaudeCode Config] Loaded config:', {
			apiEndpoint,
			model,
			apiKey: apiKey.substring(0, 10) + '...'
		});

		return {
			apiKey,
			apiEndpoint,
			model
		};
	} catch (error) {
		console.error('[ClaudeCode Config] Error loading config:', error);
		return null;
	}
}
