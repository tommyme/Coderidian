// Responses API 的内容项类型
export interface ResponsesContent {
	type: 'input_text' | 'input_image';
	text?: string;
	image_url?: string;
	file_id?: string;
}

export interface ResponsesMessage {
	role: 'system' | 'user';
	content: ResponsesContent[];
}
