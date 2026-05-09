import { Plugin, TFile, MarkdownPostProcessorContext } from 'obsidian';
import MyPlugin from '../main';
import { LocalGraphRenderer } from './local-graph/local-graph-renderer';

function parseGraphConfig(source: string): { depth: number; sparsity: number; height: number } {
	const depthMatch = source.match(/depth\s*:\s*(\d+)/);
	const sparsityMatch = source.match(/sparsity\s*:\s*(\d+)/);
	const heightMatch = source.match(/height\s*:\s*(\d+)/);
	return {
		depth: depthMatch ? parseInt(depthMatch[1], 10) : 2,
		sparsity: sparsityMatch ? Math.max(1, Math.min(5, parseInt(sparsityMatch[1], 10))) : 3,
		height: heightMatch ? Math.max(20, Math.min(100, parseInt(heightMatch[1], 10))) : 40,
	};
}

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

async function writeBackConfig(
	app: MyPlugin['app'],
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	depth: number,
	sparsity: number,
	height: number,
): Promise<void> {
	const info = ctx.getSectionInfo(el);
	if (!info) return;
	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) return;

	const content = await app.vault.read(file);
	const lines = content.split('\n');
	const newBlock = [
		lines[info.lineStart],
		`depth: ${depth}`,
		`sparsity: ${sparsity}`,
		`height: ${height}`,
		lines[info.lineEnd],
	];
	lines.splice(info.lineStart, info.lineEnd - info.lineStart + 1, ...newBlock);
	await app.vault.modify(file, lines.join('\n'));
}

export function registerCodeBlockProcessors(plugin: Plugin) {
	// Local Graph block: ```coderidian-graph
	const p = plugin as MyPlugin;
	plugin.registerMarkdownCodeBlockProcessor('coderidian-graph', async (source, el, ctx) => {
		const config = parseGraphConfig(source);

		const file = p.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(file instanceof TFile)) {
			el.createEl('p', { text: 'Cannot determine current file.', cls: 'coderidian-graph-loading' });
			return;
		}

		const canvas = el.createDiv({ cls: 'coderidian-graph-canvas' });
		const popoutBtn = canvas.createEl('button', { cls: 'coderidian-graph-popout-btn', text: '⤢' });
		const graphArea = canvas.createDiv({ cls: 'cg-graph-area' });

		let depth = config.depth;
		let sparsity = config.sparsity;
		let height = config.height;
		let renderer: LocalGraphRenderer | null = null;

		// Set initial height via aspect-ratio
		canvas.style.aspectRatio = `100 / ${height}`;

		async function buildAndRender(): Promise<void> {
			renderer?.destroy();
			graphArea.empty();
			const loading = graphArea.createEl('p', {
				cls: 'coderidian-graph-loading',
				text: '正在加载图谱...',
			});
			try {
				const data = await p.localGraphService.buildGraph(file, depth);
				loading.remove();
				const { charge, distance } = sparsityToForce(sparsity);
				renderer = new LocalGraphRenderer(
					graphArea,
					data,
					p.app,
					(nodeId) => {
						const target = p.app.vault.getAbstractFileByPath(nodeId);
						if (target instanceof TFile) {
							p.app.workspace.openLinkText(target.basename, ctx.sourcePath, 'tab');
						}
					},
					charge,
					distance,
				);
				renderer.render();
			} catch (err) {
				loading.textContent = `加载失败: ${err}`;
			}
		}

		await buildAndRender();
		popoutBtn.addEventListener('click', () => p.openLocalGraph(file));

		// Controls overlay at bottom of canvas
		const controls = canvas.createDiv({ cls: 'cg-controls' });

		function makeStepper(
			parent: HTMLElement,
			label: string,
			getValue: () => number,
			min: number,
			max: number,
			step: number,
			formatVal: (v: number) => string,
			onChange: (v: number) => void,
		): void {
			parent.createSpan({ cls: 'cg-ctrl-label', text: label });
			const dec = parent.createEl('button', { cls: 'cg-ctrl-btn', text: '−' });
			const valEl = parent.createSpan({ cls: 'cg-ctrl-val', text: formatVal(getValue()) });
			const inc = parent.createEl('button', { cls: 'cg-ctrl-btn', text: '+' });
			const update = (e: MouseEvent, delta: number) => {
				e.stopPropagation();
				const next = Math.max(min, Math.min(max, getValue() + delta));
				if (next === getValue()) return;
				valEl.textContent = formatVal(next);
				onChange(next);
			};
			dec.addEventListener('click', (e) => update(e, -step));
			inc.addEventListener('click', (e) => update(e, +step));
		}

		const depthGroup = controls.createDiv({ cls: 'cg-ctrl-group' });
		makeStepper(depthGroup, 'Depth', () => depth, 1, 5, 1, String, async (v) => {
			depth = v;
			await Promise.all([buildAndRender(), writeBackConfig(p.app, el, ctx, depth, sparsity, height)]);
		});

		controls.createDiv({ cls: 'cg-ctrl-sep' });

		const spaceGroup = controls.createDiv({ cls: 'cg-ctrl-group' });
		makeStepper(spaceGroup, 'Spacing', () => sparsity, 1, 5, 1, String, async (v) => {
			sparsity = v;
			const { charge, distance } = sparsityToForce(sparsity);
			renderer?.updateLayout(charge, distance);
			await writeBackConfig(p.app, el, ctx, depth, sparsity, height);
		});

		controls.createDiv({ cls: 'cg-ctrl-sep' });

		const heightGroup = controls.createDiv({ cls: 'cg-ctrl-group' });
		makeStepper(heightGroup, 'Height', () => height, 20, 100, 10, (v) => `${v}%`, async (v) => {
			height = v;
			canvas.style.aspectRatio = `100 / ${height}`;
			await writeBackConfig(p.app, el, ctx, depth, sparsity, height);
		});
	});


	plugin.registerMarkdownCodeBlockProcessor(`htmlx`, (source, el) => {
		const div = document.createElement("div");
		div.innerHTML = source;
		el.appendChild(div);
	});

	plugin.registerMarkdownCodeBlockProcessor(`hidden-js`, (source, el) => {
		const scriptEl = document.createElement("script");
		scriptEl.textContent = source;
		el.appendChild(scriptEl);

		const prompt = document.createElement("div");
		prompt.textContent = 'here is some hidden javascript code';
		el.appendChild(prompt);
	});

	plugin.registerMarkdownCodeBlockProcessor(`buttonjs`, (source, el) => {
		const lines = source.split('\n');
		const name = lines[0];
		const content = lines.slice(1).join('\n');

		const btn = document.createElement("button");
		btn.textContent = name;
		btn.addEventListener("click", () => eval(content));
		el.appendChild(btn);
	});
}
