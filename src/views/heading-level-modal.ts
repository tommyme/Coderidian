import { App, Editor, Modal, Notice } from 'obsidian';
import { syntaxTree } from '@codemirror/language';

export class HeadingLevelModal extends Modal {
	private delta = 0;
	private deltaEl: HTMLElement;
	private editor: Editor;

	constructor(app: App, editor: Editor) {
		super(app);
		this.editor = editor;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', { text: '调整标题等级（↑/↓ 调节，Enter 确认，Esc 取消）' });

		this.deltaEl = contentEl.createEl('div', {
			text: this.deltaLabel(),
			cls: 'coderidian-heading-delta',
		});

		this.scope.register([], 'ArrowUp', (e) => {
			e.preventDefault();
			this.setDelta(this.delta + 1);
			return false;
		});
		this.scope.register([], 'ArrowDown', (e) => {
			e.preventDefault();
			this.setDelta(this.delta - 1);
			return false;
		});
		this.scope.register([], 'Enter', () => {
			const ok = this.apply();
			if (ok) this.close();
			return false;
		});
	}

	private setDelta(val: number) {
		this.delta = val;
		this.deltaEl.setText(this.deltaLabel());
	}

	private deltaLabel(): string {
		if (this.delta > 0) return `+${this.delta}`;
		if (this.delta < 0) return `${this.delta}`;
		return '0 (无变化)';
	}

	/** Returns true if applied successfully, false if validation failed (dialog stays open). */
	private apply(): boolean {
		if (this.delta === 0) return true;
		const editor = this.editor;
		const startLine = editor.somethingSelected()
			? editor.getCursor('from').line
			: editor.getCursor().line;
		const endLine = editor.somethingSelected()
			? editor.getCursor('to').line
			: editor.getCursor().line;

		const cmState: any = (editor as any).cm?.state;
		const tree = cmState ? syntaxTree(cmState) : null;

		const headingLines: { n: number; currentLevel: number; line: string }[] = [];
		for (let n = startLine; n <= endLine; n++) {
			const line = editor.getLine(n);
			const match = line.match(/^(#{1,6})(\s|$)/);
			if (!match) continue;

			if (tree && cmState) {
				try {
					// CM doc lines are 1-indexed; editor lines are 0-indexed
					const cmLine = cmState.doc.line(n + 1);
					let cur: any = tree.resolveInner(cmLine.from, 1);
					let isHeading = false;
					while (cur) {
						// Obsidian uses HyperMD parser: heading nodes are named "HyperMD-header_..."
						if (cur.name.includes('header')) { isHeading = true; break; }
						cur = cur.parent;
					}
					if (!isHeading) continue;
				} catch {
					// fall through: treat as heading (safe degradation)
				}
			}

			headingLines.push({ n, currentLevel: match[1].length, line });
		}

		if (headingLines.length === 0) return true;

		for (const { currentLevel } of headingLines) {
			const newLevel = currentLevel + this.delta;
			if (newLevel < 1) {
				new Notice(`无法调整：H${currentLevel} ${this.delta} = H${newLevel}，标题等级不能小于 1`);
				return false;
			}
			if (newLevel > 6) {
				new Notice(`无法调整：H${currentLevel} +${this.delta} = H${newLevel}，标题等级不能大于 6`);
				return false;
			}
		}

		editor.transaction({
			changes: headingLines.map(({ n, currentLevel, line }) => ({
				from: { line: n, ch: 0 },
				to:   { line: n, ch: line.length },
				text: '#'.repeat(currentLevel + this.delta) + line.slice(currentLevel),
			})),
		});
		return true;
	}

	onClose() {
		this.contentEl.empty();
	}
}
