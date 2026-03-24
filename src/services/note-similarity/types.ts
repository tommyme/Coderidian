export interface NoteChunk {
	vec: number[];
	/** chunk 文字前 80 字符，用于 UI 显示匹配片段 */
	preview: string;
	/** chunk 所属的标题文字（H1/H2/H3），用于点击后跳转定位 */
	heading?: string;
}

export interface NoteEmbedding {
	chunks: NoteChunk[];
	hash: string;
	updatedAt: number;
}

export interface EmbeddingStore {
	modelId: string;
	notes: Record<string, NoteEmbedding>;
}

export interface SimilarNote {
	path: string;
	score: number; // 0-1 cosine similarity
	/** 最匹配 chunk 的文字片段，用于 UI 显示"为什么相关" */
	matchedChunk?: string;
	/** 最匹配 chunk 所属的标题，用于点击后跳转到对应 section */
	matchedHeading?: string;
}

export interface EmbeddingConfigItem {
	id: string;
	name: string;
	providerType: 'openai' | 'local' | 'doubao-multimodal';
	// OpenAI-compatible fields (required when providerType === 'openai')
	baseUrl?: string;
	apiKey?: string;
	// For both: HuggingFace model key (local) or API model name (openai)
	model: string;
	/** Built-in presets cannot be deleted */
	isPreset?: boolean;
	/** 推荐场景说明，显示在 Settings UI */
	description?: string;
}
