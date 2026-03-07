import type { SubtaskId } from './multiagent-types';
import type { LivePlan } from './live-plan';
import type { StructuredOutput, SubtaskStatus } from './workflow-events';
import { escapeUntrustedContent } from '@src/workflows/shared/messages/utils';

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
  obsoleteCompletedIds = new Set<SubtaskId>();

  readonly subtaskStartTimes = new Map<SubtaskId, number>();
  readonly subtaskCompletionTimes = new Map<SubtaskId, number>();
  readonly dispatchAttempts = new Map<SubtaskId, number>();

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
    this.failureReasons.delete(id);
    this.failureCounts.delete(id);
  }

  get completedCount(): number {
    let n = 0;
    for (const st of this.subtaskStatus.values()) if (st === 'completed') n++;
    return n;
  }

  get totalCount(): number {
    return this.plan.size;
  }

  isAllDone(): boolean {
    for (const st of this.subtaskStatus.values()) {
      if (st !== 'completed' && st !== 'cancelled' && st !== 'failed' && st !== 'skipped') return false;
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

  /** IDs that count as resolved for dependency gating: completed or explicitly skipped. */
  getResolvedIds(): Set<SubtaskId> {
    const set = new Set<SubtaskId>();
    for (const [id, st] of this.subtaskStatus) {
      if (st === 'completed' || st === 'skipped') set.add(id);
    }
    return set;
  }

  markSkipped(id: SubtaskId): void {
    this.subtaskStatus.set(id, 'skipped');
  }

  /** True if pending subtasks exist whose dependencies include a failed or cancelled task. */
  hasBlockedSubtasks(): boolean {
    for (const [id, st] of this.subtaskStatus) {
      if (st !== 'pending') continue;
      const deps = this.plan.getDependencies(id);
      if (
        deps.some(d => {
          const ds = this.subtaskStatus.get(d);
          return ds === 'failed' || ds === 'cancelled';
        })
      )
        return true;
    }
    return false;
  }

  incrementDispatchAttempts(id: SubtaskId): number {
    const count = (this.dispatchAttempts.get(id) ?? 0) + 1;
    this.dispatchAttempts.set(id, count);
    return count;
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

  /** Build a rich state summary for the Captain's LLM context. */
  buildContextSummary(): string {
    const now = Date.now();
    const subtasks = this.plan.getAllSubtasks().sort((a, b) => a.id - b.id);
    const lines: string[] = [
      `Task: ${this.plan.task}`,
      `Elapsed: ${formatDuration(now - this.startTime)} | Progress: ${this.completedCount}/${this.totalCount}`,
      '',
      '═══ PLAN ═══',
    ];

    for (const s of subtasks) {
      const status = this.subtaskStatus.get(s.id) ?? 'pending';
      const crewId = this.crewAssignments.get(s.id);
      const deps = this.plan.getDependencies(s.id);

      lines.push('', `[${status.toUpperCase()}] #${s.id} "${s.title}"`);

      if (status === 'pending' || status === 'running' || status === 'dispatched' || status === 'failed') {
        lines.push(`  Prompt: ${s.prompt}`);
      } else if (status === 'completed') {
        lines.push(`  Prompt: ${truncate(s.prompt, 120)}`);
      }

      lines.push(`  Deps: ${deps.length ? deps.map(d => `#${d}`).join(', ') : 'none'}`);

      const crew = crewId !== undefined ? `Crew ${crewId}` : '—';
      lines.push(`  Crew: ${crew} | ${this.subtaskTiming(s.id, status, deps, now)}`);

      const failReason = this.failureReasons.get(s.id);
      if (failReason) {
        lines.push(`  Failed ${this.failureCounts.get(s.id) ?? 0}x: ${failReason}`);
      }
    }

    lines.push('', '═══ LIVE STATUS ═══');

    const withOutput = subtasks.filter(
      s => this.subtaskStatus.get(s.id) === 'completed' && this.subtaskOutputs.get(s.id)?.text,
    );
    if (withOutput.length) {
      lines.push('', 'Outputs:');
      for (const s of withOutput) {
        const output = this.subtaskOutputs.get(s.id)!;
        const feedsDownstream = subtasks.some(
          other =>
            (this.subtaskStatus.get(other.id) === 'pending' || this.subtaskStatus.get(other.id) === 'dispatched') &&
            this.plan.getDependencies(other.id).includes(s.id),
        );
        lines.push(`  #${s.id}: ${escapeUntrustedContent(truncate(output.text, feedsDownstream ? 600 : 150))}`);
      }
    }

    const running = subtasks.filter(s => this.subtaskStatus.get(s.id) === 'running');
    if (running.length) {
      lines.push('', 'Crew actions:');
      for (const s of running) {
        const cid = this.crewAssignments.get(s.id);
        lines.push(`  #${s.id} (Crew ${cid ?? '?'}):`);
        const summary = this.getCrewActionSummary(s.id);
        if (summary) lines.push(summary);
      }
    }

    return lines.join('\n');
  }

  private subtaskTiming(id: SubtaskId, status: SubtaskStatus, deps: SubtaskId[], now: number): string {
    const start = this.subtaskStartTimes.get(id);
    if (status === 'running' && start) return `Elapsed: ${formatDuration(now - start)}`;
    if (status === 'completed' && start) {
      return `Took: ${formatDuration((this.subtaskCompletionTimes.get(id) ?? now) - start)}`;
    }
    if (status === 'pending' || status === 'dispatched') {
      const blocking = deps.filter(d => {
        const ds = this.subtaskStatus.get(d);
        return ds !== 'completed' && ds !== 'skipped';
      });
      return blocking.length ? `Waiting on: ${blocking.map(d => `#${d}`).join(', ')}` : 'Ready';
    }
    return '';
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
      const prefix = l.type === 'action' ? '    ▸' : l.type === 'error' ? '    ✗' : '    ·';
      return `${prefix} ${l.message}`;
    });

    const skipped = logs.length - recent.length;
    if (skipped > 0) {
      actionLines.unshift(`    ... (${skipped} earlier actions omitted)`);
    }

    return actionLines.join('\n');
  }
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) + '...' : text;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return remainingSec > 0 ? `${minutes}m ${remainingSec}s` : `${minutes}m`;
}
