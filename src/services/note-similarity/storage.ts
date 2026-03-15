import { Plugin } from 'obsidian';
import { EmbeddingStore } from './types';

/** 将 model ID 转为安全的文件名片段，如 "TaylorAI/bge-micro-v2" → "TaylorAI-bge-micro-v2" */
function modelToFilename(modelId: string): string {
	return modelId.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function getFilePath(plugin: Plugin, modelId: string): string {
	return `${plugin.app.vault.configDir}/plugins/coderidian/embeddings-${modelToFilename(modelId)}.json`;
}

export async function loadStore(plugin: Plugin, modelId: string): Promise<EmbeddingStore> {
	const path = getFilePath(plugin, modelId);
	try {
		const raw = await plugin.app.vault.adapter.read(path);
		const store = JSON.parse(raw) as EmbeddingStore;
		console.log(`[NoteSimilarity] loadStore model=${modelId} notes=${Object.keys(store.notes).length}`);
		return store;
	} catch {
		console.log(`[NoteSimilarity] loadStore model=${modelId} notes=0 (no file)`);
		return { modelId, notes: {} };
	}
}

export async function saveStore(plugin: Plugin, store: EmbeddingStore): Promise<void> {
	const path = getFilePath(plugin, store.modelId);
	const count = Object.keys(store.notes).length;
	console.log(`[NoteSimilarity] saveStore model=${store.modelId} notes=${count} path=${path}`);
	await plugin.app.vault.adapter.write(path, JSON.stringify(store));
	console.log(`[NoteSimilarity] saveStore done`);
}

/**
 * 带防抖的存储管理器
 * 高频更新时（如批量索引），每 500ms 最多写一次磁盘
 */
export class DebouncedStorage {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private dirty = false;

	constructor(
		private plugin: Plugin,
		private store: EmbeddingStore,
		private debounceMs = 500,
	) {}

	getStore(): EmbeddingStore {
		return this.store;
	}

	/** 仅标记脏位，不触发自动写盘（批量索引用：只在 flush 时真正落盘） */
	setDirty(): void {
		this.dirty = true;
	}

	/** 标记脏位并触发防抖写盘（实时单文件更新用） */
	markDirty(): void {
		this.dirty = true;
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			if (this.dirty) {
				this.dirty = false;
				saveStore(this.plugin, this.store).catch(console.error);
			}
		}, this.debounceMs);
	}

	/** 立即刷新（用于插件卸载时） */
	async flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.dirty) {
			this.dirty = false;
			await saveStore(this.plugin, this.store);
		}
	}
}
