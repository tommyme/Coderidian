import { App, TFile } from 'obsidian';
import { UploadProvider, UploadResult } from '../provider/upload/base';
import { ImageBlock } from '../types';
import { LlmApiManager } from 'src/config/api-config-manager';

/**
 * 并行上传所有图片
 * 单个图片失败不会中断整体流程
 */
export async function uploadAllImages(
	app: App,
	images: ImageBlock[]
): Promise<UploadResult[]> {
	let provider = LlmApiManager.uploadProvider
	const uploadPromises: Array<Promise<UploadResult | null>> = [];

	for (const img of images) {
		if (!img.vaultPath) {
			uploadPromises.push(Promise.resolve(null));
			continue;
		}
		const targetFile = app.vault.getAbstractFileByPath(img.vaultPath);
		if (targetFile && targetFile instanceof TFile) {
			uploadPromises.push(
				provider.upload(app, targetFile)
					.catch(err => {
						console.warn(`图片 image-${img.index + 1} 上传失败:`, err);
						return null;
					})
			);
		} else {
			uploadPromises.push(Promise.resolve(null));
		}
	}

	const uploadResults = await Promise.all(uploadPromises);
	return uploadResults.filter((r): r is UploadResult => r !== null);
}
