/**
 * MIME 类型工具函数
 */

/**
 * 根据文件扩展名获取 MIME 类型
 */
export function getMimeType(extension: string): string {
	const ext = extension.toLowerCase();
	switch (ext) {
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'gif':
			return 'image/gif';
		case 'webp':
			return 'image/webp';
		case 'bmp':
			return 'image/bmp';
		case 'svg':
			return 'image/svg+xml';
		case 'ico':
			return 'image/x-icon';
		case 'tiff':
		case 'tif':
			return 'image/tiff';
		case 'heic':
			return 'image/heic';
		case 'heif':
			return 'image/heif';
		case 'avif':
			return 'image/avif';
		default:
			return 'image/png';
	}
}
