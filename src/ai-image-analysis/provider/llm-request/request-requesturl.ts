import { LlmApiManager } from 'src/config/api-config-manager';
import { LLMApiConfig } from '../../actions/analyze';
import { ResponsesMessage } from '../../api/llm-api';
import { BaseLlmRequestProvider } from './base';

/**
 * RequestUrl LLM 请求 Provider
 */
export class RequestUrlRequestProvider extends BaseLlmRequestProvider {
	TYPE_TEXT = 'text'
	async request(input: ResponsesMessage[]): Promise<string> {
		const requestBody = {
			model: LlmApiManager.config.model,
			messages: input
		};

		const response = await window.requestUrl({
			url: LlmApiManager.config.apiEndpoint,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${LlmApiManager.config.apiKey}`
			},
			body: JSON.stringify(requestBody)
		});

		if (response.status !== 200) {
			const errorMsg = `API 请求失败: ${response.status} - ${response.text}`;
			console.error(response);
			throw new Error(errorMsg);
		}

		const result = response.json;
		return this.extractText(result);
	}
}
