import type { Subtask, SubtaskId, TaskPlan } from './multiagent-types';
import type { NewSubtaskSpec, RevisedSubtaskSpec } from './workflow-events';

/**
 * Mutable DAG that the Captain can modify at runtime.
 * Supports adding/removing subtasks, rewiring dependencies, and speculative paths.
 */
export class LivePlan {
  private subtasks = new Map<SubtaskId, Subtask>();
  private deps = new Map<SubtaskId, Set<SubtaskId>>();
  private speculativeGroups = new Map<string, Set<SubtaskId>>();
  private _nextId: number;
  readonly task: string;

  constructor(plan: TaskPlan) {
    this.task = plan.task;
    let maxId = 0;
    for (const s of plan.subtasks) {
      this.subtasks.set(s.id, { ...s });
      this.deps.set(s.id, new Set(s.startCriteria));
      if (s.id > maxId) maxId = s.id;
    }
    this._nextId = maxId + 1;
  }

  // --- Reads ---

  getSubtask(id: SubtaskId): Subtask | undefined {
    return this.subtasks.get(id);
  }

  getDependencies(id: SubtaskId): SubtaskId[] {
    return Array.from(this.deps.get(id) ?? []);
  }

  getReadySubtasks(completed: Set<SubtaskId>): SubtaskId[] {
    const ready: SubtaskId[] = [];
    for (const [id, depSet] of this.deps) {
      if (completed.has(id)) continue;
      if ([...depSet].every(d => completed.has(d))) ready.push(id);
    }
    return ready;
  }

  getAllSubtasks(): Subtask[] {
    return Array.from(this.subtasks.values());
  }

  getFinalSubtask(): Subtask | undefined {
    return Array.from(this.subtasks.values()).find(s => s.isFinal);
  }

  /** Return all transitive dependencies of a subtask (BFS over the DAG). */
  getTransitiveDependencies(id: SubtaskId): Set<SubtaskId> {
    const result = new Set<SubtaskId>();
    const queue = Array.from(this.deps.get(id) ?? []);
    while (queue.length > 0) {
      const dep = queue.pop()!;
      if (result.has(dep)) continue;
      result.add(dep);
      for (const upstream of this.deps.get(dep) ?? []) queue.push(upstream);
    }
    return result;
  }

  getSpeculativeGroup(goalId: string): SubtaskId[] {
    return Array.from(this.speculativeGroups.get(goalId) ?? []);
  }

  getAllSpeculativeGroups(): Map<string, Set<SubtaskId>> {
    return this.speculativeGroups;
  }

  get size(): number {
    return this.subtasks.size;
  }

  // --- Mutations ---

  addSubtask(spec: NewSubtaskSpec): SubtaskId {
    const id = this._nextId++;
    const subtask: Subtask = {
      id,
      title: spec.title,
      prompt: spec.prompt,
      startCriteria: spec.dependencies,
      isFinal: spec.is_final,
      noBrowse: spec.no_browse,
      suggestedUrls: spec.suggested_urls,
      suggestedSearchQueries: spec.suggested_search_queries,
    };
    this.subtasks.set(id, subtask);
    this.deps.set(id, new Set(spec.dependencies));
    return id;
  }

  removeSubtask(id: SubtaskId): void {
    const removedDeps = this.deps.get(id) ?? new Set<SubtaskId>();
    this.subtasks.delete(id);
    this.deps.delete(id);
    // Rewire: anything that depended on `id` now depends on `id`'s own deps
    for (const [tid, depSet] of this.deps) {
      if (depSet.has(id)) {
        depSet.delete(id);
        for (const upstream of removedDeps) depSet.add(upstream);
      }
    }
    // Remove from speculative groups
    for (const [goalId, group] of this.speculativeGroups) {
      group.delete(id);
      if (group.size === 0) this.speculativeGroups.delete(goalId);
    }
  }

  modifySubtask(id: SubtaskId, changes: Partial<Pick<Subtask, 'title' | 'prompt' | 'noBrowse'>>): void {
    const s = this.subtasks.get(id);
    if (!s) return;
    if (changes.title !== undefined) s.title = changes.title;
    if (changes.prompt !== undefined) s.prompt = changes.prompt;
    if (changes.noBrowse !== undefined) s.noBrowse = changes.noBrowse;
  }

  setDependencies(id: SubtaskId, deps: SubtaskId[]): void {
    const depSet = this.deps.get(id);
    if (!depSet) return;
    depSet.clear();
    for (const d of deps) depSet.add(d);
    const s = this.subtasks.get(id);
    if (s) s.startCriteria = deps;
  }

  addDependency(subtaskId: SubtaskId, dependsOn: SubtaskId): void {
    const depSet = this.deps.get(subtaskId);
    if (depSet) depSet.add(dependsOn);
  }

  removeDependency(subtaskId: SubtaskId, dependsOn: SubtaskId): void {
    this.deps.get(subtaskId)?.delete(dependsOn);
  }

  // --- Speculative ---

  addSpeculativeGroup(goalId: string, subtaskIds: SubtaskId[]): void {
    this.speculativeGroups.set(goalId, new Set(subtaskIds));
  }

  /** Resolve a speculative race. Returns IDs of the losers to cancel. */
  resolveSpeculation(goalId: string, winnerId: SubtaskId): SubtaskId[] {
    const group = this.speculativeGroups.get(goalId);
    if (!group) return [];
    const losers = [...group].filter(id => id !== winnerId);
    // Rewire: anything depending on any group member now depends on the winner
    for (const [, depSet] of this.deps) {
      for (const loserId of losers) {
        if (depSet.has(loserId)) {
          depSet.delete(loserId);
          depSet.add(winnerId);
        }
      }
    }
    for (const loserId of losers) this.removeSubtask(loserId);
    this.speculativeGroups.delete(goalId);
    return losers;
  }

  // --- Bulk ---

  /**
   * Replace all pending (not completed) subtasks with a revised set.
   * Dependencies in revised specs use:
   *  - String → temp_id of another revised subtask (preferred)
   *  - Positive integer → existing subtask ID
   *  - Negative integer → 1-indexed position fallback (-1 = first, -2 = second, …)
   *  - Positive integer not matching any existing subtask → 1-indexed position fallback
   */
  replacePendingSubtasks(revised: RevisedSubtaskSpec[], completed: Set<SubtaskId>): SubtaskId[] {
    for (const id of [...this.subtasks.keys()]) {
      if (!completed.has(id)) {
        this.subtasks.delete(id);
        this.deps.delete(id);
      }
    }

    // First pass: create subtasks with empty deps, build temp_id→realId map
    const newIds: SubtaskId[] = [];
    const tempIdMap = new Map<string, SubtaskId>();
    for (const spec of revised) {
      const id = this._nextId++;
      this.subtasks.set(id, {
        id,
        title: spec.title,
        prompt: spec.prompt,
        startCriteria: [],
        isFinal: spec.is_final,
        noBrowse: spec.no_browse,
        suggestedUrls: spec.suggested_urls,
        suggestedSearchQueries: spec.suggested_search_queries,
      });
      this.deps.set(id, new Set());
      newIds.push(id);
      if (spec.temp_id) tempIdMap.set(spec.temp_id, id);
    }

    // Second pass: resolve dependency references to real IDs
    const planIds = new Set(this.subtasks.keys());
    for (let i = 0; i < revised.length; i++) {
      const resolved = new Set<SubtaskId>();
      for (const dep of revised[i].dependencies) {
        if (typeof dep === 'string') {
          const mapped = tempIdMap.get(dep);
          if (mapped !== undefined) resolved.add(mapped);
        } else if (dep < 0) {
          const idx = Math.abs(dep) - 1;
          if (idx >= 0 && idx < newIds.length) resolved.add(newIds[idx]);
        } else if (planIds.has(dep)) {
          resolved.add(dep);
        } else if (dep >= 1 && dep <= newIds.length) {
          resolved.add(newIds[dep - 1]);
        }
      }
      this.deps.set(newIds[i], resolved);
      const s = this.subtasks.get(newIds[i]);
      if (s) s.startCriteria = [...resolved];
    }

    // Auto-mark terminal subtask as final if none explicitly marked
    if (!newIds.some(id => this.subtasks.get(id)?.isFinal)) {
      const dependedUpon = new Set<SubtaskId>();
      for (const nid of newIds) {
        for (const dep of this.deps.get(nid) ?? []) dependedUpon.add(dep);
      }
      const terminal = newIds.filter(id => !dependedUpon.has(id));
      if (terminal.length === 1) {
        const s = this.subtasks.get(terminal[0]);
        if (s) s.isFinal = true;
      }
    }

    return newIds;
  }

  // --- Export ---

  toTaskPlan(): TaskPlan {
    const subtasks = Array.from(this.subtasks.values()).sort((a, b) => a.id - b.id);
    const dependencies: Record<SubtaskId, SubtaskId[]> = {};
    for (const [id, depSet] of this.deps) {
      dependencies[id] = Array.from(depSet).sort((a, b) => a - b);
    }
    return { task: this.task, subtasks, dependencies };
  }

  // --- Validation ---

  validateDAG(): boolean {
    const temp = new Set<SubtaskId>();
    const perm = new Set<SubtaskId>();
    const visit = (n: SubtaskId): boolean => {
      if (perm.has(n)) return true;
      if (temp.has(n)) return false;
      temp.add(n);
      for (const d of this.deps.get(n) ?? []) {
        if (!visit(d)) return false;
      }
      temp.delete(n);
      perm.add(n);
      return true;
    };
    for (const id of this.subtasks.keys()) {
      if (!visit(id)) return false;
    }
    return true;
  }
}
