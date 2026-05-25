import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

export function smoothSelectionExtension() {
	return ViewPlugin.fromClass(
		class {
			private scrollRAF: number | null = null;
			private isSelecting = false;

			constructor(private view: EditorView) {
				this.attachListeners();
			}

			private attachListeners() {
				const dom = this.view.dom;
				dom.addEventListener('mousedown', this.onSelectStart, { passive: true });
				dom.addEventListener('keydown', this.onKeyDown, { passive: true });
				dom.addEventListener('mouseup', this.onSelectEnd, { passive: true });
				dom.addEventListener('keyup', this.onSelectEnd, { passive: true });
			}

			private onSelectStart = () => {
				this.isSelecting = true;
			};

			private onSelectEnd = () => {
				this.isSelecting = false;
				if (this.scrollRAF !== null) {
					cancelAnimationFrame(this.scrollRAF);
					this.scrollRAF = null;
				}
			};

			private onKeyDown = (e: KeyboardEvent) => {
				if (e.shiftKey) {
					this.isSelecting = true;
				}
			};

			update(update: ViewUpdate) {
				if (!this.isSelecting) return;
				if (!update.selectionSet) return;
				if (this.scrollRAF !== null) return;

				const scroller = this.view.scrollDOM;

				this.scrollRAF = requestAnimationFrame(() => {
					this.scrollRAF = null;

					const cursorPos = this.view.state.selection.main.head;

					try {
						const coords = this.view.coordsAtPos(cursorPos);
						if (!coords) return;

						const scrollRect = scroller.getBoundingClientRect();
						const MARGIN = 80;

						let deltaY = 0;
						if (coords.bottom > scrollRect.bottom - MARGIN) {
							deltaY = coords.bottom - scrollRect.bottom + MARGIN;
						} else if (coords.top < scrollRect.top + MARGIN) {
							deltaY = coords.top - scrollRect.top - MARGIN;
						}

						if (deltaY !== 0) {
							scroller.scrollBy({ top: deltaY, behavior: 'smooth' });
						}
					} catch {
						// coordsAtPos may throw when cursor is outside virtual viewport
					}
				});
			}

			destroy() {
				const dom = this.view.dom;
				dom.removeEventListener('mousedown', this.onSelectStart);
				dom.removeEventListener('keydown', this.onKeyDown);
				dom.removeEventListener('mouseup', this.onSelectEnd);
				dom.removeEventListener('keyup', this.onSelectEnd);
				if (this.scrollRAF !== null) {
					cancelAnimationFrame(this.scrollRAF);
				}
			}
		},
	);
}
