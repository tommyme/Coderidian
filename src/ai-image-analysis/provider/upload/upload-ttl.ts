import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { App, TFile, requestUrl } from 'obsidian';
import { UploadProvider, UploadResult, TtlshProviderConfig } from './base';

const execPromise = promisify(exec);

/**
 * ttl.sh 图片上传 Provider
 * 将图片上传到 ttl.sh 获取临时直链
 */
export class TtlshUploadProvider implements UploadProvider {
	readonly name = 'ttl.sh';

	private config: Required<TtlshProviderConfig>;

	constructor(config?: TtlshProviderConfig) {
		this.config = {
			maxRetries: config?.maxRetries ?? 3,
			timeout: config?.timeout ?? 30000,
			ttl: config?.ttl ?? '1h'
		};
	}

	/**
	 * 从 Obsidian 文件上传
	 */
	async upload(app: App, file: TFile): Promise<UploadResult> {
		const buffer = await this.readFileAsBuffer(app, file);
		return this.uploadBuffer(buffer, file.name);
	}

	/**
	 * 从 Buffer 上传
	 */
	async uploadBuffer(buffer: Buffer, filename: string): Promise<UploadResult> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
			try {
				return await this.doUpload(buffer, filename);
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (attempt < this.config.maxRetries) {
					await this.delay(1000 * attempt);
				}
			}
		}

		throw lastError || new Error('上传失败');
	}

	/**
	 * 执行实际上传
	 */
	private async doUpload(buffer: Buffer, filename: string): Promise<UploadResult> {
		const tempFilePath = join(tmpdir(), this.sanitizeFilename(filename));

		try {
			// 写入临时文件
			await writeFile(tempFilePath, buffer);

			// 上传到 ttl.sh
			const uploadUrl = `https://ttl.sh/${encodeURIComponent(filename)}?ttl=${this.config.ttl}`;
			const { stdout } = await execPromise(`curl -T "${tempFilePath}" "${uploadUrl}"`, {
				timeout: this.config.timeout
			});

			const url = stdout.trim();
			if (!url) {
				throw new Error('ttl.sh 未返回 URL');
			}

			return {
				id: url,
				filename: filename,
				type: 'url'
			};
		} finally {
			// 清理临时文件
			try {
				await unlink(tempFilePath);
			} catch {
				// 忽略清理错误
			}
		}
	}

	/**
	 * 读取 Obsidian 文件为 Buffer
	 */
	private async readFileAsBuffer(app: App, file: TFile): Promise<Buffer> {
		const arrayBuffer = await app.vault.readBinary(file);
		return Buffer.from(arrayBuffer);
	}

	/**
	 * 清理文件名，避免路径问题
	 */
	private sanitizeFilename(filename: string): string {
		return filename.replace(/[^\w.\-]+/g, '_');
	}

	/**
	 * 延迟
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

/**
 * 从 URL 下载图片
 * @deprecated 使用 Provider 模式替代
 */
export async function downloadImage(url: string): Promise<Buffer> {
	const response = await requestUrl({
		url: url,
		method: 'GET'
	});

	return Buffer.from(response.arrayBuffer);
}

/**
 * 判断是否是外部 URL
 * @deprecated 移至 utils
 */
export function isExternalUrl(path: string): boolean {
	return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * 上传图片到 ttl.sh (函数式，保持向后兼容)
 * @deprecated 使用 TtlshUploadProvider 类替代
 */
export async function uploadToTtlsh(
	imageBuffer: Buffer,
	fileName: string = `image-${Date.now()}.jpg`,
	ttl: string = '1h'
): Promise<string> {
	const provider = new TtlshUploadProvider({ ttl });
	const result = await provider.uploadBuffer(imageBuffer, fileName);
	return result.id;
}
