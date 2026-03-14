import { ParsedNote } from "../../types";
import { UploadResult } from "../upload/base";
import { ResponsesMessage } from "../../api/llm-api";
import { LlmApiManager } from "src/config/api-config-manager";

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
 * 构建批量分析笔记的 system prompt
 */
export function buildBatchAnalyzeSystemPrompt(parsedNote: ParsedNote): string {
	// 构建图片列表
	let imageListText = '';
	for (const img of parsedNote.images) {
		imageListText += `- 「image-${img.index + 1}」\n`;
	}

	return `# 角色与任务
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

# 待分析的图片列表
${imageListText}
# 文章内容
<article_text>
${parsedNote.contentWithPlaceholders}
</article_text>`;
}

/**
 * 构建批量分析的 user content (告诉 llm 各个图片的id或者base64 data url)
 */
export function buildBatchAnalyzeUserContent(uploadedFiles: UploadResult[]): ResponsesMessage[] {
	const userContent: ResponsesMessage['content'] = [];

	// 先添加文本说明
	userContent.push({
		type: LlmApiManager.requestProvider.TYPE_TEXT,
		text: '以下是文章中的真实图片，按顺序对应：'
	});

	// 按顺序添加每张图片
	for (const uploaded of uploadedFiles) {
		userContent.push(LlmApiManager.uploadProvider.buildContent(uploaded));
	}

	return [
		{
			role: 'user',
			content: userContent
		}
	];
}

/**
 * 构建单图分析的 user content
 */
export function buildSingleImageUserContent(uploadResult: UploadResult): ResponsesMessage[] {
	const userContent: ResponsesMessage['content'] = [
		{ type: LlmApiManager.requestProvider.TYPE_TEXT, text: '以下是需要分析的图片：' },
		LlmApiManager.uploadProvider.buildContent(uploadResult)
	];


	return [
		{
			role: 'user',
			content: userContent
		}
	];
}
