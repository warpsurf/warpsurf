import type { TaskPlan, WorkerSchedule, WorkerQueues } from '../multiagent-types';
import { allocateTasks, deriveWorkerQueues } from '../multiagent-scheduler';

export interface QuartermasterResult {
  schedule: WorkerSchedule;
  queues: WorkerQueues;
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
}
