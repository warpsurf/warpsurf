import type { GraphData, GraphNode, GraphEdge } from './multiagent-types';

/**
 * Build a graph data structure for UI visualization from schedule + dependencies.
 * If durations and merged labels are provided, they will be included.
 */
export function buildGraphData(
	workerSchedules: Record<number, number[]>,
	dependencies: Record<number, number[]>,
	taskIdToTitle: Record<number, string>,
	durations?: Record<number, number>,
): GraphData {
	const nodesSet = new Set<number>();
	for (const sched of Object.values(workerSchedules)) for (const t of sched) if (t !== 0) nodesSet.add(t);
	for (const t of Object.keys(dependencies)) nodesSet.add(Number(t));
	for (const deps of Object.values(dependencies)) for (const d of deps) nodesSet.add(d);

	const nodes: GraphNode[] = Array.from(nodesSet).sort((a, b) => a - b).map(id => ({ id, label: taskIdToTitle[id] || String(id) }));
	const edges: GraphEdge[] = [];
	for (const [tStr, deps] of Object.entries(dependencies)) {
		const t = Number(tStr);
		for (const d of deps || []) edges.push({ from: d, to: t });
	}

	// Optional positions (simple lane x/y hints): x by earliest occurrence, y by worker
	const positions: Record<number, { x: number; y: number; width?: number }> = {};
	for (const [widStr, timeline] of Object.entries(workerSchedules)) {
		const wid = Number(widStr);
		for (let step = 0; step < timeline.length; step++) {
			const tid = timeline[step]; if (tid === 0) continue;
			if (!(tid in positions)) positions[tid] = { x: step, y: wid };
		}
	}
	// Width from durations if provided
	if (durations) {
		for (const [idStr, dur] of Object.entries(durations)) {
			const id = Number(idStr);
			if (positions[id]) positions[id].width = Math.max(1, Number(dur));
		}
	}

	return { nodes, edges, durations, positions };
}


