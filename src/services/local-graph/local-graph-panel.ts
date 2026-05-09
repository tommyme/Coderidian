import { App, EventRef, TFile } from 'obsidian';
import { LocalGraphService } from './local-graph-service';
import { LocalGraphRenderer } from './local-graph-renderer';

function sparsityToForce(sparsity: number): { charge: number; distance: number } {
	const table: Record<number, [number, number]> = {
		1: [-80, 55],
		2: [-140, 70],
		3: [-220, 90],
		4: [-340, 115],
		5: [-500, 150],
	};
	const [charge, distance] = table[sparsity] ?? table[3];
	return { charge, distance };
}

export class LocalGraphPanel {
	private el: HTMLElement | null = null;
	private renderer: LocalGraphRenderer | null = null;
	private activeLeafRef: EventRef | null = null;
	private graphAreaEl: HTMLElement | null = null;
	private currentFile: TFile | null = null;
	private depth = 2;
	private sparsity = 3;
	private isPinned = false;

	constructor(
		private app: App,
		private service: LocalGraphService,
	) {}

	open(file?: TFile): void {
		if (this.el) {
			document.body.appendChild(this.el);
			return;
		}
		this.el = this.build();
		document.body.appendChild(this.el);

		this.registerFileWatch();

		const target = file ?? this.app.workspace.getActiveFile();
		if (target) this.renderGraph(target);
	}

	close(): void {
		if (this.isPinned) this.setAlwaysOnTop(false);
		this.renderer?.destroy();
		this.renderer = null;
		if (this.activeLeafRef) {
			this.app.workspace.offref(this.activeLeafRef);
			this.activeLeafRef = null;
		}
		this.el?.remove();
		this.el = null;
		this.graphAreaEl = null;
		this.currentFile = null;
		this.isPinned = false;
	}

	isOpen(): boolean {
		return this.el !== null;
	}

	private registerFileWatch(): void {
		if (this.activeLeafRef) return;
		this.activeLeafRef = this.app.workspace.on('active-leaf-change', () => {
			const f = this.app.workspace.getActiveFile();
			if (f && f !== this.currentFile) this.renderGraph(f);
		});
	}

	private async renderGraph(file: TFile): Promise<void> {
		if (!this.graphAreaEl) return;
		this.currentFile = file;
		this.renderer?.destroy();
		this.graphAreaEl.empty();

		const loading = this.graphAreaEl.createEl('p', {
			cls: 'coderidian-graph-loading',
			text: '正在加载图谱...',
		});

		try {
			const data = await this.service.buildGraph(file, this.depth);
			loading.remove();
			const { charge, distance } = sparsityToForce(this.sparsity);
			this.renderer = new LocalGraphRenderer(
				this.graphAreaEl,
				data,
				this.app,
				(nodeId) => this.navigateTo(nodeId, file.path),
				charge,
				distance,
			);
			this.renderer.render();
		} catch (err) {
			loading.textContent = `加载失败: ${err}`;
		}
	}

	private navigateTo(nodeId: string, sourcePath: string): void {
		const file = this.app.vault.getAbstractFileByPath(nodeId);
		if (file instanceof TFile) {
			this.app.workspace.openLinkText(file.basename, sourcePath, 'tab');
		}
	}

	private setAlwaysOnTop(flag: boolean): void {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { remote } = require('electron') as {
				remote: { getCurrentWindow(): { setAlwaysOnTop(f: boolean, level?: string): void } };
			};
			remote.getCurrentWindow().setAlwaysOnTop(flag, 'floating');
		} catch {
			// non-Electron environment, ignore
		}
	}

	private build(): HTMLElement {
		const panel = createEl('div', {
			cls: 'coderidian-float-panel coderidian-graph-panel',
		});

		this.makeResizable(panel);

		// ── Compact title bar ────────────────────────────────────────────────
		const titleBar = panel.createDiv({ cls: 'cg-panel-titlebar' });
		titleBar.createSpan({ cls: 'cg-panel-title', text: 'Local Graph' });

		const actions = titleBar.createDiv({ cls: 'cg-panel-actions' });

		const pinBtn = actions.createEl('button', { cls: 'cg-pin-btn', text: '📌' });
		pinBtn.setAttribute('aria-label', 'Pin window on top');
		pinBtn.addEventListener('click', () => {
			this.isPinned = !this.isPinned;
			pinBtn.toggleClass('cg-pin-active', this.isPinned);
			this.setAlwaysOnTop(this.isPinned);
			if (this.isPinned) {
				if (this.activeLeafRef) {
					this.app.workspace.offref(this.activeLeafRef);
					this.activeLeafRef = null;
				}
			} else {
				this.registerFileWatch();
			}
		});

		const closeBtn = actions.createEl('button', { cls: 'cg-close-btn', text: '✕' });
		closeBtn.setAttribute('aria-label', 'Close');
		closeBtn.addEventListener('click', () => this.close());

		// ── Body: graph area + controls ──────────────────────────────────────
		const body = panel.createDiv({ cls: 'coderidian-graph-panel-body' });

		this.graphAreaEl = body.createDiv({ cls: 'cg-graph-area' });
		this.setupPanelControls(body);

		this.makeDraggable(panel, titleBar, pinBtn, closeBtn);

		return panel;
	}

	private setupPanelControls(parent: HTMLElement): void {
		const controls = parent.createDiv({ cls: 'cg-controls' });

		const makeStepper = (
			container: HTMLElement,
			label: string,
			getValue: () => number,
			min: number,
			max: number,
			step: number,
			formatVal: (v: number) => string,
			onChange: (v: number) => void,
		): void => {
			container.createSpan({ cls: 'cg-ctrl-label', text: label });
			const dec = container.createEl('button', { cls: 'cg-ctrl-btn', text: '−' });
			const valEl = container.createSpan({ cls: 'cg-ctrl-val', text: formatVal(getValue()) });
			const inc = container.createEl('button', { cls: 'cg-ctrl-btn', text: '+' });
			const update = (e: MouseEvent, delta: number) => {
				e.stopPropagation();
				const next = Math.max(min, Math.min(max, getValue() + delta));
				if (next === getValue()) return;
				valEl.textContent = formatVal(next);
				onChange(next);
			};
			dec.addEventListener('click', (e) => update(e, -step));
			inc.addEventListener('click', (e) => update(e, +step));
		};

		const depthGroup = controls.createDiv({ cls: 'cg-ctrl-group' });
		makeStepper(depthGroup, 'Depth', () => this.depth, 1, 5, 1, String, async (v) => {
			this.depth = v;
			if (this.currentFile) await this.renderGraph(this.currentFile);
		});

		controls.createDiv({ cls: 'cg-ctrl-sep' });

		const spaceGroup = controls.createDiv({ cls: 'cg-ctrl-group' });
		makeStepper(spaceGroup, 'Spacing', () => this.sparsity, 1, 5, 1, String, (v) => {
			this.sparsity = v;
			const { charge, distance } = sparsityToForce(this.sparsity);
			this.renderer?.updateLayout(charge, distance);
		});
	}

	private anchorToRect(panel: HTMLElement, rect: DOMRect): void {
		panel.style.right = 'unset';
		panel.style.left = `${rect.left}px`;
		panel.style.top = `${rect.top}px`;
		panel.style.width = `${rect.width}px`;
		panel.style.height = `${rect.height}px`;
	}

	private makeDraggable(
		panel: HTMLElement,
		handle: HTMLElement,
		...skipTargets: HTMLElement[]
	): void {
		handle.addEventListener('mousedown', (e: MouseEvent) => {
			const t = e.target as HTMLElement;
			if (skipTargets.some((el) => el.contains(t))) return;
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
				const MIN_W = 300;
				const MIN_H = 200;
				const onMove = (me: MouseEvent) => {
					const dx = me.clientX - startX;
					const dy = me.clientY - startY;
					if (dir.includes('e')) panel.style.width = `${Math.max(MIN_W, width + dx)}px`;
					if (dir.includes('w')) {
						const nw = Math.max(MIN_W, width - dx);
						panel.style.width = `${nw}px`;
						panel.style.left = `${left + width - nw}px`;
					}
					if (dir.includes('s')) panel.style.height = `${Math.max(MIN_H, height + dy)}px`;
					if (dir.includes('n')) {
						const nh = Math.max(MIN_H, height - dy);
						panel.style.height = `${nh}px`;
						panel.style.top = `${top + height - nh}px`;
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
