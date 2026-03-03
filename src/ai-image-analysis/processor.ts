import { App, Notice } from 'obsidian';
import {
	parseNote,
	LLMApiConfig,
	analyzeNote
} from './index';
import { AIAnalysisCalloutManager } from './editor-widget/callout-manager';

/**
 * 解析 AI 返回的 Markdown，提取每个图片的分析内容
 * 返回格式: { [imageKey: string]: string }
 */
function parseAIAnalysis(aiContent: string): Map<string, string> {
	const result = new Map<string, string>();
	const lines = aiContent.split('\n');

	let currentImageKey: string | null = null;
	let currentContent: string[] = [];

	for (const line of lines) {
		// 匹配一级标题: # image-1
		const headingMatch = line.match(/^#\s*(image-\d+)/);
		if (headingMatch) {
			// 保存之前的内容
			if (currentImageKey && currentContent.length > 0) {
				result.set(currentImageKey, currentContent.join('\n').trim());
			}
			currentImageKey = headingMatch[1];
			currentContent = [];
		} else if (currentImageKey) {
			// 收集当前图片的内容
			currentContent.push(line);
		}
	}

	// 保存最后一个图片的内容
	if (currentImageKey && currentContent.length > 0) {
		result.set(currentImageKey, currentContent.join('\n').trim());
	}

	return result;
}

/**
 * 处理当前笔记的主流程
 */
export async function processCurrentNote(
	app: App,
	config: LLMApiConfig
): Promise<void> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice('请先打开一个笔记');
		return;
	}

	if (!config.apiKey) {
		new Notice('请先在设置中配置 API Key');
		return;
	}

	const notice = new Notice('正在分析笔记...', 0);

	try {
		// 1. 解析笔记（使用 metadataCache）
		notice.setMessage('正在解析笔记...');
		const parsedNote = await parseNote(app, activeFile);

		if (parsedNote.images.length === 0) {
			notice.hide();
			new Notice('笔记中没有图片');
			return;
		}

		// 2. 调用 AI 分析 - 先上传图片
		notice.setMessage('正在上传图片...');
		const result = await analyzeNote(app, parsedNote, config);

		// 上传完成提示
		const { uploadStats, analysis: aiAnalysis } = result;
		if (uploadStats.failed > 0) {
			new Notice(`图片上传完成: ${uploadStats.success}/${uploadStats.total} 成功，${uploadStats.failed} 张失败`);
		} else {
			new Notice(`图片上传完成: ${uploadStats.success}/${uploadStats.total} 成功`);
		}

		// 没有图片成功上传的情况
		if (uploadStats.success === 0) {
			notice.hide();
			new Notice('没有图片成功上传，无法进行 AI 分析');
			return;
		}

		// 3. 开始 AI 分析
		notice.setMessage('正在调用 AI 分析图片...');
		new Notice('开始 AI 分析，请稍候...');

		// 4. 解析 AI 响应，提取每个图片的分析内容
		notice.setMessage('正在解析 AI 响应...');
		const imageAnalyses = parseAIAnalysis(aiAnalysis);

		// 5. 将分析内容插入到对应图片下方 - 从后往前，避免索引错乱
		notice.setMessage('正在更新笔记...');
		let newContent = parsedNote.content;

		// 从后往前处理，避免索引错乱
		for (let i = parsedNote.images.length - 1; i >= 0; i--) {
			const img = parsedNote.images[i];
			const imageKey = `image-${i + 1}`;
			const analysis = imageAnalyses.get(imageKey);

			if (analysis && img.position) {
				// 使用 Callout 管理器插入
				newContent = AIAnalysisCalloutManager.insertAnalysisAtPosition(
					newContent,
					analysis,
					img.position.end.offset
				);
			}
		}

		await app.vault.modify(activeFile, newContent);

		notice.hide();
		new Notice('笔记分析完成！');
	} catch (err) {
		notice.hide();
		console.error('分析笔记失败:', err);
		new Notice(`分析失败: ${err instanceof Error ? err.message : String(err)}`);
	}
}
