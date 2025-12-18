export interface SchedulingMetrics {
	makespan: number;
	work: number;
	span: number;
	parallelism: number;
	speedup: number;
	efficiency: number;
	avg_utilization: number;
	min_utilization: number;
	max_utilization: number;
	load_imbalance: number;
	load_variance: number;
	max_worker_load: number;
	workers_used: number;
	idle_time: number;
	idle_percentage: number;
	communication_volume: number;
	locality_score: number;
	theoretical_min_makespan: number;
	approximation_ratio: number;
}

export function calculateSchedulingMetrics(
	workerSchedules: Record<number, number[]>,
	dependencies: Record<number, number[]>,
): SchedulingMetrics {
	const numWorkers = Object.keys(workerSchedules).length;
	if (numWorkers === 0) {
		return {
			makespan: 0, work: 0, span: 0, parallelism: 0, speedup: 0, efficiency: 0,
			avg_utilization: 0, min_utilization: 0, max_utilization: 0,
			load_imbalance: 0, load_variance: 0, max_worker_load: 0,
			workers_used: 0, idle_time: 0, idle_percentage: 0,
			communication_volume: 0, locality_score: 100,
			theoretical_min_makespan: 0, approximation_ratio: 1,
		};
	}
	const makespan = workerSchedules[Number(Object.keys(workerSchedules)[0])].length;
	const allTasks = new Set<number>();
	for (const sched of Object.values(workerSchedules)) for (const t of sched) if (t !== 0) allTasks.add(t);
	const work = allTasks.size;

	// span (longest path)
	const successors = new Map<number, number[]>();
	for (const t of allTasks) successors.set(t, []);
	for (const [tStr, deps] of Object.entries(dependencies)) {
		const t = Number(tStr);
		if (!allTasks.has(t)) continue;
		for (const d of deps) { if (allTasks.has(d)) successors.get(d)!.push(t); }
	}
	const memo = new Map<number, number>();
	const longest = (n: number): number => {
		if (memo.has(n)) return memo.get(n)!;
		const s = successors.get(n) || [];
		const v = s.length === 0 ? 1 : 1 + Math.max(...s.map(longest));
		memo.set(n, v); return v;
	};
	const span = work === 0 ? 0 : Math.max(...Array.from(allTasks).map(longest));

	const speedup = makespan > 0 ? work / makespan : 0;
	const efficiency = numWorkers > 0 ? speedup / numWorkers : 0;

	// utilization
	const workerLoads: number[] = [];
	const workerUtil: number[] = [];
	for (const sched of Object.values(workerSchedules)) {
		const load = sched.filter(t => t !== 0).length;
		workerLoads.push(load);
		workerUtil.push(makespan > 0 ? load / makespan : 0);
	}
	const avg_utilization = workerUtil.reduce((a, b) => a + b, 0) / workerUtil.length;
	const min_utilization = Math.min(...workerUtil);
	const max_utilization = Math.max(...workerUtil);
	const avg_load = workerLoads.reduce((a, b) => a + b, 0) / workerLoads.length;
	const load_imbalance = avg_load > 0 ? Math.max(...workerLoads) / avg_load : 0;
	const load_variance = (() => {
		const mean = avg_load; return workerLoads.reduce((s, x) => s + (x - mean) ** 2, 0) / workerLoads.length;
	})();
	const max_worker_load = Math.max(...workerLoads);

	// resources
	const workers_used = workerLoads.filter(l => l > 0).length;
	const idle_time = numWorkers * makespan - work;
	const idle_percentage = (numWorkers * makespan) > 0 ? (idle_time / (numWorkers * makespan)) * 100 : 0;

	// communication/locality
	const taskToWorker = new Map<number, number>();
	for (const [wStr, sched] of Object.entries(workerSchedules)) {
		const wid = Number(wStr);
		for (const t of sched) if (t !== 0) taskToWorker.set(t, wid);
	}
	let communication_volume = 0; let same_worker_deps = 0; let total_deps = 0;
	for (const [tStr, deps] of Object.entries(dependencies)) {
		const t = Number(tStr); if (!taskToWorker.has(t)) continue;
		for (const d of deps || []) {
			if (!taskToWorker.has(d)) continue; total_deps += 1;
			if (taskToWorker.get(t) === taskToWorker.get(d)) same_worker_deps += 1; else communication_volume += 1;
		}
	}
	const locality_score = total_deps > 0 ? (same_worker_deps / total_deps) * 100 : 100;

	const theoretical_min_makespan = Math.max(span, Math.ceil(work / numWorkers));
	const approximation_ratio = theoretical_min_makespan > 0 ? makespan / theoretical_min_makespan : 1;

	return {
		makespan, work, span, parallelism: span > 0 ? work / span : 0, speedup, efficiency,
		avg_utilization, min_utilization, max_utilization, load_imbalance, load_variance, max_worker_load,
		workers_used, idle_time, idle_percentage, communication_volume, locality_score,
		theoretical_min_makespan, approximation_ratio,
	};
}


