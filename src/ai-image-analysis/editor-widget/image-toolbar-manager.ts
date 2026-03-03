import { App, MarkdownView, TFile, Notice } from 'obsidian';
import { parseNote } from '../note-parser';

/**
 * 工具栏按钮配置
 */
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

/**
 * 图片工具栏管理器
 * 使用 CSS Anchor Positioning 黑科技
 */
export class ImageToolbarManager {
	private app: App;
	private toolbar: HTMLElement;
	private buttons: ToolbarButton[];
	private pathToIndexMap: Map<string, number> = new Map();
	private currentFile: TFile | null = null;
	private currentEmbed: HTMLElement | null = null;
	private styleEl: HTMLStyleElement | null = null;

	// 事件监听引用，用于清理
	private mouseEnterHandler: ((e: MouseEvent) => void) | null = null;
	private mouseLeaveHandler: ((e: MouseEvent) => void) | null = null;
	private mutationObserver: MutationObserver | null = null;

	constructor(app: App, buttons: ToolbarButton[]) {
		this.app = app;
		this.buttons = buttons;
		this.toolbar = this.createToolbar();
		this.injectStyles();
	}

	/**
	 * 注入 CSS 样式
	 */
	private injectStyles(): void {
		// 移除旧的 style 元素
		const oldStyle = document.getElementById(STYLE_ID);
		if (oldStyle) oldStyle.remove();

		this.styleEl = document.createElement('style');
		this.styleEl.id = STYLE_ID;
		this.styleEl.textContent = `
			/* 给 hover 的图片容器定义锚点 */
			.${HOVERED_CLASS} {
				anchor-name: --coderidian-active-image;
			}

			/* 工具栏样式：fixed 定位 + anchor 跟随 */
			.${TOOLBAR_CLASS} {
				position: fixed;
				/* CSS Anchor Positioning - 锚定到图片 */
				position-anchor: --coderidian-active-image;
				/* 默认位置：工具栏底部对齐图片顶部 */
				bottom: anchor(top);
				left: calc(anchor(left) + 4px);
				margin-bottom: 4px;
				/* 黑科技：上方空间不足时自动翻转到下方 */
				position-try-fallbacks: flip-block;
				/*  fallback for browsers that don't support anchor */
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

			/* 当有 hovered 类时显示工具栏 */
			.${HOVERED_CLASS} ~ .${TOOLBAR_CLASS},
			.${TOOLBAR_CLASS}:hover {
				display: flex !important;
			}

			/* 工具栏按钮样式 */
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

	/**
	 * 创建工具栏 DOM
	 */
	private createToolbar(): HTMLElement {
		const toolbar = document.createElement('div');
		toolbar.className = TOOLBAR_CLASS;
		toolbar.style.display = 'none';

		// 添加按钮
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

	/**
	 * 绑定到 MarkdownView
	 */
	async attachToView(view: MarkdownView): Promise<void> {
		this.detach();

		const file = view.file;
		if (!file) return;

		this.currentFile = file;

		// 刷新路径-索引映射
		await this.refreshPathIndexMap(file);

		// 添加工具栏到 body
		if (!this.toolbar.parentNode) {
			document.body.appendChild(this.toolbar);
		}

		// 设置事件监听
		this.mouseEnterHandler = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const embed = target.closest(EMBED_SELECTOR) as HTMLElement | null;
			if (embed) {
				this.showToolbar(embed);
			}
		};

		this.mouseLeaveHandler = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const embed = target.closest(EMBED_SELECTOR) as HTMLElement | null;
			if (embed) {
				const relatedTarget = e.relatedTarget as HTMLElement | null;
				if (!relatedTarget || !(embed.contains(relatedTarget) || this.toolbar.contains(relatedTarget))) {
					this.hideToolbar(embed);
				}
			}
		};

		view.contentEl.addEventListener('mouseenter', this.mouseEnterHandler, true);
		view.contentEl.addEventListener('mouseleave', this.mouseLeaveHandler, true);

		// 工具栏自己的事件
		this.toolbar.addEventListener('mouseenter', () => {
			// 鼠标进入工具栏，保持显示
		});
		this.toolbar.addEventListener('mouseleave', (e) => {
			const relatedTarget = e.relatedTarget as HTMLElement | null;
			if (!relatedTarget || !relatedTarget.closest(EMBED_SELECTOR)) {
				if (this.currentEmbed) {
					this.hideToolbar(this.currentEmbed);
				}
			}
		});

		// 设置 MutationObserver 监听 DOM 变化
		this.mutationObserver = new MutationObserver(() => {
			// DOM 变化时刷新路径映射
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
	 * 显示工具栏
	 */
	private showToolbar(embed: HTMLElement): void {
		// 先移除其他图片的 hover 类
		const allEmbeds = embed.parentElement?.querySelectorAll(`.${HOVERED_CLASS}`);
		allEmbeds?.forEach(el => el.classList.remove(HOVERED_CLASS));

		// 给当前图片加 hover 类（定义锚点）
		embed.classList.add(HOVERED_CLASS);
		this.currentEmbed = embed;

		// 显示工具栏
		this.toolbar.style.display = 'flex';

		// Fallback：如果 CSS Anchor 不生效，用 JS 计算位置
		this.applyFallbackPositioning(embed);
	}

	/**
	 * Fallback：如果 CSS Anchor 不支持，用 JS 定位
	 */
	private applyFallbackPositioning(embed: HTMLElement): void {
		// 检查是否支持 CSS Anchor 和 position-try-fallbacks
		const testEl = document.createElement('div');
		testEl.style.positionAnchor = '--test';
		// @ts-ignore - position-try-fallbacks 是新属性
		testEl.style.positionTryFallbacks = 'flip-block';
		// @ts-ignore
		if (testEl.style.positionAnchor && testEl.style.positionTryFallbacks) {
			// 支持完整功能，不需要 fallback
			return;
		}

		// 不支持，用 JS 计算位置
		const embedRect = embed.getBoundingClientRect();
		let left = embedRect.left + 4;
		let top = embedRect.top - 40;

		if (top < 0) {
			top = embedRect.bottom + 4;
		}
		if (left + 150 > window.innerWidth) {
			left = window.innerWidth - 150 - 10;
		}
		if (left < 0) left = 10;

		this.toolbar.style.left = `${left}px`;
		this.toolbar.style.top = `${top}px`;
		// 清除 CSS anchor 相关属性，只用 JS 定位
		this.toolbar.style.positionAnchor = '';
		// @ts-ignore
		this.toolbar.style.positionTryFallbacks = '';
		this.toolbar.style.bottom = '';
	}

	/**
	 * 隐藏工具栏
	 */
	private hideToolbar(embed: HTMLElement): void {
		embed.classList.remove(HOVERED_CLASS);
		this.toolbar.style.display = 'none';
		if (this.currentEmbed === embed) {
			this.currentEmbed = null;
		}
	}

	/**
	 * 解绑
	 */
	detach(): void {
		// 移除事件监听
		if (this.mouseEnterHandler && this.currentFile) {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.contentEl) {
				view.contentEl.removeEventListener('mouseenter', this.mouseEnterHandler, true);
			}
		}
		if (this.mouseLeaveHandler && this.currentFile) {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.contentEl) {
				view.contentEl.removeEventListener('mouseleave', this.mouseLeaveHandler, true);
			}
		}

		// 断开 MutationObserver
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}

		// 移除工具栏
		if (this.toolbar.parentNode) {
			this.toolbar.parentNode.removeChild(this.toolbar);
		}

		// 移除所有 hover 类
		const allEmbeds = document.querySelectorAll(`.${HOVERED_CLASS}`);
		allEmbeds.forEach(el => el.classList.remove(HOVERED_CLASS));

		this.currentEmbed = null;
		this.currentFile = null;
		this.mouseEnterHandler = null;
		this.mouseLeaveHandler = null;
	}

	/**
	 * 更新路径-索引映射
	 */
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

	/**
	 * 销毁
	 */
	destroy(): void {
		this.detach();
		if (this.styleEl && this.styleEl.parentNode) {
			this.styleEl.parentNode.removeChild(this.styleEl);
		}
	}
}
