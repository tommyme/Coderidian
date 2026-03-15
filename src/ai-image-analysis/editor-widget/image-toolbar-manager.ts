import { App, MarkdownView, TFile, Notice } from 'obsidian';
import { parseNote } from '../provider/note-parser';

export interface ToolbarButton {
	id: string;
	icon: string;
	tooltip: string;
	action: (imageIndex: number, imagePath: string) => void;
}

const EMBED_SELECTOR = '.internal-embed.image-embed';
const HOVERED_CLASS = 'coderidian-embed-hovered';
const TOOLBAR_CLASS = 'coderidian-image-toolbar';
const STYLE_ID = 'coderidian-image-toolbar-style';

export class ImageToolbarManager {
	private app: App;
	private toolbar: HTMLElement;
	private buttons: ToolbarButton[];
	private pathToIndexMap: Map<string, number> = new Map();
	private currentFile: TFile | null = null;
	private currentEmbed: HTMLElement | null = null;
	private hideTimeout: number | null = null;
	private styleEl: HTMLStyleElement | null = null;

	// 事件监听引用
	private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
	private mutationObserver: MutationObserver | null = null;
	private viewContentEl: HTMLElement | null = null;

	// 追踪鼠标是否在"安全区域"内（图片或工具栏）
	private isMouseInSafeZone = false;

	constructor(app: App, buttons: ToolbarButton[]) {
		this.app = app;
		this.buttons = buttons;
		this.toolbar = this.createToolbar();
		this.injectStyles();
	}

	private injectStyles(): void {
		const oldStyle = document.getElementById(STYLE_ID);
		if (oldStyle) oldStyle.remove();

		this.styleEl = document.createElement('style');
		this.styleEl.id = STYLE_ID;
		this.styleEl.textContent = `
			.${HOVERED_CLASS} {
				anchor-name: --coderidian-active-image;
			}

			.${TOOLBAR_CLASS} {
				position: fixed;
				position-anchor: --coderidian-active-image;
				bottom: anchor(top);
				left: calc(anchor(left) + 4px);
				margin-bottom: 4px;
				position-try-fallbacks: flip-block;
				display: none;
				background: var(--background-primary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 8px;
				padding: 4px;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
				z-index: 9999;
				gap: 4px;
				box-sizing: border-box;
				align-items: center;
				white-space: nowrap;
			}

			.${TOOLBAR_CLASS}.visible {
				display: flex !important;
			}

			.${TOOLBAR_CLASS} button {
				background: transparent;
				border: none;
				padding: 6px 8px;
				cursor: pointer;
				border-radius: 4px;
				font-size: 16px;
				transition: background 0.15s;
				line-height: 1;
				display: flex;
				align-items: center;
				justify-content: center;
			}

			.${TOOLBAR_CLASS} button:hover {
				background: var(--background-modifier-hover);
			}
		`;
		document.head.appendChild(this.styleEl);
	}

	private createToolbar(): HTMLElement {
		const toolbar = document.createElement('div');
		toolbar.className = TOOLBAR_CLASS;

		for (const btnConfig of this.buttons) {
			const btn = this.createButton(btnConfig);
			toolbar.appendChild(btn);
		}

		return toolbar;
	}

	private createButton(btnConfig: ToolbarButton): HTMLElement {
		const btn = document.createElement('button');
		btn.innerHTML = btnConfig.icon;
		btn.title = btnConfig.tooltip;
		btn.setAttribute('aria-label', btnConfig.tooltip);

		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();

			const embed = this.currentEmbed;
			if (!embed) return;

			const imagePath = embed.getAttribute('src') || embed.getAttribute('alt');
			if (!imagePath) return;

			const imageIndex = this.pathToIndexMap.get(imagePath);
			if (imageIndex === undefined) {
				new Notice('无法确定图片索引');
				return;
			}

			btnConfig.action(imageIndex, imagePath);
		});

		return btn;
	}

	async attachToView(view: MarkdownView): Promise<void> {
		this.detach();

		const file = view.file;
		if (!file) return;

		this.currentFile = file;
		this.viewContentEl = view.contentEl;

		await this.refreshPathIndexMap(file);

		if (!this.toolbar.parentNode) {
			document.body.appendChild(this.toolbar);
		}

		// 使用 mousemove + 节流来检测鼠标位置
		// 这比 mouseenter/mouseleave 更可靠
		let lastCheck = 0;
		const THROTTLE_MS = 50;

		this.mouseMoveHandler = (e: MouseEvent) => {
			const now = Date.now();
			if (now - lastCheck < THROTTLE_MS) return;
			lastCheck = now;

			this.handleMouseMove(e);
		};

		// 在 document 级别监听，确保能捕获所有移动
		document.addEventListener('mousemove', this.mouseMoveHandler);

		// MutationObserver
		this.mutationObserver = new MutationObserver(() => {
			if (this.currentFile) {
				this.refreshPathIndexMap(this.currentFile).catch(() => {});
			}
		});
		this.mutationObserver.observe(view.contentEl, {
			childList: true,
			subtree: true
		});
	}

	/**
	 * 核心：统一处理鼠标移动
	 */
	private handleMouseMove(e: MouseEvent): void {
		const target = e.target as HTMLElement;

		// 检查鼠标是否在工具栏上
		const isOnToolbar = this.toolbar.contains(target);

		// 检查鼠标是否在某个图片 embed 上
		const embed = target.closest(EMBED_SELECTOR) as HTMLElement | null;
		const isOnEmbed = embed !== null;

		// 情况1：鼠标在工具栏上 - 保持当前状态，取消任何隐藏计划
		if (isOnToolbar) {
			this.clearHideTimeout();
			this.isMouseInSafeZone = true;
			return;
		}

		// 情况2：鼠标在图片上
		if (isOnEmbed && embed) {
			this.clearHideTimeout();
			this.isMouseInSafeZone = true;

			// 如果是新的图片，切换工具栏
			if (embed !== this.currentEmbed) {
				this.showToolbar(embed);
			}
			return;
		}

		// 情况3：鼠标既不在工具栏也不在图片上
		if (this.isMouseInSafeZone) {
			// 刚离开安全区域，启动延迟隐藏
			this.isMouseInSafeZone = false;
			this.scheduleHide();
		}
	}

	/**
	 * 计划隐藏工具栏
	 */
	private scheduleHide(): void {
		this.clearHideTimeout();
		this.hideTimeout = window.setTimeout(() => {
			this.hideToolbar();
		}, 250); // 250ms 足够用户移动到工具栏，但不会感觉迟钝
	}

	/**
	 * 清除隐藏计时器
	 */
	private clearHideTimeout(): void {
		if (this.hideTimeout !== null) {
			window.clearTimeout(this.hideTimeout);
			this.hideTimeout = null;
		}
	}

	private showToolbar(embed: HTMLElement): void {
		this.clearHideTimeout();

		// 移除其他图片的 hover 类
		document.querySelectorAll(`.${HOVERED_CLASS}`).forEach(el => {
			el.classList.remove(HOVERED_CLASS);
		});

		// 设置当前图片
		embed.classList.add(HOVERED_CLASS);
		this.currentEmbed = embed;

		// 显示工具栏
		this.toolbar.classList.add('visible');

		// Fallback 定位
		this.applyFallbackPositioning(embed);
	}

	private applyFallbackPositioning(embed: HTMLElement): void {
		const testEl = document.createElement('div');
		testEl.style.positionAnchor = '--test';
		// @ts-ignore
		testEl.style.positionTryFallbacks = 'flip-block';
		// @ts-ignore
		if (testEl.style.positionAnchor && testEl.style.positionTryFallbacks) {
			return;
		}

		const embedRect = embed.getBoundingClientRect();
		const toolbarHeight = 40;
		let left = embedRect.left + 4;
		let top = embedRect.top - toolbarHeight - 4;

		if (top < 0) {
			top = embedRect.bottom + 4;
		}
		if (left + 150 > window.innerWidth) {
			left = window.innerWidth - 150 - 10;
		}
		if (left < 0) left = 10;

		this.toolbar.style.left = `${left}px`;
		this.toolbar.style.top = `${top}px`;
		this.toolbar.style.bottom = 'auto';
		this.toolbar.style.positionAnchor = '';
		// @ts-ignore
		this.toolbar.style.positionTryFallbacks = '';
	}

	private hideToolbar(): void {
		this.clearHideTimeout();

		if (this.currentEmbed) {
			this.currentEmbed.classList.remove(HOVERED_CLASS);
			this.currentEmbed = null;
		}

		this.toolbar.classList.remove('visible');
	}

	detach(): void {
		this.clearHideTimeout();

		if (this.mouseMoveHandler) {
			document.removeEventListener('mousemove', this.mouseMoveHandler);
			this.mouseMoveHandler = null;
		}

		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}

		if (this.toolbar.parentNode) {
			this.toolbar.parentNode.removeChild(this.toolbar);
		}

		document.querySelectorAll(`.${HOVERED_CLASS}`).forEach(el => {
			el.classList.remove(HOVERED_CLASS);
		});

		this.currentEmbed = null;
		this.currentFile = null;
		this.viewContentEl = null;
		this.isMouseInSafeZone = false;
	}

	async refreshPathIndexMap(file: TFile): Promise<void> {
		this.pathToIndexMap.clear();

		try {
			const parsedNote = await parseNote(this.app, file);
			for (const img of parsedNote.images) {
				if (img.vaultPath) {
					this.pathToIndexMap.set(img.vaultPath, img.index);
				}
				if (img.originalPath) {
					this.pathToIndexMap.set(img.originalPath, img.index);
				}
			}
		} catch (err) {
			console.warn('刷新路径映射失败:', err);
		}
	}

	destroy(): void {
		this.detach();
		if (this.styleEl?.parentNode) {
			this.styleEl.parentNode.removeChild(this.styleEl);
		}
	}
}
