import { LlmApiManager } from 'src/config/api-config-manager';
import { ResponsesMessage } from '../../api/llm-api';
import { RequestUrlRequestProvider } from './request-requesturl';

/**
 * RequestUrl LLM 请求 Provider
 */
export class MinimaxRequestProvider extends RequestUrlRequestProvider {
	TYPE_TEXT = 'text'

	extractText(jsondata: any): string {
		return jsondata.choices[0].message.content
	}
}
