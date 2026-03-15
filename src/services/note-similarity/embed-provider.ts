import { requestUrl } from 'obsidian';
import { EmbeddingConfigItem } from './types';

/**
 * 内联 iframe connector：使用 dtype='fp32' 直接加载，跳过量化 ONNX。
 * 原因：量化 ONNX（q8/q4）对部分模型（如 Jina-zh）会产生全 NaN 向量，
 * 而 fp32 始终稳定，对本地推理来说也足够快。
 *
 * 注意：此字符串会被注入到 iframe 的 <script type="module"> 中，
 * 调用时须先将 '@huggingface/transformers' 替换为 CDN URL。
 */
const EMBED_IFRAME_SCRIPT = `
import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
if (typeof env.useBrowserCache !== 'undefined') env.useBrowserCache = true;

let pipe = null;

async function process_message({ method, params, id }) {
  try {
    let result;
    if (method === 'load') {
      // fp32 保证跨模型兼容，量化 ONNX（q8/q4）对部分模型会产生 NaN
      let device;
      try {
        if (navigator.gpu) {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) device = 'webgpu';
        }
      } catch (_) {}
      pipe = await pipeline('feature-extraction', params.model_key, {
        device: device,
        dtype: 'fp32',
        progress_callback: (p) => {
          window.parent.postMessage({ type: 'download_progress', data: p }, '*');
        },
      });
      result = { model_loaded: true };
    } else if (method === 'embed_batch') {
      if (!pipe) throw new Error('Model not loaded');
      const results = [];
      for (const item of params.inputs) {
        const output = await pipe(item.embed_input, { pooling: 'mean', normalize: true });
        const vec = Array.from(output.data).map(v => Math.round(v * 1e8) / 1e8);
        results.push({ vec });
      }
      result = results;
    } else {
      throw new Error('Unknown method: ' + method);
    }
    window.parent.postMessage({ id, result }, '*');
  } catch (e) {
    window.parent.postMessage({ id, error: e.message }, '*');
  }
}

window.addEventListener('message', async (e) => {
  await process_message(e.data);
});
`;

export interface EmbeddingProvider {
	readonly modelId: string;
	/** Max number of texts per batch call */
	readonly batchSize: number;
	/** Delay between batches in ms (for API rate limiting; 0 for local) */
	readonly batchDelayMs: number;
	embed(text: string): Promise<number[]>;
	embedBatch(texts: string[]): Promise<number[][]>;
	destroy?(): void;
}

/**
 * OpenAI 兼容的 Embedding Provider
 * 支持 OpenAI, SiliconFlow, 豆包等兼容 /v1/embeddings 的服务
 */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
	readonly modelId: string;
	readonly batchSize = 5;
	readonly batchDelayMs = 200;

	constructor(private config: EmbeddingConfigItem) {
		this.modelId = config.model;
	}

	async embed(text: string): Promise<number[]> {
		return (await this.embedBatch([text]))[0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const baseUrl = (this.config.baseUrl ?? '').replace(/\/$/, '');
		if (!baseUrl) {
			throw new Error(`[OpenAIEmbed] config "${this.config.name}" 缺少 Base URL`);
		}
		const response = await requestUrl({
			url: `${baseUrl}/v1/embeddings`,
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: this.config.model,
				input: texts,
			}),
		});

		if (response.status !== 200) {
			throw new Error(`Embedding API error ${response.status}: ${JSON.stringify(response.json)}`);
		}

		// OpenAI returns results sorted by index field
		return (response.json.data as Array<{ index: number; embedding: number[] }>)
			.sort((a, b) => a.index - b.index)
			.map((d) => d.embedding);
	}
}

/**
 * iframe 全局缓存：按 modelKey 保存已加载的 iframe 实例。
 * 切回同一个本地模型时直接复用，无需重新从 IndexedDB 加载权重。
 */
const iframeCache = new Map<string, {
	iframe: HTMLIFrameElement;
	pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
	msgId: number;
	msgListener: (e: MessageEvent) => void;
	/** 当前持有该 iframe 的 provider 实例，用于转发 onModelDownload 回调 */
	activeProvider: LocalEmbeddingProvider | null;
}>();

/**
 * 本地 Embedding Provider（无需 API Key）
 * 使用 @huggingface/transformers 在隐藏的 iframe 中运行
 * 模型首次使用时从 HuggingFace CDN 下载并缓存在 IndexedDB 中；
 * 切回同一模型时从全局 iframe 缓存复用，无需重新加载。
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
	readonly modelId: string;
	readonly batchSize = 16;
	readonly batchDelayMs = 0; // 本地模型无 rate limit

	onModelDownload?: (event: { status: string; file?: string }) => void;

	private loadPromise: Promise<void> | null = null;
	private loaded = false;

	constructor(modelKey: string) {
		this.modelId = modelKey;
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this._doLoad();
		return this.loadPromise;
	}

	private async _doLoad(): Promise<void> {
		// 复用已有 iframe（同一模型切回时）
		if (iframeCache.has(this.modelId)) {
			iframeCache.get(this.modelId)!.activeProvider = this;
			this.loaded = true;
			return;
		}

		const iframe = document.createElement('iframe');
		iframe.id = `coderidian-embed-iframe-${this.modelId}`;
		iframe.style.display = 'none';
		// NOTE: No sandbox attribute — sandbox blocks cross-origin CDN imports
		document.body.appendChild(iframe);

		const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
		let msgId = 0;

		const msgListener = (e: MessageEvent) => {
			const data = (e.data as Record<string, unknown>) ?? {};
			if (data.type === 'download_progress') {
				// 通过 activeProvider 转发，确保新实例的回调也能收到通知
				iframeCache.get(this.modelId)?.activeProvider?.onModelDownload?.(
					data.data as { status: string; file?: string },
				);
				return;
			}
			const { id, result, error } = data;
			if (typeof id !== 'string') return;
			const handler = pending.get(id as string);
			if (!handler) return;
			pending.delete(id as string);
			if (error) {
				handler.reject(new Error(String(error)));
			} else {
				handler.resolve(result);
			}
		};
		window.addEventListener('message', msgListener);

		iframeCache.set(this.modelId, { iframe, pending, msgId, msgListener, activeProvider: this });

		// Replace the bare package name with the CDN URL
		const scriptWithCdn = EMBED_IFRAME_SCRIPT.replace(
			'@huggingface/transformers',
			'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0',
		);

		iframe.srcdoc = `<html><body><script type="module">
${scriptWithCdn}
</script></body></html>`;

		await new Promise<void>((resolve) => {
			iframe.onload = () => resolve();
		});

		// Ask the iframe to load the model
		await this._send('load', { model_key: this.modelId });
		this.loaded = true;
	}

	async embed(text: string): Promise<number[]> {
		return (await this.embedBatch([text]))[0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		await this.load();
		const results = (await this._send('embed_batch', {
			inputs: texts.map((t) => ({ embed_input: t })),
		})) as Array<{ vec: number[] }>;
		return results.map((r) => r.vec);
	}

	private _send(method: string, params: unknown): Promise<unknown> {
		const entry = iframeCache.get(this.modelId);
		if (!entry?.iframe.contentWindow) {
			return Promise.reject(new Error('[LocalEmbed] iframe not ready'));
		}
		return new Promise((resolve, reject) => {
			const id = `msg_${entry.msgId++}`;
			entry.pending.set(id, { resolve, reject });
			entry.iframe.contentWindow!.postMessage({ method, params, id }, '*');
		});
	}

	/** 切换模型时调用：释放 onModelDownload 回调，但保留 iframe 供下次复用 */
	destroy(): void {
		this.onModelDownload = undefined;
		this.loaded = false;
		this.loadPromise = null;
		// 清除 activeProvider 引用，避免旧实例收到回调
		const entry = iframeCache.get(this.modelId);
		if (entry?.activeProvider === this) entry.activeProvider = null;
	}

	/** 插件卸载时调用：销毁所有缓存的 iframe */
	static destroyAll(): void {
		for (const [, entry] of iframeCache) {
			window.removeEventListener('message', entry.msgListener);
			entry.iframe.remove();
		}
		iframeCache.clear();
	}
}

/**
 * 豆包多模态 Embedding Provider
 * 接口路径：/v3/embeddings/multimodal
 * 输入格式：[{ type: 'text', text: string }]（仅文本，不传图片）
 */
export class DoubaoMultimodalEmbeddingProvider implements EmbeddingProvider {
	readonly modelId: string;
	readonly batchSize = 32;
	readonly batchDelayMs = 0;

	constructor(private config: EmbeddingConfigItem) {
		this.modelId = config.model;
	}

	async embed(text: string): Promise<number[]> {
		return (await this.embedBatch([text]))[0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const baseUrl = (this.config.baseUrl ?? '').replace(/\/$/, '');
		if (!baseUrl) {
			throw new Error(`[DoubaoEmbed] config "${this.config.name}" 缺少 Base URL`);
		}
		// 豆包多模态 API：整个 input 数组视为一个多模态文档，返回单个向量。
		// 必须每条文本单独发一次请求，但可以并行发出（RPM 15k，远高于实际用量）。
		// 使用 window.requestUrl 以便 HTTP interceptor 可以捕获请求用于调试
		const _requestUrl = (window as unknown as { requestUrl: typeof requestUrl }).requestUrl;
		return Promise.all(
			texts.map(async (text) => {
				const response = await _requestUrl({
					url: `${baseUrl}/v3/embeddings/multimodal`,
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${this.config.apiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: this.config.model,
						input: [{ type: 'text', text }],
					}),
				});

				if (response.status !== 200) {
					throw new Error(`[DoubaoEmbed] HTTP ${response.status}: ${JSON.stringify(response.json ?? response.text)}`);
				}

				return (response.json.data as { embedding: number[] }).embedding;
			}),
		);
	}
}

export function createEmbeddingProvider(config: EmbeddingConfigItem): EmbeddingProvider {
	// 兼容旧数据（providerType 字段可能缺失），根据 baseUrl 是否存在来推断类型
	const type = config.providerType ?? (config.baseUrl ? 'openai' : 'local');
	if (type === 'local') {
		return new LocalEmbeddingProvider(config.model);
	}
	if (!config.baseUrl) {
		throw new Error(`Embedding config "${config.name}" 缺少 Base URL`);
	}
	if (type === 'doubao-multimodal') {
		return new DoubaoMultimodalEmbeddingProvider(config);
	}
	return new OpenAICompatibleEmbeddingProvider(config);
}
