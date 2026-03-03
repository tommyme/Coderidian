import { createHash } from 'crypto';
import { App, TFile } from 'obsidian';
import { UploadProvider, UploadResult } from './base';

/**
 * 缓存条目
 */
interface CacheEntry {
	/** 上传结果 */
	result: UploadResult;
	/** 过期时间戳（毫秒） */
	expiresAt: number;
}

/**
 * 缓存配置
 */
export interface CacheConfig {
	/** 缓存过期时间（毫秒），默认 1 小时 */
	ttl?: number;
}

/**
 * 带缓存的上传 Provider 包装器
 * 使用图片 MD5 作为缓存键，避免重复上传相同图片
 */
export class CachedUploadProvider implements UploadProvider {
	readonly name: string;

	private provider: UploadProvider;
	private cache: Map<string, CacheEntry> = new Map();
	private config: Required<CacheConfig>;

	constructor(provider: UploadProvider, config?: CacheConfig) {
		this.provider = provider;
		this.name = `cached-${provider.name}`;
		this.config = {
			ttl: config?.ttl ?? 60 * 60 * 1000 // 默认 1 小时
		};
	}

	/**
	 * 上传图片（带缓存）
	 */
	async upload(app: App, file: TFile): Promise<UploadResult> {
		// 先清理过期条目
		this.cleanupExpired();

		// 读取文件内容计算 MD5
		const buffer = await this.readFileAsBuffer(app, file);
		const md5 = this.computeMD5(buffer);

		// 检查缓存
		const cached = this.getFromCache(md5);
		if (cached) {
			console.log(`[CachedUploadProvider] 缓存命中: ${file.name} (MD5: ${md5})`);
			return cached;
		}

		// 缓存未命中，执行上传
		console.log(`[CachedUploadProvider] 缓存未命中，上传: ${file.name} (MD5: ${md5})`);
		const result = await this.provider.upload(app, file);

		// 存入缓存
		this.setCache(md5, result);

		return result;
	}

	/**
	 * 从 Buffer 上传图片（带缓存）
	 */
	async uploadBuffer(buffer: Buffer, filename: string): Promise<UploadResult> {
		if (!this.provider.uploadBuffer) {
			throw new Error(`Provider ${this.provider.name} does not support uploadBuffer`);
		}

		// 先清理过期条目
		this.cleanupExpired();

		// 计算 MD5
		const md5 = this.computeMD5(buffer);

		// 检查缓存
		const cached = this.getFromCache(md5);
		if (cached) {
			console.log(`[CachedUploadProvider] 缓存命中: ${filename} (MD5: ${md5})`);
			return cached;
		}

		// 缓存未命中，执行上传
		console.log(`[CachedUploadProvider] 缓存未命中，上传: ${filename} (MD5: ${md5})`);
		const result = await this.provider.uploadBuffer(buffer, filename);

		// 存入缓存
		this.setCache(md5, result);

		return result;
	}

	/**
	 * 清除所有缓存
	 */
	clearCache(): void {
		this.cache.clear();
		console.log(`[CachedUploadProvider] 缓存已清空`);
	}

	/**
	 * 获取缓存统计信息
	 */
	getCacheStats(): { size: number; keys: string[] } {
		return {
			size: this.cache.size,
			keys: Array.from(this.cache.keys())
		};
	}

	// ==================== 私有方法 ====================

	/**
	 * 从缓存获取
	 */
	private getFromCache(md5: string): UploadResult | null {
		const entry = this.cache.get(md5);
		if (!entry) {
			return null;
		}

		// 检查是否过期
		if (Date.now() > entry.expiresAt) {
			this.cache.delete(md5);
			return null;
		}

		return entry.result;
	}

	/**
	 * 设置缓存
	 */
	private setCache(md5: string, result: UploadResult): void {
		this.cache.set(md5, {
			result,
			expiresAt: Date.now() + this.config.ttl
		});
	}

	/**
	 * 计算 MD5
	 */
	private computeMD5(buffer: Buffer): string {
		return createHash('md5').update(buffer).digest('hex');
	}

	/**
	 * 读取 Obsidian 文件为 Buffer
	 */
	private async readFileAsBuffer(app: App, file: TFile): Promise<Buffer> {
		const arrayBuffer = await app.vault.readBinary(file);
		return Buffer.from(arrayBuffer);
	}

	/**
	 * 清理过期条目
	 */
	private cleanupExpired(): void {
		const now = Date.now();
		let removed = 0;

		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expiresAt) {
				this.cache.delete(key);
				removed++;
			}
		}

		if (removed > 0) {
			console.log(`[CachedUploadProvider] 清理了 ${removed} 个过期缓存条目`);
		}
	}
}
