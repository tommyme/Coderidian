import { App } from 'obsidian';
import { ParsedNote, AnalyzeSingleImageOptions, AnalyzeSingleImageResult } from '../types';
import { ResponsesMessage } from '../api/llm-api';
import {
	UploadResult,
	uploadAllImages
} from '../provider/upload';
import {
	buildEnhancedSingleImagePrompt,
	buildSingleImageUserContent
} from '../provider/llm-request';
import { LLMApiConfig } from './analyze';
import { LlmApiManager } from '../../config/api-config-manager';

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
 * 分析单张图片（使用已上传的图片）
 */
export async function analyzeImageWithUploadResult(
	parsedNote: ParsedNote,
	imageIndex: number,
	uploadResult: UploadResult,
): Promise<string> {

	// 提取上下文
	// const context = extractImageContext(parsedNote, imageIndex);

	// 构建提示词
	const systemPrompt = buildEnhancedSingleImagePrompt(parsedNote, imageIndex)

	// 构建请求内容
	const userContent = buildSingleImageUserContent(uploadResult);

	const input: ResponsesMessage[] = [
		{
			role: 'system',
			content: [{ type: LlmApiManager.requestProvider.TYPE_TEXT, text: systemPrompt }]
		},
		...userContent
	];

	// 调用 API - 使用全局管理器
	return await LlmApiManager.request(input);
}

/**
 * 分析单张图片（带完整上下文）
 */
export async function analyzeSingleImage(
	app: App,
	parsedNote: ParsedNote,
	options: AnalyzeSingleImageOptions,
): Promise<AnalyzeSingleImageResult> {
	const { imageIndex, useEnhancedPrompt = true } = options;
	const image = parsedNote.images[imageIndex];

	if (!image) {
		throw new Error(`图片 image-${imageIndex + 1} 不存在`);
	}

	// 1. 上传单张图片
	const results = await uploadAllImages(app, [image]);
	if (results.length === 0) {
		throw new Error(`图片 image-${imageIndex + 1} 上传失败`);
	}
	const uploadResult = results[0];

	// 2. 分析图片
	const analysis = await analyzeImageWithUploadResult(
		parsedNote,
		imageIndex,
		uploadResult,
	);

	return {
		imageIndex,
		analysis,
		uploadResult
	};
}

