import { App, Editor, Notice } from 'obsidian';

/**
 * Extract the content of the section starting at the heading on the given line.
 * Collects all lines from that heading until the next heading of equal or higher
 * level (fewer or equal `#` characters), or end of document.
 *
 * Returns null if the cursor line is not a heading.
 */
export function extractSectionContent(editor: Editor, lineNumber: number): string | null {
	const lineText = editor.getLine(lineNumber);
	const headingMatch = lineText.match(/^(#{1,6})\s/);
	if (!headingMatch) return null;

	const level = headingMatch[1].length;
	const lines: string[] = [lineText];
	const totalLines = editor.lineCount();

	for (let i = lineNumber + 1; i < totalLines; i++) {
		const line = editor.getLine(i);
		const nextHeading = line.match(/^(#{1,6})\s/);
		if (nextHeading && nextHeading[1].length <= level) {
			break;
		}
		lines.push(line);
	}

	return lines.join('\n');
}

/**
 * Translate the given markdown content.
 *
 * Currently a stub — returns the content unchanged.
 * Replace this function body with actual translation logic in the future.
 */
export async function translate(content: string): Promise<string> {
	return content;
}

/**
 * A floating panel that:
 * - stays on top (z-index) but does NOT block interaction with the editor
 * - does not close when clicking outside
 * - has selectable text
 * - is draggable via the title bar
 * - has a close button
 */
export class FloatingTranslationPanel {
	private el: HTMLElement;

	constructor(content: string) {
		this.el = this.build(content);
	}

	open() {
		document.body.appendChild(this.el);
	}

	close() {
		this.el.remove();
	}

	private build(content: string): HTMLElement {
		const panel = createEl('div', { cls: 'coderidian-float-panel' });

		// ── Resize handles (8 directions) ─────────────────────────────────
		this.makeResizable(panel);

		// ── Title bar (drag handle + close button) ────────────────────────
		const titleBar = panel.createDiv({ cls: 'coderidian-float-panel-titlebar' });
		titleBar.createSpan({ cls: 'coderidian-float-panel-title', text: 'Translation' });

		const closeBtn = titleBar.createEl('button', {
			cls: 'coderidian-float-panel-close',
			text: '✕',
		});
		closeBtn.setAttribute('aria-label', 'Close');
		closeBtn.addEventListener('click', () => this.close());

		// ── Content area ───────────────────────────────────────────────────
		const body = panel.createDiv({ cls: 'coderidian-float-panel-body' });
		body.createEl('pre', { cls: 'coderidian-float-panel-text', text: content });

		// ── Drag behaviour ─────────────────────────────────────────────────
		this.makeDraggable(panel, titleBar);

		return panel;
	}

	/** Anchor the panel to left/top coords, replacing the initial right anchor. */
	private anchorToRect(panel: HTMLElement, rect: DOMRect): void {
		panel.style.right = 'unset';
		panel.style.left = `${rect.left}px`;
		panel.style.top = `${rect.top}px`;
		panel.style.width = `${rect.width}px`;
		panel.style.height = `${rect.height}px`;
	}

	private makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
		handle.addEventListener('mousedown', (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest('.coderidian-float-panel-close')) return;
			e.preventDefault();

			const rect = panel.getBoundingClientRect();
			this.anchorToRect(panel, rect);

			const startX = e.clientX;
			const startY = e.clientY;
			const originLeft = rect.left;
			const originTop = rect.top;

			const onMove = (me: MouseEvent) => {
				panel.style.left = `${originLeft + me.clientX - startX}px`;
				panel.style.top = `${originTop + me.clientY - startY}px`;
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	private makeResizable(panel: HTMLElement): void {
		type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
		const dirs: Dir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

		for (const dir of dirs) {
			const handle = panel.createDiv({
				cls: `coderidian-float-resizer coderidian-float-resizer-${dir}`,
			});

			handle.addEventListener('mousedown', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();

				const rect = panel.getBoundingClientRect();
				this.anchorToRect(panel, rect);

				const startX = e.clientX;
				const startY = e.clientY;
				const { left, top, width, height } = rect;
				const MIN_W = 200;
				const MIN_H = 120;

				const onMove = (me: MouseEvent) => {
					const dx = me.clientX - startX;
					const dy = me.clientY - startY;

					if (dir.includes('e')) {
						panel.style.width = `${Math.max(MIN_W, width + dx)}px`;
					}
					if (dir.includes('w')) {
						const newW = Math.max(MIN_W, width - dx);
						panel.style.width = `${newW}px`;
						panel.style.left = `${left + width - newW}px`;
					}
					if (dir.includes('s')) {
						panel.style.height = `${Math.max(MIN_H, height + dy)}px`;
					}
					if (dir.includes('n')) {
						const newH = Math.max(MIN_H, height - dy);
						panel.style.height = `${newH}px`;
						panel.style.top = `${top + height - newH}px`;
					}
				};
				const onUp = () => {
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
				};
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
			});
		}
	}
}

/**
 * Open a floating translation panel for the section at the current cursor position.
 * Shows a Notice and returns early if the cursor is not on a heading line.
 */
export async function openSectionTranslationModal(app: App, editor: Editor): Promise<void> {
	const cursor = editor.getCursor();
	const content = extractSectionContent(editor, cursor.line);

	if (content === null) {
		new Notice('请将光标置于标题行（# 开头）');
		return;
	}

	const translated = await translate(content);
	new FloatingTranslationPanel(translated).open();
}
