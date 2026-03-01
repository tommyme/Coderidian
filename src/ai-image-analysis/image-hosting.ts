import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { requestUrl } from 'obsidian';

const execPromise = promisify(exec);

/**
 * 上传图片到 ttl.sh
 * @param imageBuffer 图片二进制数据
 * @param fileName 文件名（可选）
 * @param ttl 过期时间，默认 1h
 * @returns 临时直链
 */
export async function uploadToTtlsh(
	imageBuffer: Buffer,
	fileName: string = `image-${Date.now()}.jpg`,
	ttl: string = '1h'
): Promise<string> {
	const tempFilePath = join(tmpdir(), fileName);

	try {
		// 写入临时文件
		await writeFile(tempFilePath, imageBuffer);

		// 上传到 ttl.sh
		const uploadUrl = `https://ttl.sh/${fileName}?ttl=${ttl}`;
		const { stdout } = await execPromise(`curl -T "${tempFilePath}" "${uploadUrl}"`);

		// 返回的 URL 就是 stdout 的内容
		const url = stdout.trim();

		if (!url) {
			throw new Error('上传 ttl.sh 失败，未返回 URL');
		}

		return url;
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
 * 从 URL 下载图片
 * @param url 图片 URL
 * @returns 图片二进制数据
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
 */
export function isExternalUrl(path: string): boolean {
	return path.startsWith('http://') || path.startsWith('https://');
}
