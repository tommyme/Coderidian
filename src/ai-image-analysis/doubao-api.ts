import { App, TFile } from 'obsidian';
import OpenAI from 'openai';
import { ParsedNote } from './types';
import { uploadImageWithOpenAISDK } from './files-api';

export interface VisionApiConfig {
	apiKey: string;
	apiEndpoint: string;
	model: string;
}

export interface ImageAnalysisResult {
	imageIndex: number;
	analysis: string;
}

// 豆包 Responses API 的内容项类型
interface DoubaoInputContentItem {
	type: 'input_text' | 'input_image';
	text?: string;
	image_url?: string;
	file_id?: string;
}

interface DoubaoInputMessage {
	role: 'system' | 'user';
	content: DoubaoInputContentItem[];
}

/**
 * 分析笔记 - 使用 OpenAI SDK 的 client.responses.create
 */
export async function analyzeNote(
	app: App,
	parsedNote: ParsedNote,
	config: VisionApiConfig
): Promise<string> {
	const baseUrl = config.apiEndpoint.replace(/\/responses$/, '');

	const openai = new OpenAI({
		apiKey: config.apiKey,
		baseURL: baseUrl,
		dangerouslyAllowBrowser: true
	});

	// 1. 并行上传所有图片
	const uploadPromises: Array<Promise<{ index: number; fileId: string } | null>> = [];

	for (const img of parsedNote.images) {
		if (!img.vaultPath) {
			uploadPromises.push(Promise.resolve(null));
			continue;
		}
		const targetFile = app.vault.getAbstractFileByPath(img.vaultPath);
		if (targetFile && targetFile instanceof TFile) {
			uploadPromises.push(
				uploadImageWithOpenAISDK(app, targetFile, config.apiKey, config.apiEndpoint)
					.then(result => ({ index: img.index, fileId: result.id }))
			);
		} else {
			uploadPromises.push(Promise.resolve(null));
		}
	}

	const uploadResults = await Promise.all(uploadPromises);
	const uploadedFiles = uploadResults.filter((r): r is { index: number; fileId: string } => r !== null);

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
	- 判断该图片的信息量。如果图片仅为纯装饰性配图、与核心内容相关性弱或缺乏实质性信息量，请务必把解析内容填写为“ai-agent-建议删除”
	- 如果该图片为技术架构图，则详细展开分析：
		- 【一句话总结】：用通俗的语言概括这个架构图的核心目标或主要功能（例如：“这是一个高并发的电商抢购系统”）。
		- 【核心组件拆解】：不要罗列所有细节，挑出图中最核心的 3-5 个关键模块（如网关、数据库、消息队列等），用简单的类比解释它们各自扮演的角色。
		- 【数据/业务流向】：按照用户发起请求的顺序（或数据流动的顺序），分步骤描述系统是如何运转的。请使用“第一步...第二步...”的清晰格式。
		- 【设计亮点与价值】：指出这个架构设计的一两个明显优势（比如为什么用缓存、为什么做微服务拆分），告诉用户“为什么要这样设计”。
3. **输出格式要求**：
	- 必须使用 Markdown 格式输出。
	- 每张图片的解读必须独占一个一级标题（即 \`# 图片标识\`）下面不要再分更多的子标题。
	- 如果图片缺乏实质性信息量，请务必把解析内容填写为“ai-agent-建议删除”

${imageListText}
# 文章内容
<article_text>
${parsedNote.contentWithPlaceholders}
</article_text>`;

	// 3. 构建 user content
	const userContent: DoubaoInputContentItem[] = [];

	// 先添加文本说明
	userContent.push({
		type: 'input_text',
		text: '以下是文章中的真实图片，按顺序对应：'
	});

	// 按顺序添加每张图片 - 使用 file_id
	for (const img of parsedNote.images) {
		const uploaded = uploadedFiles.find(f => f.index === img.index);
		if (!uploaded) continue;
		userContent.push({
			type: 'input_image',
			file_id: uploaded.fileId
		});
	}

	const input: DoubaoInputMessage[] = [
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
	const response = await (openai as any).responses.create({
		model: config.model,
		input: input
	});

	console.log('豆包 Responses API 响应:', response);


	// 5. 从响应中提取输出 - 只取 message，忽略 reasoning
	if (response.output && response.output.length > 0) {
		for (const out of response.output) {
			if (out.type === 'message' && out.content && out.content.length > 0) {
				return out.content[0].text;
			}
		}
	}

	throw new Error('豆包 Responses API 返回格式异常');
}
