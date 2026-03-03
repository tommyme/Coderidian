import { CalloutInfo } from '../types';

/**
 * AI 解析 Callout 块管理器
 * 处理 Obsidian 原生 Callout 格式: > [!AI] 🤖 AI 视觉解析
 */
export class AIAnalysisCalloutManager {
	private static readonly CALLOUT_TYPE = 'AI';
	private static readonly CALLOUT_TITLE = '🤖 AI 视觉解析';
	private static readonly CALLOUT_START_REGEX = /^>\s*\[!AI\]\s*/;
	private static readonly CALLOUT_LINE_REGEX = /^>\s*/;

	/**
	 * 将 AI 分析内容包装成 Callout 格式
	 */
	static wrapAnalysis(analysis: string): string {
		// 将内容转为引用块格式
		const quotedContent = analysis
			.split('\n')
			.map(line => `> ${line}`)
			.join('\n');

		return `\n\n> [!${this.CALLOUT_TYPE}] ${this.CALLOUT_TITLE}\n${quotedContent}`;
	}

	/**
	 * 从指定位置向后查找 AI Callout 块
	 * @param content 文档内容
	 * @param position 起始位置（通常是图片结束位置）
	 * @returns CalloutInfo 或 null
	 */
	static findCalloutAfterPosition(content: string, position: number): CalloutInfo | null {
		if (position >= content.length) {
			return null;
		}

		// 从 position 开始，先跳过空白字符
		let searchStart = position;
		while (searchStart < content.length && /\s/.test(content[searchStart])) {
			searchStart++;
		}

		if (searchStart >= content.length) {
			return null;
		}

		// 检查是否以 "> [!AI]" 开头
		const snippet = content.slice(searchStart, searchStart + 50);
		if (!snippet.startsWith(`> [!${this.CALLOUT_TYPE}]`)) {
			return null;
		}

		// 找到 Callout 块的起始行
		const lines = content.slice(searchStart).split('\n');
		let calloutStart = searchStart;
		let calloutEnd = searchStart;
		let inCallout = true;
		let currentOffset = 0;

		for (let i = 0; i < lines.length && inCallout; i++) {
			const line = lines[i];
			const lineLength = line.length + 1; // +1 for the newline

			if (i === 0) {
				// 第一行必须是 Callout 开始
				if (!this.CALLOUT_START_REGEX.test(line)) {
					return null;
				}
			} else if (this.CALLOUT_LINE_REGEX.test(line)) {
				// 继续是引用行，属于 Callout
			} else if (line.trim() === '') {
				// 空行，检查下一行是否还是引用，如果不是则结束
				// 先预读下一行
				if (i + 1 < lines.length && this.CALLOUT_LINE_REGEX.test(lines[i + 1])) {
					// 下一行还是引用，继续
				} else {
					inCallout = false;
					continue;
				}
			} else {
				// 非引用行，结束
				inCallout = false;
				continue;
			}

			calloutEnd = searchStart + currentOffset + lineLength;
			currentOffset += lineLength;
		}

		// 调整结束位置（去掉末尾多余的换行）
		while (calloutEnd > calloutStart && /\s/.test(content[calloutEnd - 1])) {
			calloutEnd--;
		}

		return {
			startOffset: calloutStart,
			endOffset: calloutEnd,
			type: this.CALLOUT_TYPE,
			title: this.CALLOUT_TITLE,
			content: content.slice(calloutStart, calloutEnd)
		};
	}

	/**
	 * 删除指定位置后的 AI Callout 块
	 * @returns 删除后的内容和偏移量变化
	 */
	static removeCalloutAfterPosition(content: string, position: number): {
		content: string;
		offsetDelta: number;
	} {
		const callout = this.findCalloutAfterPosition(content, position);
		if (!callout) {
			return { content, offsetDelta: 0 };
		}

		const newContent = content.slice(0, callout.startOffset) + content.slice(callout.endOffset);
		const offsetDelta = callout.endOffset - callout.startOffset;

		return { content: newContent, offsetDelta };
	}

	/**
	 * 在指定位置插入 AI 分析 Callout
	 * 会先删除已存在的旧 Callout
	 */
	static insertAnalysisAtPosition(
		content: string,
		analysis: string,
		insertPosition: number
	): string {
		// 先删除旧的 Callout
		const { content: contentWithoutOld, offsetDelta } = this.removeCalloutAfterPosition(content, insertPosition);

		// 计算实际插入位置
		let actualInsertPos = insertPosition;
		if (offsetDelta > 0 && insertPosition > offsetDelta) {
			actualInsertPos = insertPosition - offsetDelta;
		}

		const wrappedAnalysis = this.wrapAnalysis(analysis);

		return contentWithoutOld.slice(0, actualInsertPos) +
			wrappedAnalysis +
			contentWithoutOld.slice(actualInsertPos);
	}

	/**
	 * 检查指定位置后是否有 AI Callout
	 */
	static hasAnalysisAfterPosition(content: string, position: number): boolean {
		return this.findCalloutAfterPosition(content, position) !== null;
	}
}
