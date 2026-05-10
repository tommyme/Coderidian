import {
	forceSimulation,
	forceLink,
	forceManyBody,
	forceCenter,
	forceCollide,
	Simulation,
	ForceLink,
	ForceManyBody,
} from 'd3-force';
import { App } from 'obsidian';
import { GraphData, GraphNode, GraphEdge } from './types';

const MIN_R = 2;
const MAX_R = 9;
const ARROW_LEN = 5;

interface SimNode extends GraphNode {
	x: number;
	y: number;
	fx?: number | null;
	fy?: number | null;
	r: number;
}

interface SimEdge {
	source: SimNode;
	target: SimNode;
	type: 'forward' | 'bidirectional';
}

let _uid = 0;

export class LocalGraphRenderer {
	private simulation: Simulation<SimNode, SimEdge> | null = null;
	private svgEl: SVGSVGElement | null = null;
	private readonly uid = ++_uid;
	private chargeForceFn: ForceManyBody<SimNode> | null = null;
	private linkForceFn: ForceLink<SimNode, SimEdge> | null = null;
	private viewState = { scale: 1, tx: 0, ty: 0 };
	private applyTransformFn: (() => void) | null = null;
	private settledBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

	constructor(
		private container: HTMLElement,
		private data: GraphData,
		private app: App,
		private onClickNode?: (nodeId: string) => void,
		private chargeStrength: number = -220,
		private linkDistance: number = 90,
		private onLayoutEnd?: (bounds: { minX: number; maxX: number; minY: number; maxY: number }) => void,
	) {}

	render(): void {
		this.destroy();

		const ns = 'http://www.w3.org/2000/svg';
		const width = Math.max(this.container.clientWidth, 300);
		const height = Math.max(this.container.clientHeight, 300);

		const lineCounts = this.data.nodes.map((n) => n.lineCount);
		const maxLC = Math.max(...lineCounts, 1);

		const simNodes: SimNode[] = this.data.nodes.map((n) => ({
			...n,
			x: width / 2 + (Math.random() - 0.5) * 120,
			y: height / 2 + (Math.random() - 0.5) * 120,
			r: MIN_R + (MAX_R - MIN_R) * (Math.log1p(n.lineCount) / Math.log1p(maxLC)),
		}));

		const nodeById = new Map(simNodes.map((n) => [n.id, n]));

		const simEdges: SimEdge[] = (this.data.edges as GraphEdge[])
			.map((e) => ({
				source: nodeById.get(e.source as string)!,
				target: nodeById.get(e.target as string)!,
				type: e.type,
			}))
			.filter((e) => e.source && e.target);

		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('width', '100%');
		svg.setAttribute('height', '100%');
		svg.style.display = 'block';
		this.svgEl = svg;

		// Arrow markers — one set per edge type
		const defs = document.createElementNS(ns, 'defs');
		const u = this.uid;
		defs.appendChild(this.makeArrow(ns, `cg-arr-out-${u}`,   false, 'cg-arrow-outlink'));
		defs.appendChild(this.makeArrow(ns, `cg-arr-in-${u}`,    false, 'cg-arrow-inlink'));
		defs.appendChild(this.makeArrow(ns, `cg-arr-bi-e-${u}`,  false, 'cg-arrow-bidir'));
		defs.appendChild(this.makeArrow(ns, `cg-arr-bi-s-${u}`,  true,  'cg-arrow-bidir'));
		defs.appendChild(this.makeArrow(ns, `cg-arr-neu-${u}`,   false, 'cg-arrow-neutral'));
		svg.appendChild(defs);

		// Viewport group (zoom/pan target)
		const g = document.createElementNS(ns, 'g');
		g.setAttribute('class', 'cg-viewport');
		svg.appendChild(g);

		const edgesG = document.createElementNS(ns, 'g');
		g.appendChild(edgesG);
		const nodesG = document.createElementNS(ns, 'g');
		g.appendChild(nodesG);

		// Build edge elements — classify by relationship to current node
		const getEdgeInfo = (edge: SimEdge) => {
			if (edge.type === 'bidirectional') return {
				cls: 'cg-edge-bidir',
				markerEnd: `url(#cg-arr-bi-e-${u})`,
				markerStart: `url(#cg-arr-bi-s-${u})`,
			};
			if (edge.source.isCurrent) return {
				cls: 'cg-edge-outlink',
				markerEnd: `url(#cg-arr-out-${u})`,
			};
			if (edge.target.isCurrent) return {
				cls: 'cg-edge-inlink',
				markerEnd: `url(#cg-arr-in-${u})`,
			};
			return {
				cls: 'cg-edge-neutral',
				markerEnd: `url(#cg-arr-neu-${u})`,
			};
		};

		const lineEls = simEdges.map((edge) => {
			const { cls, markerEnd, markerStart } = getEdgeInfo(edge);
			const line = document.createElementNS(ns, 'line');
			line.setAttribute('class', cls);
			line.setAttribute('marker-end', markerEnd);
			if (markerStart) line.setAttribute('marker-start', markerStart);
			edgesG.appendChild(line);
			return line;
		});

		// Build node elements
		const nodeEls = simNodes.map((node) => {
			const nodeG = document.createElementNS(ns, 'g');
			nodeG.setAttribute('class', 'cg-node');

			const circle = document.createElementNS(ns, 'circle');
			circle.setAttribute('r', String(node.r));
			circle.setAttribute('class', node.isCurrent ? 'cg-node-current' : 'cg-node-other');
			nodeG.appendChild(circle);

			const label = document.createElementNS(ns, 'text');
			label.setAttribute('class', 'cg-label');
			label.setAttribute('dy', String(node.r + 12));
			label.setAttribute('text-anchor', 'middle');
			label.textContent = node.label;
			nodeG.appendChild(label);

			nodesG.appendChild(nodeG);

			let hasDragged = false;
			circle.addEventListener('click', (e) => {
				if (hasDragged) { hasDragged = false; return; }
				e.stopPropagation();
				this.onClickNode?.(node.id);
			});

			return {
				el: nodeG,
				node,
				resetDrag: () => { hasDragged = false; },
				setDragged: () => { hasDragged = true; },
			};
		});

		// Zoom/pan state (stored on class for centerContent())
		this.viewState = { scale: 1, tx: 0, ty: 0 };
		const applyTransform = () => {
			g.setAttribute('transform', `translate(${this.viewState.tx},${this.viewState.ty}) scale(${this.viewState.scale})`);
		};
		this.applyTransformFn = applyTransform;

		svg.addEventListener('wheel', (e: WheelEvent) => {
			e.preventDefault();
			const rect = svg.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			const factor = e.deltaY < 0 ? 1.1 : 0.9;
			const newScale = Math.max(0.1, Math.min(10, this.viewState.scale * factor));
			this.viewState.tx = cx - (cx - this.viewState.tx) * (newScale / this.viewState.scale);
			this.viewState.ty = cy - (cy - this.viewState.ty) * (newScale / this.viewState.scale);
			this.viewState.scale = newScale;
			applyTransform();
		}, { passive: false });

		// Background pan
		svg.addEventListener('mousedown', (e: MouseEvent) => {
			if ((e.target as SVGElement).closest('.cg-node')) return;
			e.preventDefault();
			const startX = e.clientX - this.viewState.tx;
			const startY = e.clientY - this.viewState.ty;
			const onMove = (me: MouseEvent) => {
				this.viewState.tx = me.clientX - startX;
				this.viewState.ty = me.clientY - startY;
				applyTransform();
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});

		// Node drag (5px threshold to distinguish from click)
		nodeEls.forEach(({ el, node, resetDrag, setDragged }) => {
			el.addEventListener('mousedown', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
				resetDrag();
				const startX = e.clientX;
				const startY = e.clientY;
				node.fx = node.x;
				node.fy = node.y;
				this.simulation?.alphaTarget(0.3).restart();

				const onMove = (me: MouseEvent) => {
					const dx = me.clientX - startX;
					const dy = me.clientY - startY;
					if (Math.sqrt(dx * dx + dy * dy) > 5) setDragged();
					const rect = svg.getBoundingClientRect();
					node.fx = (me.clientX - rect.left - this.viewState.tx) / this.viewState.scale;
					node.fy = (me.clientY - rect.top - this.viewState.ty) / this.viewState.scale;
				};
				const onUp = () => {
					node.fx = null;
					node.fy = null;
					this.simulation?.alphaTarget(0);
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
				};
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
			});
		});

		// Force simulation
		this.linkForceFn = forceLink<SimNode, SimEdge>(simEdges)
			.id((d) => d.id)
			.distance(this.linkDistance)
			.strength(0.4);
		this.chargeForceFn = forceManyBody<SimNode>().strength(this.chargeStrength);

		const doTick = () => {
			simEdges.forEach((edge, i) => {
				const src = edge.source;
				const tgt = edge.target;
				const dx = (tgt.x ?? 0) - (src.x ?? 0);
				const dy = (tgt.y ?? 0) - (src.y ?? 0);
				const len = Math.sqrt(dx * dx + dy * dy) || 1;
				const line = lineEls[i];

				const startOffset = edge.type === 'bidirectional' ? src.r + ARROW_LEN : src.r;
				line.setAttribute('x1', String((src.x ?? 0) + (dx / len) * startOffset));
				line.setAttribute('y1', String((src.y ?? 0) + (dy / len) * startOffset));
				line.setAttribute('x2', String((tgt.x ?? 0) - (dx / len) * (tgt.r + ARROW_LEN)));
				line.setAttribute('y2', String((tgt.y ?? 0) - (dy / len) * (tgt.r + ARROW_LEN)));
			});
			nodeEls.forEach(({ el, node }) => {
				el.setAttribute('transform', `translate(${node.x ?? 0},${node.y ?? 0})`);
			});
		};

		this.simulation = forceSimulation<SimNode, SimEdge>(simNodes)
			.force('link', this.linkForceFn)
			.force('charge', this.chargeForceFn)
			.force('center', forceCenter<SimNode>(width / 2, height / 2))
			.force('collide', forceCollide<SimNode>().radius((d) => d.r + 5))
			.on('tick', doTick)   // used when simulation restarts (drag, updateLayout)
			.on('end', () => {    // used when simulation settles after drag/updateLayout
				if (!this.onLayoutEnd) return;
				const minX = Math.min(...simNodes.map(n => n.x - n.r));
				const maxX = Math.max(...simNodes.map(n => n.x + n.r));
				const minY = Math.min(...simNodes.map(n => n.y - n.r));
				const maxY = Math.max(...simNodes.map(n => n.y + n.r + 23));
				this.settledBounds = { minX, maxX, minY, maxY };
				this.onLayoutEnd(this.settledBounds);
			})
			.stop(); // prevent d3-timer from running asynchronously

		// Run all ticks synchronously so the graph is stable before first paint
		const N = Math.ceil(
			Math.log(this.simulation.alphaMin()) /
			Math.log(1 - this.simulation.alphaDecay()),
		);
		this.simulation.tick(N);
		doTick();

		// Immediately notify panel with settled bounds (no async delay)
		if (this.onLayoutEnd) {
			const minX = Math.min(...simNodes.map(n => n.x - n.r));
			const maxX = Math.max(...simNodes.map(n => n.x + n.r));
			const minY = Math.min(...simNodes.map(n => n.y - n.r));
			const maxY = Math.max(...simNodes.map(n => n.y + n.r + 23));
			this.settledBounds = { minX, maxX, minY, maxY };
			this.onLayoutEnd(this.settledBounds);
		}

		this.container.appendChild(svg);
	}

	private makeArrow(ns: string, id: string, reverseStart: boolean, cls = 'cg-arrow'): SVGMarkerElement {
		const marker = document.createElementNS(ns, 'marker');
		marker.setAttribute('id', id);
		marker.setAttribute('viewBox', '0 -5 10 10');
		marker.setAttribute('refX', '8');
		marker.setAttribute('refY', '0');
		marker.setAttribute('markerWidth', '6');
		marker.setAttribute('markerHeight', '6');
		marker.setAttribute('orient', reverseStart ? 'auto-start-reverse' : 'auto');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute('d', 'M0,-5L10,0L0,5');
		path.setAttribute('class', cls);
		marker.appendChild(path);
		return marker;
	}

	centerContent(areaW: number, areaH: number): void {
		if (!this.settledBounds || !this.applyTransformFn) return;
		const { minX, maxX, minY, maxY } = this.settledBounds;
		this.viewState.tx = areaW / 2 - (minX + maxX) / 2;
		this.viewState.ty = areaH / 2 - (minY + maxY) / 2;
		this.applyTransformFn();
	}

	updateLayout(chargeStrength: number, linkDistance: number): void {
		this.chargeStrength = chargeStrength;
		this.linkDistance = linkDistance;
		this.chargeForceFn?.strength(chargeStrength);
		this.linkForceFn?.distance(linkDistance);
		this.simulation?.alpha(0.5).restart();
	}

	destroy(): void {
		this.simulation?.stop();
		this.simulation = null;
		this.chargeForceFn = null;
		this.linkForceFn = null;
		this.applyTransformFn = null;
		this.settledBounds = null;
		this.svgEl?.remove();
		this.svgEl = null;
	}
}
