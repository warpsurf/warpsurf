import type { TaskPlan, WorkerSchedule, WorkerQueues } from '../multiagent-types';
import { allocateTasks, deriveWorkerQueues } from '../multiagent-scheduler';
import { calculateSchedulingMetrics, type SchedulingMetrics } from '../multiagent-metrics';

export interface QuartermasterResult {
  schedule: WorkerSchedule;
  queues: WorkerQueues;
}

export interface QuartermasterLog {
  timestamp: number;
  maxWorkers: number;
  workersUsed: number;
  subtaskCount: number;
  metrics: SchedulingMetrics;
  assignments: Array<{ sailorId: number; subtaskIds: number[]; subtaskTitles: string[] }>;
  isReschedule?: boolean;
  reason?: string;
}

/**
 * The Quartermaster assigns subtasks to sailors and optimises the schedule.
 * Pure computation — no LLM calls.
 */
export class Quartermaster {
  schedule(plan: TaskPlan, maxWorkers: number): QuartermasterResult {
    const schedule = allocateTasks(plan.dependencies, plan.durations, maxWorkers);
    const queues = deriveWorkerQueues(schedule);
    return { schedule, queues };
  }

  /** Build a structured log entry from a scheduling result (computes metrics on demand). */
  static buildLog(
    plan: TaskPlan,
    result: QuartermasterResult,
    maxWorkers: number,
    rescheduleReason?: string,
  ): QuartermasterLog {
    const metrics = calculateSchedulingMetrics(result.schedule, plan.dependencies);
    const titleMap = new Map(plan.subtasks.map(s => [s.id, s.title]));
    const assignments = Object.entries(result.queues)
      .filter(([, ids]) => ids.length > 0)
      .map(([wid, ids]) => ({
        sailorId: Number(wid),
        subtaskIds: ids,
        subtaskTitles: ids.map(id => titleMap.get(id) || `Task ${id}`),
      }));

    return {
      timestamp: Date.now(),
      maxWorkers,
      workersUsed: assignments.length,
      subtaskCount: plan.subtasks.length,
      metrics,
      assignments,
      ...(rescheduleReason && { isReschedule: true, reason: rescheduleReason }),
    };
  }

  /** Format a human-readable summary for trajectory traces. */
  static formatSummary(log: QuartermasterLog): string {
    const header = log.isReschedule ? `Re-scheduled (${log.reason || 'plan modified'})` : `Schedule assigned`;
    const lines = [
      `${header}: ${log.workersUsed} sailors, ${log.subtaskCount} subtasks, makespan ${log.metrics.makespan}`,
    ];
    for (const a of log.assignments) {
      const tasks = a.subtaskIds.map((id, i) => `#${id} "${a.subtaskTitles[i]}"`).join(' → ');
      lines.push(`  Sailor ${a.sailorId}: ${tasks}`);
    }
    const m = log.metrics;
    lines.push(
      `  Utilization: ${(m.avg_utilization * 100).toFixed(0)}% avg, efficiency ${m.efficiency.toFixed(2)}, locality ${m.locality_score.toFixed(0)}%`,
    );
    return lines.join('\n');
  }
}
