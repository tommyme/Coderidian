import { App, TFile } from 'obsidian';
import OpenAI from 'openai';
import { ParsedNote } from '../types';
import { ResponsesContent, ResponsesMessage } from '../api/llm-api';
import {
	UploadProvider,
	UploadResult,
	OpenAIFileUploadProvider,
	OpenAIFileProviderConfig,
	CachedUploadProvider,
	CacheConfig
} from '../provider/upload';

export interface LLMApiConfig {
	apiKey: string;
	apiEndpoint: string;
	model: string;
}

export interface ImageAnalysisResult {
	imageIndex: number;
	analysis: string;
}

/**
 * analyzeNote 上传统计信息
 */
export interface UploadStats {
	/** 总图片数 */
	total: number;
	/** 上传成功数 */
	success: number;
	/** 上传失败数 */
	failed: number;
}

/**
 * analyzeNote 返回结果
 */
export interface AnalyzeNoteResult {
	/** AI 分析内容 */
	analysis: string;
	/** 上传统计 */
	uploadStats: UploadStats;
}

/**
 * analyzeNote 选项
 */
export interface AnalyzeNoteOptions {
	/** 自定义上传 Provider */
	uploadProvider?: UploadProvider;
	/** 是否启用上传缓存（默认 false） */
	enableCache?: boolean;
	/** 缓存配置（仅 enableCache=true 时有效） */
	cacheConfig?: CacheConfig;
}

/**
 * 分析笔记 - 使用可配置的 UploadProvider
 */
export async function analyzeNote(
	app: App,
	parsedNote: ParsedNote,
	config: LLMApiConfig,
	options?: UploadProvider | AnalyzeNoteOptions
): Promise<AnalyzeNoteResult> {
	// 解析参数（兼容旧版 API）
	let uploadProvider: UploadProvider | undefined;
	let enableCache = false;
	let cacheConfig: CacheConfig | undefined;

	if (options && 'name' in (options as any) && 'upload' in (options as any)) {
		// 旧版 API：直接传入 UploadProvider
		uploadProvider = options as UploadProvider;
	} else if (options) {
		// 新版 API：使用选项对象
		const opts = options as AnalyzeNoteOptions;
		uploadProvider = opts.uploadProvider;
		enableCache = opts.enableCache ?? false;
		cacheConfig = opts.cacheConfig;
	}

	// 默认使用豆包文件上传 Provider
	let provider = uploadProvider ?? createDefaultProvider(config);

	// 如果启用缓存，用 CachedUploadProvider 包装
	if (enableCache) {
		provider = new CachedUploadProvider(provider, cacheConfig);
	}

	// 1. 并行上传所有图片（单个图片失败不会中断整体流程）
	const uploadPromises: Array<Promise<{ index: number; result: UploadResult } | null>> = [];

	for (const img of parsedNote.images) {
		if (!img.vaultPath) {
			uploadPromises.push(Promise.resolve(null));
			continue;
		}
		const targetFile = app.vault.getAbstractFileByPath(img.vaultPath);
		if (targetFile && targetFile instanceof TFile) {
			uploadPromises.push(
				provider.upload(app, targetFile)
					.then(result => ({ index: img.index, result }))
					.catch(err => {
						console.warn(`图片 image-${img.index + 1} 上传失败:`, err);
						return null;
					})
			);
		} else {
			uploadPromises.push(Promise.resolve(null));
		}
	}

	const uploadResults = await Promise.all(uploadPromises);
	const uploadedFiles = uploadResults.filter((r): r is { index: number; result: UploadResult } => r !== null);

	// 记录上传统计
	const successCount = uploadedFiles.length;
	const totalCount = parsedNote.images.length;
	const failedCount = totalCount - successCount;
	console.log(`图片上传完成: ${successCount}/${totalCount} 成功`);

	const uploadStats: UploadStats = {
		total: totalCount,
		success: successCount,
		failed: failedCount
	};

	// 2. 构建 system 提示词
	let imageListText = '# 待分析的图片列表\n';
	for (const img of parsedNote.images) {
		imageListText += `- 「image-${img.index + 1}」\n`;
	}

	const systemPrompt = `# 角色与任务
你是一个专业的图文内容分析专家。接下来我会提供一篇包含多个图片占位符（如「image-1」）的完整文章。
你的任务是：结合文章的上下文语境，深度解读每张图片所传达的核心含义与作用。

# 执行指令
请严格按照以下步骤和规则进行分析：
1. **上下文推理**：精准定位每个图片占位符前后的文本，推断该图片展示的具体内容或数据。
2. **价值评估**：
	- 判断该图片的信息量。如果图片仅为纯装饰性配图、与核心内容相关性弱或缺乏实质性信息量，请务必把解析内容填写为"ai-agent-建议删除"
	- 如果该图片为技术架构图，则详细展开分析：
		- 【一句话总结】：用通俗的语言概括这个架构图的核心目标或主要功能（例如："这是一个高并发的电商抢购系统"）。
		- 【核心组件拆解】：不要罗列所有细节，挑出图中最核心的 3-5 个关键模块（如网关、数据库、消息队列等），用简单的类比解释它们各自扮演的角色。
		- 【数据/业务流向】：按照用户发起请求的顺序（或数据流动的顺序），分步骤描述系统是如何运转的。请使用"第一步...第二步..."的清晰格式。
		- 【设计亮点与价值】：指出这个架构设计的一两个明显优势（比如为什么用缓存、为什么做微服务拆分），告诉用户"为什么要这样设计"。
3. **输出格式要求**：
	- 必须使用 Markdown 格式输出。
	- 每张图片的解读必须独占一个一级标题（即 \`# 图片标识\`）下面不要再分更多的子标题。
	- 如果图片缺乏实质性信息量，请务必把解析内容填写为"ai-agent-建议删除"

${imageListText}
# 文章内容
<article_text>
${parsedNote.contentWithPlaceholders}
</article_text>`;

	// 3. 构建 user content
	const userContent: ResponsesContent[] = [];

	// 先添加文本说明
	userContent.push({
		type: 'input_text',
		text: '以下是文章中的真实图片，按顺序对应：'
	});

	// 按顺序添加每张图片
	for (const img of parsedNote.images) {
		const uploaded = uploadedFiles.find(f => f.index === img.index);
		if (!uploaded) continue;

		const { result } = uploaded;
		if (result.type === 'file_id') {
			userContent.push({
				type: 'input_image',
				file_id: result.id
			});
		} else if (result.type === 'url') {
			userContent.push({
				type: 'input_image',
				image_url: result.id
			});
		}
	}

	const input: ResponsesMessage[] = [
		{
			role: 'system',
			content: [
				{
					type: 'input_text',
					text: systemPrompt
				}
			]
		},
		{
			role: 'user',
			content: userContent
		}
	];

	console.log('豆包 Responses API 请求:', JSON.stringify({ model: config.model, input }, null, 2));

	// 4. 调用 client.responses.create
	const baseUrl = config.apiEndpoint.replace(/\/responses$/, '');
	const openai = new OpenAI({
		apiKey: config.apiKey,
		baseURL: baseUrl,
		dangerouslyAllowBrowser: true
	});

	const response = await (openai as any).responses.create({
		model: config.model,
		input: input
	});

	console.log('豆包 Responses API 响应:', response);


	// 5. 从响应中提取输出 - 只取 message，忽略 reasoning
	let analysisText = '';
	if (response.output && response.output.length > 0) {
		for (const out of response.output) {
			if (out.type === 'message' && out.content && out.content.length > 0) {
				analysisText = out.content[0].text;
				break;
			}
		}
	}

	if (!analysisText) {
		throw new Error('豆包 Responses API 返回格式异常');
	}

	return {
		analysis: analysisText,
		uploadStats
	};
}

/**
 * 创建默认的 OpenAI 兼容文件上传 Provider
 */
function createDefaultProvider(config: LLMApiConfig): UploadProvider {
	const providerConfig: OpenAIFileProviderConfig = {
		apiKey: config.apiKey,
		apiEndpoint: config.apiEndpoint,
		maxRetries: 3,
		timeout: 30000
	};
	return new OpenAIFileUploadProvider(providerConfig);
}
