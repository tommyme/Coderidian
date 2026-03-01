// 内容块类型
export type ContentBlock = TextBlock | ImageBlock;

export interface TextBlock {
	type: 'text';
	content: string;
}

export interface ImageBlock {
	type: 'image';
	originalPath: string;      // 原始链接文本
	originalFullMatch: string; // 原始完整匹配（![[...]] 或 ![...](...)）
	index: number;             // 第几张图片（0开始）
	vaultPath?: string;       // vault 相对路径
	absolutePath?: string;    // 本地绝对路径
	fileUrl?: string;         // file:// 协议 URL
	position?: {
		start: { offset: number; line: number };
		end: { offset: number; line: number };
	};
}

// 解析结果
export interface ParsedNote {
	content: string;           // 完整原文
	contentWithPlaceholders: string;  // 图片替换为「图片一」等占位符的内容
	blocks: ContentBlock[];
	images: ImageBlock[];     // 单独的图片列表，按顺序
}

// 豆包 API 请求类型
export interface DoubaoApiRequest {
	model: string;
	input: Array<{
		role: 'system' | 'user';
		content: Array<DoubaoContentItem>;
	}>;
}

export type DoubaoContentItem = InputImage | InputText;

export interface InputImage {
	type: 'input_image';
	image_url: string;
}

export interface InputText {
	type: 'input_text';
	text: string;
}

// 豆包 API 响应类型（新格式）
export interface DoubaoApiResponse {
	created_at: number;
	id: string;
	model: string;
	object: 'response';
	output: Array<{
		id: string;
		type: 'reasoning' | 'message';
		role?: 'assistant';
		status: 'completed';
		summary?: Array<{
			type: 'summary_text';
			text: string;
		}>;
		content?: Array<{
			type: 'output_text';
			text: string;
		}>;
	}>;
	status: 'completed';
	usage: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
	};
}

// OpenAI 兼容的 Chat Completions 类型
export interface OpenAIChatRequest {
	model: string;
	messages: Array<OpenAIChatMessage>;
	max_tokens?: number;
	temperature?: number;
}

export interface OpenAIChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string | Array<OpenAIContentPart>;
}

export type OpenAIContentPart = TextContentPart | ImageContentPart;

export interface TextContentPart {
	type: 'text';
	text: string;
}

export interface ImageContentPart {
	type: 'image_url';
	image_url: {
		url: string;
		detail?: 'low' | 'high' | 'auto';
	};
}

export interface OpenAIChatResponse {
	id: string;
	object: 'chat.completion';
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: {
			role: 'assistant';
			content: string;
		};
		finish_reason: string;
	}>;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}
