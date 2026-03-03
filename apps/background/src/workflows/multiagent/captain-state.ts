import type { SubtaskId } from './multiagent-types';
import type { LivePlan } from './live-plan';
import type { StructuredOutput, SubtaskStatus } from './workflow-events';

export interface CrewLogEntry {
  timestamp: number;
  message: string;
  type: 'info' | 'action' | 'error';
}

export type CrewLogProvider = (sessionId: string) => CrewLogEntry[];

export class CaptainState {
  readonly plan: LivePlan;
  readonly subtaskStatus = new Map<SubtaskId, SubtaskStatus>();
  readonly subtaskOutputs = new Map<SubtaskId, StructuredOutput>();
  readonly crewAssignments = new Map<SubtaskId, number>();
  readonly failureCounts = new Map<SubtaskId, number>();
  readonly failureReasons = new Map<SubtaskId, string>();
  readonly speculativeRaces = new Map<string, { candidates: SubtaskId[]; winner?: SubtaskId }>();
  readonly busyCrew = new Set<number>();
  readonly crewSessionIds = new Map<number, string>();
  readonly startTime: number;

  readonly subtaskStartTimes = new Map<SubtaskId, number>();
  readonly subtaskCompletionTimes = new Map<SubtaskId, number>();

  private crewLogProvider?: CrewLogProvider;

  constructor(plan: LivePlan) {
    this.plan = plan;
    this.startTime = Date.now();
    for (const s of plan.getAllSubtasks()) {
      this.subtaskStatus.set(s.id, 'pending');
    }
  }

  setCrewLogProvider(provider: CrewLogProvider): void {
    this.crewLogProvider = provider;
  }

  markRunning(id: SubtaskId): void {
    this.subtaskStatus.set(id, 'running');
    if (!this.subtaskStartTimes.has(id)) {
      this.subtaskStartTimes.set(id, Date.now());
    }
  }

  markCompleted(id: SubtaskId): void {
    this.subtaskStatus.set(id, 'completed');
    this.subtaskCompletionTimes.set(id, Date.now());
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

  /** Returns subtask IDs that have been running longer than the threshold. */
  getOverdueSubtasks(thresholdMs: number): { id: SubtaskId; title: string; elapsedMs: number }[] {
    const now = Date.now();
    const overdue: { id: SubtaskId; title: string; elapsedMs: number }[] = [];
    for (const [id, startTime] of this.subtaskStartTimes) {
      const status = this.subtaskStatus.get(id);
      if (status !== 'running') continue;
      const elapsed = now - startTime;
      if (elapsed >= thresholdMs) {
        overdue.push({ id, title: this.plan.getSubtask(id)?.title ?? `Subtask ${id}`, elapsedMs: elapsed });
      }
    }
    return overdue;
  }

  /** Build a rich state summary for the Captain's LLM context, including timings and action history. */
  buildContextSummary(): string {
    const now = Date.now();
    const workflowElapsed = formatDuration(now - this.startTime);
    const lines: string[] = [`Task: ${this.plan.task}`, `Workflow elapsed: ${workflowElapsed}`, ''];

    const subtasks = this.plan.getAllSubtasks().sort((a, b) => a.id - b.id);
    for (const s of subtasks) {
      const status = this.subtaskStatus.get(s.id) ?? 'pending';
      const parts: string[] = [`[${status.toUpperCase()}] #${s.id} ${s.title}`];

      const startTime = this.subtaskStartTimes.get(s.id);
      if (status === 'running' && startTime) {
        parts.push(`(running for ${formatDuration(now - startTime)})`);
      } else if (status === 'completed' && startTime) {
        const endTime = this.subtaskCompletionTimes.get(s.id) ?? now;
        parts.push(`(took ${formatDuration(endTime - startTime)})`);
      }

      if (status === 'pending') {
        const deps = this.plan.getDependencies(s.id);
        const blocking = deps.filter(d => this.subtaskStatus.get(d) !== 'completed');
        if (blocking.length > 0) {
          parts.push(`(blocked by: ${blocking.map(d => `#${d}`).join(', ')})`);
        }
      }

      const output = this.subtaskOutputs.get(s.id);
      if (output?.text) {
        parts.push(`— Output: ${output.text.slice(0, 150)}`);
      }

      const failReason = this.failureReasons.get(s.id);
      if (failReason) {
        const failCount = this.failureCounts.get(s.id) ?? 0;
        parts.push(`— Failed ${failCount}x: ${failReason}`);
      }

      lines.push(parts.join(' '));

      if (status === 'running') {
        const actionSummary = this.getCrewActionSummary(s.id);
        if (actionSummary) {
          lines.push(actionSummary);
        }
      }
    }

    lines.push('', `Progress: ${this.completedCount}/${this.totalCount}`);
    return lines.join('\n');
  }

  private getCrewActionSummary(subtaskId: SubtaskId): string | undefined {
    if (!this.crewLogProvider) return undefined;

    const crewId = this.crewAssignments.get(subtaskId);
    if (crewId === undefined) return undefined;
    const sessionId = this.crewSessionIds.get(crewId);
    if (!sessionId) return undefined;

    const logs = this.crewLogProvider(sessionId);
    if (logs.length === 0) return undefined;

    const MAX_ACTIONS = 8;
    const recent = logs.slice(-MAX_ACTIONS);
    const actionLines = recent.map(l => {
      const prefix = l.type === 'action' ? '  ▸' : l.type === 'error' ? '  ✗' : '  ·';
      return `${prefix} ${l.message}`;
    });

    const skipped = logs.length - recent.length;
    if (skipped > 0) {
      actionLines.unshift(`  ... (${skipped} earlier actions omitted)`);
    }

    return actionLines.join('\n');
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return remainingSec > 0 ? `${minutes}m ${remainingSec}s` : `${minutes}m`;
}
