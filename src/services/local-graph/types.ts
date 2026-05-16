import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';

export interface GraphNode extends SimulationNodeDatum {
	id: string;
	label: string;
	lineCount: number;
	isCurrent: boolean;
	r?: number;
	isExternal?: boolean;
	url?: string;
	isUnresolved?: boolean;
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
	source: string | GraphNode;
	target: string | GraphNode;
	type: 'forward' | 'bidirectional';
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface GraphConfig {
	depth: number;
}
