import type { TaskPlan, Subtask, WorkerSchedule } from './multiagent-types';
// TS ports of merging helpers for visualization/grouping

export interface MergeConsecutiveResult {
	dependenciesViz: Record<number, number[]>;
	groupTitles: Record<number, string>;
	durations: Record<number, number>;
	vizSchedules: Record<number, number[]>;
}

/** Build successors graph from dependencies */
function buildSuccessors(dependencies: Record<number, number[]>): Map<number, number[]> {
	const all = new Set<number>(Object.keys(dependencies).map(k => Number(k)));
	for (const deps of Object.values(dependencies)) for (const d of deps) all.add(d);
	const succ = new Map<number, number[]>();
	for (const t of all) succ.set(t, []);
	for (const [tStr, deps] of Object.entries(dependencies)) {
		const t = Number(tStr);
		for (const d of deps) succ.get(d)!.push(t);
	}
	return succ;
}

/** Compute start time and worker per task from schedules, and runs per worker */
function computeRuns(schedule: Record<number, number[]>) {
	const workerOf = new Map<number, number>();
	const startTime = new Map<number, number>();
	const runsPerWorker = new Map<number, Array<[number, number, number]>>();
	for (const [widStr, timeline] of Object.entries(schedule)) {
		const wid = Number(widStr);
		const runs: Array<[number, number, number]> = [];
		if (!timeline || timeline.length === 0) { runsPerWorker.set(wid, runs); continue; }
		let current = timeline[0]; let length = 1; let startIdx = 0;
		for (let i = 1; i < timeline.length; i++) {
			if (timeline[i] === current) { length++; }
			else {
				runs.push([current, length, startIdx]);
				if (current !== 0) { if (!startTime.has(current)) { startTime.set(current, startIdx); workerOf.set(current, wid); } }
				current = timeline[i]; startIdx = i; length = 1;
			}
		}
		runs.push([current, length, startIdx]);
		if (current !== 0) { if (!startTime.has(current)) { startTime.set(current, startIdx); workerOf.set(current, wid); } }
		runsPerWorker.set(wid, runs);
	}
	return { workerOf, startTime, runsPerWorker };
}

/**
 * Merge tasks only when executed consecutively by the same worker (adjacent runs) and dependency t2<-t1 exists,
 * with all preds of t2 and succs of t1 on same worker to avoid cross-worker merges.
 */
export function buildMergedGraphAfterScheduleConsecutive(
	dependencies: Record<number, number[]>,
	taskTitles: Record<number, string>,
	workerSchedules: Record<number, number[]>,
): MergeConsecutiveResult {
	const { workerOf, startTime, runsPerWorker } = computeRuns(workerSchedules);
	const successors = buildSuccessors(dependencies);
	// Union-Find
	const parent = new Map<number, number>();
	const find = (x: number): number => { if (!parent.has(x)) parent.set(x, x); const p = parent.get(x)!; if (p !== x) parent.set(x, find(p)); return parent.get(x)!; };
	const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };

	// Merge pairs
	for (const runs of runsPerWorker.values()) {
		for (let i = 0; i < runs.length - 1; i++) {
			const [t1, len1, start1] = runs[i];
			const [t2, , start2] = runs[i + 1];
			if (t1 === 0 || t2 === 0) continue;
			if (start2 !== start1 + len1) continue;
			if ((dependencies[t2] || []).includes(t1)) {
				const w = workerOf.get(t1);
				if (w === undefined || workerOf.get(t2) !== w) continue;
				if ((dependencies[t2] || []).some(p => workerOf.get(p) !== w)) continue;
				if ((successors.get(t1) || []).some(s => workerOf.get(s) !== w)) continue;
				union(t1, t2);
			}
		}
	}

	// Build groups
	const all = new Set<number>(Object.keys(dependencies).map(k => Number(k)));
	for (const deps of Object.values(dependencies)) for (const d of deps) all.add(d);
	const groups = new Map<number, number[]>();
	for (const t of all) { const r = find(t); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(t); }

	// Canonical id = earliest start time
	const groupIdOf = new Map<number, number>();
	for (const [root, members] of groups.entries()) {
		const canonical = members.slice().sort((a, b) => (startTime.get(a) ?? 1e9) - (startTime.get(b) ?? 1e9))[0];
		for (const m of members) groupIdOf.set(m, canonical);
	}

	// Durations = size of each group
	const durations: Record<number, number> = {};
	for (const [root, members] of groups.entries()) {
		const canonical = members.slice().sort((a, b) => (startTime.get(a) ?? 1e9) - (startTime.get(b) ?? 1e9))[0];
		durations[canonical] = members.length;
	}

	// Titles concatenated by start time
	const groupTitles: Record<number, string> = {};
	for (const [root, members] of groups.entries()) {
		const canonical = members.slice().sort((a, b) => (startTime.get(a) ?? 1e9) - (startTime.get(b) ?? 1e9))[0];
		const ordered = members.slice().sort((a, b) => (startTime.get(a) ?? 1e9) - (startTime.get(b) ?? 1e9));
		groupTitles[canonical] = ordered.map(m => taskTitles[m] || String(m)).join(' → ');
	}

	// Group-level dependencies
	const dependenciesViz: Record<number, number[]> = {};
	for (const [root, members] of groups.entries()) {
		const canonical = members.slice().sort((a, b) => (startTime.get(a) ?? 1e9) - (startTime.get(b) ?? 1e9))[0];
		const depsSet = new Set<number>();
		for (const m of members) {
			for (const d of (dependencies[m] || [])) {
				const gd = groupIdOf.get(d) ?? d;
				if (gd !== canonical) depsSet.add(gd);
			}
		}
		dependenciesViz[canonical] = Array.from(depsSet).sort((a, b) => a - b);
	}

	// Build viz schedules with only canonical id at earliest start
	const earliestOfGroup = new Map<number, number>();
	for (const [m, gid] of groupIdOf.entries()) {
		const cur = earliestOfGroup.get(gid);
		if (cur === undefined || (startTime.get(m) ?? 1e9) < (startTime.get(cur) ?? 1e9)) earliestOfGroup.set(gid, m);
	}
	const vizSchedules: Record<number, number[]> = {};
	for (const [widStr, timeline] of Object.entries(workerSchedules)) {
		const wid = Number(widStr);
		const out: number[] = [];
		for (let idx = 0; idx < timeline.length; idx++) {
			const tid = timeline[idx];
			if (tid === 0) { out.push(0); continue; }
			const gid = groupIdOf.get(tid) ?? tid;
			const keepTid = earliestOfGroup.get(gid) ?? gid;
			if (tid === keepTid && (startTime.get(tid) ?? -1) === idx) out.push(gid); else out.push(0);
		}
		vizSchedules[wid] = out;
	}

	return { dependenciesViz, groupTitles, durations, vizSchedules };
}

/**
 * Collapse a TaskPlan by merging subtasks that are executed consecutively by the same worker
 * and where a direct dependency t2 <- t1 exists, mirroring the visualization grouping logic.
 * Returns a new TaskPlan with merged subtasks, updated dependencies, and aggregated durations.
 */
export function collapsePlanByConsecutiveMerges(
	plan: TaskPlan,
	workerSchedules: WorkerSchedule,
): { collapsedPlan: TaskPlan; originalToGroup: Record<number, number>; groups: Record<number, number[]> } {
	// Reuse the same grouping rules as buildMergedGraphAfterScheduleConsecutive
	const { workerOf, startTime, runsPerWorker } = computeRuns(workerSchedules as Record<number, number[]>);
	const successors = buildSuccessors(plan.dependencies);

	// Union-Find for merging
	const parent = new Map<number, number>();
	const find = (x: number): number => { if (!parent.has(x)) parent.set(x, x); const p = parent.get(x)!; if (p !== x) parent.set(x, find(p)); return parent.get(x)!; };
	const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };

	for (const runs of runsPerWorker.values()) {
		for (let i = 0; i < runs.length - 1; i++) {
			const [t1, len1, start1] = runs[i];
			const [t2, , start2] = runs[i + 1];
			if (t1 === 0 || t2 === 0) continue;
			if (start2 !== start1 + len1) continue;
			if ((plan.dependencies[t2] || []).includes(t1)) {
				const w = workerOf.get(t1);
				if (w === undefined || workerOf.get(t2) !== w) continue;
				if ((plan.dependencies[t2] || []).some(p => workerOf.get(p) !== w)) continue;
				if ((successors.get(t1) || []).some(s => workerOf.get(s) !== w)) continue;
				union(t1, t2);
			}
		}
	}

	// Build groups: root -> members
	const all = new Set<number>(Object.keys(plan.dependencies).map(k => Number(k)));
	for (const deps of Object.values(plan.dependencies)) for (const d of deps) all.add(d);
	const groups = new Map<number, number[]>();
	for (const t of all) { const r = find(t); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(t); }

	// Canonical id per group = member with earliest start time
	const originalToGroup = new Map<number, number>();
	for (const [root, members] of groups.entries()) {
		const canonical = members.slice().sort((a, b) => (startTime.get(a) ?? 1e9) - (startTime.get(b) ?? 1e9))[0];
		for (const m of members) originalToGroup.set(m, canonical);
	}

	// Materialize group members keyed by canonical id
	const groupMembers: Record<number, number[]> = {};
	for (const [root, members] of groups.entries()) {
		const canonical = members.slice().sort((a, b) => (startTime.get(a) ?? 1e9) - (startTime.get(b) ?? 1e9))[0];
		groupMembers[canonical] = members.slice();
	}

	// Build collapsed dependencies at group level
	const collapsedDependencies: Record<number, number[]> = {};
	for (const [canonicalStr, members] of Object.entries(groupMembers)) {
		const canonical = Number(canonicalStr);
		const depsSet = new Set<number>();
		for (const m of members) {
			for (const d of (plan.dependencies[m] || [])) {
				const gd = originalToGroup.get(d) ?? d;
				if (gd !== canonical) depsSet.add(gd);
			}
		}
		collapsedDependencies[canonical] = Array.from(depsSet).sort((a, b) => a - b);
	}

	// Build collapsed durations (sum of member durations, defaulting each member to 1)
	const collapsedDurations: Record<number, number> = {};
	const hasAnyDuration = plan.durations && Object.keys(plan.durations).length > 0;
	for (const [canonicalStr, members] of Object.entries(groupMembers)) {
		const canonical = Number(canonicalStr);
		let total = 0;
		for (const m of members) total += Math.max(1, Number(plan.durations?.[m] ?? 1));
		collapsedDurations[canonical] = total;
	}

	// Build collapsed subtasks with concatenated titles and stitched prompts
	const idToSubtask = new Map<number, Subtask>(plan.subtasks.map(s => [s.id, s]));
	const collapsedSubtasks: Subtask[] = [];
	for (const [canonicalStr, members] of Object.entries(groupMembers)) {
		const canonical = Number(canonicalStr);
		const ordered = members.slice().sort((a, b) => (startTime.get(a) ?? 1e9) - (startTime.get(b) ?? 1e9));
		const title = ordered.map(m => idToSubtask.get(m)?.title || String(m)).join(' → ');
		const prompt = ordered.map((m, idx) => {
			const base = idToSubtask.get(m);
			return `Step ${idx + 1}: ${base?.prompt || ''}`.trim();
		}).join('\n\n');
		const isFinal = ordered.some(m => !!idToSubtask.get(m)?.isFinal);
		const noBrowse = ordered.every(m => !!idToSubtask.get(m)?.noBrowse);
		const suggestedUrlsSet = new Set<string>();
		const suggestedSearchQueriesSet = new Set<string>();
		for (const m of ordered) {
			for (const u of (idToSubtask.get(m)?.suggestedUrls || [])) suggestedUrlsSet.add(String(u));
			for (const q of (idToSubtask.get(m)?.suggestedSearchQueries || [])) suggestedSearchQueriesSet.add(String(q));
		}
		collapsedSubtasks.push({
			id: canonical,
			title,
			prompt,
			startCriteria: collapsedDependencies[canonical] || [],
			isFinal,
			noBrowse,
			suggestedUrls: Array.from(suggestedUrlsSet),
			suggestedSearchQueries: Array.from(suggestedSearchQueriesSet),
		});
	}
	collapsedSubtasks.sort((a, b) => a.id - b.id);

	const collapsedPlan: TaskPlan = {
		task: plan.task,
		subtasks: collapsedSubtasks,
		dependencies: collapsedDependencies,
		durations: collapsedDurations,
	};

	const mapping: Record<number, number> = {};
	for (const [k, v] of originalToGroup.entries()) mapping[k] = v;

	return { collapsedPlan, originalToGroup: mapping, groups: groupMembers };
}


