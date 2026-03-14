import { LLMApiConfig } from '../../actions/analyze';
import { ResponsesMessage } from '../../api/llm-api';

/**
 * LLM 请求 Provider 接口
 */
export interface LlmRequestProvider {
	TYPE_TEXT: string;
	/**
	 * 调用 LLM API
	 * @param config API 配置
	 * @param input 输入消息
	 * @returns API 返回的文本内容
	 */
	request(input: ResponsesMessage[]): Promise<string>;
}

/**
 * LLM 请求 Provider 抽象类 
 * 1. 根据输入发送请求
 * 2. 根据响应提取string
 */
export abstract class BaseLlmRequestProvider implements LlmRequestProvider {
	abstract request(input: ResponsesMessage[]): Promise<string>;

	/**
	 * 提取结果文本
	 */
	protected extractText(jsondata: any): string {
		let analysisText = '';
		if (jsondata.output && jsondata.output.length > 0) {
			for (const out of jsondata.output) {
				if (out.type === 'message' && out.content && out.content.length > 0) {
					analysisText = out.content[0].text;
					break;
				}
			}
		}
		return analysisText;
	}
}
