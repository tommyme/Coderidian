import { App, TFile, requestUrl } from 'obsidian';
import { ParsedNote, AnalyzeSingleImageOptions, AnalyzeSingleImageResult } from '../types';
import { ResponsesContent, ResponsesMessage } from '../api/llm-api';
import {
	UploadProvider,
	UploadResult,
	OpenAIFileUploadProvider,
	OpenAIFileProviderConfig,
	CachedUploadProvider,
	CacheConfig
} from '../provider/upload';
import { LLMApiConfig, AnalyzeNoteOptions } from './analyze';

/**
 * 提取单张图片的上下文
 */
export function extractImageContext(
	parsedNote: ParsedNote,
	imageIndex: number,
	config: { beforeLines?: number; afterLines?: number } = {}
): { beforeText: string; afterText: string } {
	const { beforeLines = 30, afterLines = 30 } = config;
	const image = parsedNote.images[imageIndex];

	if (!image || !image.position) {
		return { beforeText: '', afterText: '' };
	}

	// 按行分割，提取图片前后的文本
	const lines = parsedNote.content.split('\n');
	const imageLine = image.position.start.line;

	const beforeText = lines
		.slice(Math.max(0, imageLine - beforeLines), imageLine)
		.join('\n');

	const afterText = lines
		.slice(imageLine + 1, imageLine + 1 + afterLines)
		.join('\n');

	return { beforeText, afterText };
}

/**
 * 构建单图分析的增强版提示词
 */
export function buildEnhancedSingleImagePrompt(
	fullContent: string,
	imageIndex: number,
	context: { beforeText: string; afterText: string }
): string {
	return `# 角色与任务
你是一个专业的图文内容深度分析专家。请结合文章的完整上下文，对指定的这张图片进行极其详尽的解析。

# 图片位置信息
- 图片标识：「image-${imageIndex + 1}」
- 图片前文：
${context.beforeText}

- 图片后文：
${context.afterText}

# 完整文章内容
<article_text>
${fullContent}
</article_text>

# 深度分析要求（增强版）
请对这张图片进行深度解析，包括但不限于：

1. **核心内容识别**
   - 这张图片展示了什么？（截图/图表/照片/插图/代码/架构图等）
   - 图片中的关键视觉元素有哪些？

2. **上下文关联分析**
   - 这张图片在文章中扮演什么角色？
   - 它是为了说明或佐证哪个观点？
   - 图片与前后文是如何呼应的？

3. **深度解读（如果是数据图表）**
   - 图表展示了什么数据趋势？
   - 有什么关键的峰值、谷值或拐点？
   - 能得出什么结论或洞察？

4. **技术解析（如果是技术架构图）**
   - 【一句话总结】这个架构的核心目标
   - 【核心组件】3-5 个关键模块的作用
   - 【数据流向】分步骤描述系统运转流程
   - 【设计亮点】为什么要这样设计？

5. **信息提取与双链化**
   - 识别图片中的关键概念、术语、人名、公司名、产品名
   - 将这些关键实体用 [[双链]] 格式标记

请直接输出你的深度分析内容，不要使用"# image-1"这样的标题。`;
}

/**
 * 构建单图分析的标准版提示词
 */
function buildStandardSingleImagePrompt(
	fullContent: string,
	imageIndex: number,
	context: { beforeText: string; afterText: string }
): string {
	return `请分析这张图片，结合文章上下文给出解读。`;
}

/**
 * 上传单张图片
 */
export async function uploadSingleImage(
	app: App,
	parsedNote: ParsedNote,
	imageIndex: number,
	provider?: UploadProvider,
	config?: LLMApiConfig
): Promise<UploadResult> {
	const image = parsedNote.images[imageIndex];

	if (!image) {
		throw new Error(`图片 image-${imageIndex + 1} 不存在`);
	}

	// 如果没有提供 provider，则创建默认的
	let uploadProvider = provider;
	if (!uploadProvider && config) {
		uploadProvider = createDefaultProvider(config);
	}

	if (!uploadProvider) {
		throw new Error('需要提供 uploadProvider 或 config');
	}

	const vaultPath = image.vaultPath;
	if (!vaultPath) {
		throw new Error(`图片 image-${imageIndex + 1} 没有 vaultPath`);
	}

	const targetFile = app.vault.getAbstractFileByPath(vaultPath);
	if (!targetFile || !(targetFile instanceof TFile)) {
		throw new Error(`图片 image-${imageIndex + 1} 文件不存在`);
	}

	const uploadResult = await uploadProvider.upload(app, targetFile);
	if (!uploadResult) {
		throw new Error(`图片 image-${imageIndex + 1} 上传失败`);
	}

	return uploadResult;
}

/**
 * 分析单张图片（使用已上传的图片）
 */
export async function analyzeImageWithUploadResult(
	parsedNote: ParsedNote,
	imageIndex: number,
	uploadResult: UploadResult,
	config: LLMApiConfig,
	options: { useEnhancedPrompt?: boolean } = {}
): Promise<string> {
	const { useEnhancedPrompt = true } = options;

	// 提取上下文
	const context = extractImageContext(parsedNote, imageIndex);

	// 构建提示词
	const systemPrompt = useEnhancedPrompt
		? buildEnhancedSingleImagePrompt(parsedNote.content, imageIndex, context)
		: buildStandardSingleImagePrompt(parsedNote.content, imageIndex, context);

	// 构建请求内容
	const userContent: ResponsesContent[] = [
		{ type: 'input_text', text: '以下是需要分析的图片：' }
	];

	if (uploadResult.type === 'file_id') {
		userContent.push({ type: 'input_image', file_id: uploadResult.id });
	} else if (uploadResult.type === 'url') {
		userContent.push({ type: 'input_image', image_url: uploadResult.id });
	}

	const input: ResponsesMessage[] = [
		{
			role: 'system',
			content: [{ type: 'input_text', text: systemPrompt }]
		},
		{
			role: 'user',
			content: userContent
		}
	];

	// 调用 API
	let analysisText = '';

	if (config.requestMethod === 'requesturl') {
		// 使用 requestUrl 方式调用
		analysisText = await callApiWithRequestUrl(config, input);
	} else {
		// 使用 OpenAI SDK 方式调用（默认）
		analysisText = await callApiWithOpenAI(config, input);
	}

	if (!analysisText) {
		throw new Error('API 返回格式异常');
	}

	return analysisText;
}

/**
 * 分析单张图片（带完整上下文）
 */
export async function analyzeSingleImage(
	app: App,
	parsedNote: ParsedNote,
	config: LLMApiConfig,
	options: AnalyzeSingleImageOptions,
	noteOptions?: AnalyzeNoteOptions
): Promise<AnalyzeSingleImageResult> {
	const { imageIndex, useEnhancedPrompt = true } = options;
	const image = parsedNote.images[imageIndex];

	if (!image) {
		throw new Error(`图片 image-${imageIndex + 1} 不存在`);
	}

	// 1. 初始化 Provider
	let provider = noteOptions?.uploadProvider ?? createDefaultProvider(config);
	if (noteOptions?.enableCache) {
		provider = new CachedUploadProvider(provider, noteOptions.cacheConfig);
	}

	// 2. 上传单张图片
	const uploadResult = await uploadSingleImage(app, parsedNote, imageIndex, provider);

	// 3. 分析图片
	const analysis = await analyzeImageWithUploadResult(
		parsedNote,
		imageIndex,
		uploadResult,
		config,
		{ useEnhancedPrompt }
	);

	return {
		imageIndex,
		analysis,
		uploadResult
	};
}

/**
 * 创建默认的 OpenAI 兼容文件上传 Provider
 * 如果 fileApiEndpoint 为空，则复用 apiEndpoint
 */
function createDefaultProvider(config: LLMApiConfig): UploadProvider {
	const fileEndpoint = config.fileApiEndpoint || config.apiEndpoint;
	const providerConfig: OpenAIFileProviderConfig = {
		apiKey: config.apiKey,
		apiEndpoint: fileEndpoint,
		maxRetries: 3,
		timeout: 30000
	};
	return new OpenAIFileUploadProvider(providerConfig);
}

/**
 * 使用 OpenAI SDK 调用 API
 */
async function callApiWithOpenAI(config: LLMApiConfig, input: ResponsesMessage[]): Promise<string> {
	const OpenAI = await import('openai');
	const baseUrl = config.apiEndpoint.replace(/\/responses$/, '');
	const openai = new OpenAI.default({
		apiKey: config.apiKey,
		baseURL: baseUrl,
		dangerouslyAllowBrowser: true
	});

	const response = await (openai as any).responses.create({
		model: config.model,
		input: input
	});

	// 提取结果
	let analysisText = '';
	if (response.output && response.output.length > 0) {
		for (const out of response.output) {
			if (out.type === 'message' && out.content && out.content.length > 0) {
				analysisText = out.content[0].text;
				break;
			}
		}
	}

	return analysisText;
}

/**
 * 使用 requestUrl 调用 API
 */
async function callApiWithRequestUrl(config: LLMApiConfig, input: ResponsesMessage[]): Promise<string> {
	// 构建请求体
	const requestBody = {
		model: config.model,
		input: input
	};
	// 使用 requestUrl
	const response = await window.requestUrl({
		url: config.apiEndpoint,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${config.apiKey}`
		},
		body: JSON.stringify(requestBody)
	});
	if (response.status !== 200) {
		const errorMsg = `API 请求失败: ${response.status} - ${response.text}`;
		console.error(response);
		throw new Error(errorMsg);
	}

	const result = response.json;

	// 提取结果
	let analysisText = '';
	if (result.output && result.output.length > 0) {
		for (const out of result.output) {
			if (out.type === 'message' && out.content && out.content.length > 0) {
				analysisText = out.content[0].text;
				break;
			}
		}
	}

	return analysisText;
}
