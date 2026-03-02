import type { SubtaskId } from './multiagent-types';
import type { LivePlan } from './live-plan';
import type { StructuredOutput, SubtaskStatus } from './workflow-events';

export class CaptainState {
  readonly plan: LivePlan;
  readonly subtaskStatus = new Map<SubtaskId, SubtaskStatus>();
  readonly subtaskOutputs = new Map<SubtaskId, StructuredOutput>();
  readonly sailorAssignments = new Map<SubtaskId, number>();
  readonly failureCounts = new Map<SubtaskId, number>();
  readonly failureReasons = new Map<SubtaskId, string>();
  readonly speculativeRaces = new Map<string, { candidates: SubtaskId[]; winner?: SubtaskId }>();
  readonly busySailors = new Set<number>();
  readonly sailorSessionIds = new Map<number, string>();
  readonly startTime: number;

  constructor(plan: LivePlan) {
    this.plan = plan;
    this.startTime = Date.now();
    for (const s of plan.getAllSubtasks()) {
      this.subtaskStatus.set(s.id, 'pending');
    }
  }

  get completedCount(): number {
    let n = 0;
    for (const st of this.subtaskStatus.values()) if (st === 'completed') n++;
    return n;
  }

  get totalCount(): number {
    return this.subtaskStatus.size;
  }

  isAllDone(): boolean {
    for (const st of this.subtaskStatus.values()) {
      if (st !== 'completed' && st !== 'cancelled' && st !== 'failed') return false;
    }
    return true;
  }

  getCompletedIds(): Set<SubtaskId> {
    const set = new Set<SubtaskId>();
    for (const [id, st] of this.subtaskStatus) {
      if (st === 'completed') set.add(id);
    }
    return set;
  }

  recordFailure(id: SubtaskId, error: string): number {
    const count = (this.failureCounts.get(id) ?? 0) + 1;
    this.failureCounts.set(id, count);
    this.failureReasons.set(id, error);
    this.subtaskStatus.set(id, 'failed');
    return count;
  }

  /** Build a concise state summary for the Captain's LLM context. */
  buildContextSummary(): string {
    const lines: string[] = [`Task: ${this.plan.task}`, ''];
    const subtasks = this.plan.getAllSubtasks().sort((a, b) => a.id - b.id);
    for (const s of subtasks) {
      const status = this.subtaskStatus.get(s.id) ?? 'pending';
      const output = this.subtaskOutputs.get(s.id);
      const outputSnippet = output?.text ? ` — Output: ${output.text.slice(0, 150)}` : '';
      const failReason = this.failureReasons.get(s.id);
      const failStr = failReason ? ` — Error: ${failReason}` : '';
      lines.push(`[${status.toUpperCase()}] #${s.id} ${s.title}${outputSnippet}${failStr}`);
    }
    lines.push('', `Progress: ${this.completedCount}/${this.totalCount}`);
    return lines.join('\n');
  }
}
