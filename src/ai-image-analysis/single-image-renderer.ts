import { Editor } from 'obsidian';
import { AIAnalysisCalloutManager } from './editor-widget/callout-manager';
import { ParsedNote } from './types';

/**
 * 单图分析结果渲染器
 */
export class SingleImageRenderer {
	/**
	 * 将 AI 解析结果插入到编辑器中
	 */
	static insertAnalysis(
		editor: Editor,
		parsedNote: ParsedNote,
		imageIndex: number,
		analysis: string
	): void {
		const image = parsedNote.images[imageIndex];
		if (!image || !image.position) {
			throw new Error(`图片 image-${imageIndex + 1} 位置信息缺失`);
		}

		const content = editor.getValue();

		// 使用 Callout 管理器进行智能替换
		const newContent = AIAnalysisCalloutManager.insertAnalysisAtPosition(
			content,
			analysis,
			image.position.end.offset
		);

		// 保存光标位置
		const cursor = editor.getCursor();
		const selection = editor.getSelection();

		// 替换整个文档内容
		editor.setValue(newContent);

		// 尝试恢复光标位置
		// 注意：如果插入位置在光标之前，需要调整光标位置
		// 这里简化处理，先不做复杂的位置恢复
	}

	/**
	 * 检查图片是否已有解析
	 */
	static hasAnalysis(editor: Editor, parsedNote: ParsedNote, imageIndex: number): boolean {
		const image = parsedNote.images[imageIndex];
		if (!image || !image.position) {
			return false;
		}

		const content = editor.getValue();
		return AIAnalysisCalloutManager.hasAnalysisAfterPosition(content, image.position.end.offset);
	}
}
