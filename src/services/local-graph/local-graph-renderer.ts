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

	constructor(
		private container: HTMLElement,
		private data: GraphData,
		private app: App,
		private onClickNode?: (nodeId: string) => void,
		private chargeStrength: number = -220,
		private linkDistance: number = 90,
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

		// Arrow markers
		const defs = document.createElementNS(ns, 'defs');
		defs.appendChild(this.makeArrow(ns, `cg-arr-end-${this.uid}`, false));
		defs.appendChild(this.makeArrow(ns, `cg-arr-start-${this.uid}`, true));
		svg.appendChild(defs);

		// Viewport group (zoom/pan target)
		const g = document.createElementNS(ns, 'g');
		g.setAttribute('class', 'cg-viewport');
		svg.appendChild(g);

		const edgesG = document.createElementNS(ns, 'g');
		g.appendChild(edgesG);
		const nodesG = document.createElementNS(ns, 'g');
		g.appendChild(nodesG);

		// Build edge elements
		const lineEls = simEdges.map((edge) => {
			const line = document.createElementNS(ns, 'line');
			line.setAttribute('class', 'cg-edge');
			line.setAttribute('marker-end', `url(#cg-arr-end-${this.uid})`);
			if (edge.type === 'bidirectional') {
				line.setAttribute('marker-start', `url(#cg-arr-start-${this.uid})`);
			}
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

		// Zoom/pan state
		const state = { scale: 1, tx: 0, ty: 0 };
		const applyTransform = () => {
			g.setAttribute('transform', `translate(${state.tx},${state.ty}) scale(${state.scale})`);
		};

		svg.addEventListener('wheel', (e: WheelEvent) => {
			e.preventDefault();
			const rect = svg.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			const factor = e.deltaY < 0 ? 1.1 : 0.9;
			const newScale = Math.max(0.1, Math.min(10, state.scale * factor));
			state.tx = cx - (cx - state.tx) * (newScale / state.scale);
			state.ty = cy - (cy - state.ty) * (newScale / state.scale);
			state.scale = newScale;
			applyTransform();
		}, { passive: false });

		// Background pan
		svg.addEventListener('mousedown', (e: MouseEvent) => {
			if ((e.target as SVGElement).closest('.cg-node')) return;
			e.preventDefault();
			const startX = e.clientX - state.tx;
			const startY = e.clientY - state.ty;
			const onMove = (me: MouseEvent) => {
				state.tx = me.clientX - startX;
				state.ty = me.clientY - startY;
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
					node.fx = (me.clientX - rect.left - state.tx) / state.scale;
					node.fy = (me.clientY - rect.top - state.ty) / state.scale;
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

		// Force simulation tick
		this.linkForceFn = forceLink<SimNode, SimEdge>(simEdges)
			.id((d) => d.id)
			.distance(this.linkDistance)
			.strength(0.4);
		this.chargeForceFn = forceManyBody<SimNode>().strength(this.chargeStrength);

		this.simulation = forceSimulation<SimNode, SimEdge>(simNodes)
			.force('link', this.linkForceFn)
			.force('charge', this.chargeForceFn)
			.force('center', forceCenter<SimNode>(width / 2, height / 2))
			.force('collide', forceCollide<SimNode>().radius((d) => d.r + 5))
			.on('tick', () => {
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
			});

		this.container.appendChild(svg);
	}

	private makeArrow(ns: string, id: string, reverseStart: boolean): SVGMarkerElement {
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
		path.setAttribute('class', 'cg-arrow');
		marker.appendChild(path);
		return marker;
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
		this.svgEl?.remove();
		this.svgEl = null;
	}
}
