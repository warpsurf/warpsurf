import type { WorkerSchedule, WorkerQueues } from './multiagent-types';

/**
 * Port of workspan/scheduling.allocate_tasks to TypeScript.
 * Minimizes makespan with affinity preference; supports durations and worker cap.
 */
export function allocateTasks(
  dependencies: Record<number, number[]>,
  durations?: Record<number, number>,
  maxWorkers?: number,
): WorkerSchedule {
  if (!dependencies || Object.keys(dependencies).length === 0) return {};
  if (maxWorkers !== undefined) {
    if (!Number.isInteger(maxWorkers) || maxWorkers < 1)
      throw new Error('maxWorkers must be a positive integer when provided');
  }
  // Collect all tasks mentioned anywhere
  const allTasks = new Set<number>(Object.keys(dependencies).map(k => Number.parseInt(k, 10)));
  for (const deps of Object.values(dependencies)) {
    for (const d of deps) allTasks.add(Number(d));
  }

  // Successors and predecessors
  const successors = new Map<number, number[]>();
  const predecessors = new Map<number, number[]>();
  for (const t of allTasks) {
    successors.set(t, []);
    predecessors.set(t, []);
  }
  for (const [taskStr, deps] of Object.entries(dependencies)) {
    const task = Number.parseInt(taskStr, 10);
    predecessors.set(
      task,
      (deps || []).map(d => Number(d)),
    );
    for (const dep of deps || []) successors.get(dep)!.push(task);
  }

  // Default durations
  const dur: Record<number, number> = {};
  for (const t of allTasks) dur[t] = Math.max(1, Number(durations?.[t] ?? 1));

  // Depths (earliest possible timestep ignoring durations)
  const depths = new Map<number, number>();
  const calcDepth = (t: number): number => {
    if (depths.has(t)) return depths.get(t)!;
    const preds = predecessors.get(t) || [];
    const d = preds.length === 0 ? 0 : Math.max(...preds.map(p => calcDepth(p))) + 1;
    depths.set(t, d);
    return d;
  };
  for (const t of allTasks) calcDepth(t);

  // Bottom levels (critical path to end) ignoring durations
  const bottom = new Map<number, number>();
  const calcBottom = (t: number): number => {
    if (bottom.has(t)) return bottom.get(t)!;
    const succ = successors.get(t) || [];
    const b = succ.length === 0 ? 0 : Math.max(...succ.map(s => calcBottom(s))) + 1;
    bottom.set(t, b);
    return b;
  };
  for (const t of allTasks) calcBottom(t);

  const taskToWorker = new Map<number, number>();
  let nextWorkerId = 0;
  const workerSchedules: WorkerSchedule = {};
  const workerCurrent = new Map<number, { task: number; remaining: number } | null>();
  // Track the last task completed on each worker to prefer chaining its single successor
  const lastCompleted = new Map<number, number>();
  const totalTasks = allTasks.size;
  const completed = new Set<number>();
  const started = new Set<number>();
  let timestep = 0;

  const isWorkerFree = (wid: number) => !workerCurrent.has(wid) || workerCurrent.get(wid) === null;

  while (completed.size < totalTasks) {
    // Determine ready tasks
    const ready: number[] = [];
    for (const t of allTasks) {
      if (started.has(t)) continue;
      const preds = predecessors.get(t) || [];
      if (preds.every(p => completed.has(p))) ready.push(t);
    }
    // Sort by bottom level (critical first)
    ready.sort((a, b) => bottom.get(b)! - bottom.get(a)!);

    // Free workers at this timestep (fresh snapshot)
    const freeWorkers = Object.keys(workerSchedules)
      .map(n => Number(n))
      .filter(w => isWorkerFree(w));
    const usedWorkers = new Set<number>();
    const assignments: Array<[number, number]> = [];
    const assignedTasks = new Set<number>();

    // Sticky successor pass: if a worker just completed t1 and t1 has exactly one successor t2,
    // and t2 has exactly one predecessor (t1), then schedule t2 on the same worker immediately
    for (const wid of freeWorkers) {
      if (usedWorkers.has(wid)) continue;
      const t1 = lastCompleted.get(wid);
      if (t1 === undefined) continue;
      const succ = successors.get(t1) || [];
      if (succ.length !== 1) continue;
      const t2 = succ[0];
      // t2 must be ready now (all predecessors completed)
      if (!ready.includes(t2)) continue;
      const preds = predecessors.get(t2) || [];
      if (preds.length !== 1 || preds[0] !== t1) continue;
      assignments.push([t2, wid]);
      usedWorkers.add(wid);
      assignedTasks.add(t2);
    }

    // First pass: affinity to predecessor's worker if free
    const unassigned: number[] = [];
    for (const task of ready) {
      if (assignedTasks.has(task)) continue; // already assigned by sticky pass
      let assigned = false;
      for (const dep of predecessors.get(task) || []) {
        if (taskToWorker.has(dep)) {
          const wid = taskToWorker.get(dep)!;
          if (isWorkerFree(wid) && !usedWorkers.has(wid)) {
            assignments.push([task, wid]);
            usedWorkers.add(wid);
            assigned = true;
            break;
          }
        }
      }
      if (!assigned) unassigned.push(task);
    }

    // Second pass: create new workers up to limit, else reuse free ones
    for (const task of unassigned) {
      if (assignedTasks.has(task)) continue; // safety: skip if assigned earlier
      const canCreate = maxWorkers === undefined || Object.keys(workerSchedules).length < maxWorkers;
      if (canCreate) {
        const wid = nextWorkerId++;
        workerSchedules[wid] = [];
        assignments.push([task, wid]);
        usedWorkers.add(wid);
      } else if (freeWorkers.length > 0) {
        const wid = freeWorkers.shift()!;
        if (!usedWorkers.has(wid) && isWorkerFree(wid)) {
          assignments.push([task, wid]);
          usedWorkers.add(wid);
        }
      } else {
        break; // no capacity this timestep
      }
    }

    // Pad schedules to current timestep
    for (const wid of Object.keys(workerSchedules).map(n => Number(n))) {
      while (workerSchedules[wid].length < timestep) workerSchedules[wid].push(0);
    }

    // Start assigned tasks
    for (const [task, wid] of assignments) {
      if (!(wid in workerSchedules)) workerSchedules[wid] = new Array(timestep).fill(0);
      if (isWorkerFree(wid)) {
        workerCurrent.set(wid, { task, remaining: Math.max(1, dur[task]) });
        taskToWorker.set(task, wid);
        started.add(task);
      }
    }

    // Append entries and decrease remaining durations
    const justCompleted: Array<[number, number]> = [];
    for (const wid of Object.keys(workerSchedules).map(n => Number(n))) {
      const cur = workerCurrent.get(wid);
      if (cur) {
        workerSchedules[wid].push(cur.task);
        cur.remaining -= 1;
        if (cur.remaining <= 0) justCompleted.push([wid, cur.task]);
      } else {
        workerSchedules[wid].push(0);
      }
    }
    for (const [wid, task] of justCompleted) {
      completed.add(task);
      workerCurrent.set(wid, null);
      lastCompleted.set(wid, task);
    }
    timestep += 1;
  }

  // Pad all worker schedules to same length
  const maxLen = Math.max(...Object.values(workerSchedules).map(s => s.length));
  for (const wid of Object.keys(workerSchedules).map(n => Number(n))) {
    while (workerSchedules[wid].length < maxLen) workerSchedules[wid].push(0);
  }
  return workerSchedules;
}

/**
 * Remap worker IDs in a schedule/queues to match warm-start crew assignments.
 * Builds a full bijective permutation so no key collisions occur when the
 * QM ordering differs from the warm-start stream ordering.
 */
export function remapSchedule(
  schedule: WorkerSchedule,
  queues: WorkerQueues,
  earlyDispatched: Map<number, number>,
): { schedule: WorkerSchedule; queues: WorkerQueues } {
  if (earlyDispatched.size === 0) return { schedule, queues };

  // Find which QM worker owns each warm-started task
  const qmTaskToWorker = new Map<number, number>();
  for (const [widStr, timeline] of Object.entries(schedule)) {
    for (const taskId of timeline) {
      if (taskId !== 0 && earlyDispatched.has(taskId) && !qmTaskToWorker.has(taskId)) {
        qmTaskToWorker.set(taskId, Number(widStr));
      }
    }
  }

  // Build anchored mappings: QM worker → target crew member
  const anchored = new Map<number, number>();
  for (const [taskId, crewId] of earlyDispatched) {
    const qmWorker = qmTaskToWorker.get(taskId);
    if (qmWorker !== undefined) anchored.set(qmWorker, crewId);
  }
  if (anchored.size === 0) return { schedule, queues };

  // Complete the partial mapping into a full bijective permutation.
  // Any unmapped QM ID whose identity would collide with an anchored target
  // must be swapped to a free ID instead.
  const allQmIds = Object.keys(schedule).map(Number);
  const usedTargets = new Set(anchored.values());
  const freeTargets: number[] = allQmIds.filter(id => !usedTargets.has(id) && !anchored.has(id));

  const perm = new Map(anchored);
  for (const qmId of allQmIds) {
    if (perm.has(qmId)) continue;
    if (!usedTargets.has(qmId)) {
      // Identity mapping is safe — no collision
      perm.set(qmId, qmId);
      usedTargets.add(qmId);
    } else {
      // Identity would collide; assign a free target
      const target = freeTargets.shift();
      if (target !== undefined) {
        perm.set(qmId, target);
        usedTargets.add(target);
      }
    }
  }

  const remappedSchedule: WorkerSchedule = {};
  const remappedQueues: WorkerQueues = {};
  for (const [w, timeline] of Object.entries(schedule)) {
    remappedSchedule[perm.get(Number(w)) ?? Number(w)] = timeline;
  }
  for (const [w, queue] of Object.entries(queues)) {
    remappedQueues[perm.get(Number(w)) ?? Number(w)] = queue;
  }
  return { schedule: remappedSchedule, queues: remappedQueues };
}

/** Convert a time-grid schedule into linear queues per worker. */
export function deriveWorkerQueues(schedule: WorkerSchedule): WorkerQueues {
  const queues: WorkerQueues = {};
  for (const [widStr, timeline] of Object.entries(schedule)) {
    const wid = Number(widStr);
    queues[wid] = [];
    let prev: number = 0;
    for (const t of timeline) {
      if (t !== 0 && t !== prev) queues[wid].push(t);
      prev = t;
    }
  }
  return queues;
}
