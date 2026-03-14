import { App } from 'obsidian';
import { ParsedNote } from '../types';
import { ResponsesMessage } from '../api/llm-api';
import {
	UploadProvider,
	uploadAllImages
} from '../provider/upload';
import {
	buildBatchAnalyzeSystemPrompt,
	buildBatchAnalyzeUserContent
} from '../provider/llm-request';
import { LlmApiManager } from '../../config/api-config-manager';

export type RequestMethod = 'openai' | 'requesturl' | 'minimax';
export type FileUploadMethod = 'openai' | 'requesturl' | 'minimax';

export interface LLMApiConfig {
	apiKey: string;
	apiEndpoint: string;
	fileApiEndpoint: string;
	model: string;
	requestMethod: RequestMethod;
	fileUploadMethod: FileUploadMethod;
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
 * 分析笔记 - 使用全局 LlmApiManager
 */
export async function analyzeNote(
	app: App,
	parsedNote: ParsedNote,
): Promise<AnalyzeNoteResult> {
	// 1. 并行上传所有图片（单个图片失败不会中断整体流程）
	const uploadedFiles = await uploadAllImages(app, parsedNote.images);

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

	// 2. 构建 prompt
	const systemPrompt = buildBatchAnalyzeSystemPrompt(parsedNote);
	const userContent = buildBatchAnalyzeUserContent(uploadedFiles);

	const input: ResponsesMessage[] = [
		{
			role: 'system',
			content: [
				{
					type: LlmApiManager.requestProvider.TYPE_TEXT,
					text: systemPrompt
				}
			]
		},
		...userContent
	];

	// 3. 调用 API - 使用全局管理器

	const analysisText = await LlmApiManager.request(input);

	return {
		analysis: analysisText,
		uploadStats
	};
}
