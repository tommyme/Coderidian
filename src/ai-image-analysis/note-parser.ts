import { App, TFile } from 'obsidian';
import { ContentBlock, TextBlock, ImageBlock, ParsedNote } from './types';

/**
 * 使用 Obsidian 原生 API 解析笔记
 * @param app Obsidian App 实例
 * @param file 当前笔记文件
 * @returns ParsedNote 解析结果
 */
export async function parseNote(app: App, file: TFile): Promise<ParsedNote> {
	const blocks: ContentBlock[] = [];
	const images: ImageBlock[] = [];

	// 1. 获取完整文件内容
	const content = await app.vault.cachedRead(file);

	// 2. 获取 metadata cache
	const cache = app.metadataCache.getFileCache(file);
	if (!cache || !cache.embeds || cache.embeds.length === 0) {
		// 如果没有 cache 或没有图片，就把整个内容作为一个文本块
		blocks.push({
			type: 'text',
			content: content
		});
		return { content, contentWithPlaceholders: content, blocks, images: [] };
	}

	// 3. 获取 vault 的绝对路径
	const basePath = (app.vault.adapter as any).getBasePath();

	// 4. 先收集所有 image blocks
	for (let i = 0; i < cache.embeds.length; i++) {
		const embed = cache.embeds[i];
		const imageIndex = i;

		// 从原文中截取图片的原始完整匹配（根据 position）
		const originalFullMatch = content.substring(
			embed.position.start.offset,
			embed.position.end.offset
		);

		// 解析图片链接
		const targetFile = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);

		const imageBlock: ImageBlock = {
			type: 'image',
			originalPath: embed.link,
			originalFullMatch: originalFullMatch,
			index: imageIndex,
			position: embed.position
		};

		if (targetFile && targetFile instanceof TFile) {
			imageBlock.vaultPath = targetFile.path;

			// 构建 file:// URL
			let fileUrl: string;
			if (process.platform === 'win32') {
				// Windows: basePath 是 C:\Users\...，转成 C:/Users/...
				const winPath = basePath.replace(/\\/g, '/');
				const fullPath = `${winPath}/${targetFile.path}`;
				fileUrl = `file:///${fullPath}`;
			} else {
				fileUrl = `file:///${basePath}/${targetFile.path}`;
			}
			imageBlock.fileUrl = fileUrl;
			imageBlock.absolutePath = fileUrl;
		}

		images.push(imageBlock);
	}

	// 5. 构建带占位符的内容，从后往前替换避免索引错乱
	let contentWithPlaceholders = content;
	for (let i = images.length - 1; i >= 0; i--) {
		const img = images[i];
		if (!img.position) continue;
		const placeholder = `「image-${i + 1}」`;
		contentWithPlaceholders =
			contentWithPlaceholders.slice(0, img.position.start.offset) +
			placeholder +
			contentWithPlaceholders.slice(img.position.end.offset);
	}

	// 6. 构建 blocks
	blocks.push({
		type: 'text',
		content: content
	});

	return { content, contentWithPlaceholders, blocks, images };
}
