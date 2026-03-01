import { ContentBlock, ImageBlock } from './types';

/**
 * 渲染包含 AI 解析的 Markdown
 * 使用 originalFullMatch 精准定位图片位置
 * @param originalMarkdown 原始 Markdown
 * @param blocks 解析后的内容块（包含 aiAnalysis）
 * @returns 新的 Markdown 内容
 */
export function renderMarkdownWithAnalysis(
	originalMarkdown: string,
	blocks: ContentBlock[]
): string {
	let result = originalMarkdown;

	// 收集所有有 AI 解析的图片，按从后往前的顺序处理（避免索引错乱）
	const imageBlocksWithAnalysis: ImageBlock[] = [];
	for (const block of blocks) {
		if (block.type === 'image' && block.aiAnalysis) {
			imageBlocksWithAnalysis.push(block as ImageBlock);
		}
	}

	// 从后往前处理，避免插入内容导致后续索引失效
	for (let i = imageBlocksWithAnalysis.length - 1; i >= 0; i--) {
		const imgBlock = imageBlocksWithAnalysis[i];

		// 找到这个图片在原始 Markdown 中的最后一次出现位置
		// （因为可能有重复图片，我们取最后一个匹配）
		let insertPos = -1;
		let searchPos = 0;
		while (true) {
			const pos = result.indexOf(imgBlock.originalFullMatch, searchPos);
			if (pos === -1) break;
			insertPos = pos;
			searchPos = pos + imgBlock.originalFullMatch.length;
		}

		if (insertPos !== -1) {
			// 在图片后面插入 AI 解析
			const insertAt = insertPos + imgBlock.originalFullMatch.length;

			// 构建 AI 解析块
			let analysisBlock = '\n\n> 🤖 AI 视觉解析：\n';
			const lines = imgBlock.aiAnalysis.split('\n');
			for (const line of lines) {
				analysisBlock += `> ${line}\n`;
			}

			result = result.slice(0, insertAt) + analysisBlock + result.slice(insertAt);
		}
	}

	return result;
}
