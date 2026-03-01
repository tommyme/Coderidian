import { App, Notice } from 'obsidian';
import {
	parseNote,
	VisionApiConfig,
	analyzeNote
} from './index';

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
	config: VisionApiConfig
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
		const aiAnalysis = await analyzeNote(app, parsedNote, config);

		// 3. 解析 AI 响应，提取每个图片的分析内容
		notice.setMessage('正在解析 AI 响应...');
		const imageAnalyses = parseAIAnalysis(aiAnalysis);

		// 4. 将分析内容插入到对应图片下方 - 从后往前，避免索引错乱
		notice.setMessage('正在更新笔记...');
		let newContent = parsedNote.content;

		// 从后往前处理，避免索引错乱
		for (let i = parsedNote.images.length - 1; i >= 0; i--) {
			const img = parsedNote.images[i];
			const imageKey = `image-${i + 1}`;
			const analysis = imageAnalyses.get(imageKey);

			if (analysis && img.position) {
				// 用 > 格式包装内容
				const quotedContent = analysis
					.split('\n')
					.map(line => `> ${line}`)
					.join('\n');

				const insertText = `\n\n${quotedContent}`;
				const insertPos = img.position.end.offset;

				newContent =
					newContent.slice(0, insertPos) +
					insertText +
					newContent.slice(insertPos);
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
