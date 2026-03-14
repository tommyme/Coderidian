import OpenAI from 'openai';
import { LlmApiManager } from 'src/config/api-config-manager';
import { ResponsesMessage } from '../../api/llm-api';
import { BaseLlmRequestProvider } from './base';

/**
 * OpenAI SDK LLM 请求 Provider
 */
export class OpenAIRequestProvider extends BaseLlmRequestProvider {
	TYPE_TEXT = 'input_text'
	async request(input: ResponsesMessage[]): Promise<string> {
		const baseUrl = LlmApiManager.config.apiEndpoint
		const openai = new OpenAI({
			apiKey: LlmApiManager.config.apiKey,
			baseURL: baseUrl,
			dangerouslyAllowBrowser: true
		});

		const response = await (openai as any).responses.create({
			model: LlmApiManager.config.model,
			input: input
		});

		return this.extractText(response);
	}
}
