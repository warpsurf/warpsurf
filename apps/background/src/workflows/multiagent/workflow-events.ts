import type { SubtaskId, TaskPlan, WorkerSchedule, WorkerQueues } from './multiagent-types';

export interface StructuredOutput {
  text: string;
  raw?: any;
  tabIds: number[];
  duration: number;
  stepsUsed: number;
}

export interface NewSubtaskSpec {
  title: string;
  prompt: string;
  dependencies: SubtaskId[];
  no_browse?: boolean;
  suggested_urls?: string[];
  suggested_search_queries?: string[];
}

export type CaptainActionType =
  | { type: 'dispatch_subtask'; subtask_id: SubtaskId; refined_prompt?: string }
  | { type: 'cancel_subtask'; subtask_id: SubtaskId; reason: string }
  | { type: 'retry_subtask'; subtask_id: SubtaskId; modified_prompt?: string; reassign_to_crew?: number }
  | { type: 'skip_subtask'; subtask_id: SubtaskId; reason: string }
  | { type: 'add_subtask'; subtask: NewSubtaskSpec; after_dependencies: SubtaskId[] }
  | { type: 'modify_subtask'; subtask_id: SubtaskId; new_prompt?: string; new_title?: string; no_browse?: boolean }
  | { type: 'modify_plan'; revised_subtasks: NewSubtaskSpec[]; reason: string }
  | { type: 'launch_speculative'; goal_id: string; alternatives: NewSubtaskSpec[] }
  | { type: 'resolve_speculative'; goal_id: string; winner_id: SubtaskId }
  | { type: 'complete_workflow'; reason: string }
  | { type: 'abort_workflow'; reason: string }
  | { type: 'pause_workflow'; reason: string };

export interface CaptainDecision {
  status_message: string;
  actions: CaptainActionType[];
}

export type SubtaskStatus = 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export type WorkflowEvent =
  | { type: 'plan_created'; plan: TaskPlan }
  | { type: 'schedule_ready'; schedule: WorkerSchedule; queues: WorkerQueues }
  | { type: 'captain_decision'; decision: CaptainDecision; drainedMessages?: string[] }
  | { type: 'subtask_dispatched'; subtaskId: SubtaskId; crewId: number; prompt: string }
  | { type: 'subtask_running'; subtaskId: SubtaskId }
  | { type: 'subtask_completed'; subtaskId: SubtaskId; output: StructuredOutput }
  | { type: 'subtask_failed'; subtaskId: SubtaskId; error: string }
  | { type: 'speculative_launched'; goalId: string; candidates: SubtaskId[] }
  | { type: 'speculative_resolved'; goalId: string; winnerId: SubtaskId; cancelledIds: SubtaskId[] }
  | { type: 'plan_modified'; reason: string; addedIds: SubtaskId[]; removedIds: SubtaskId[] }
  | { type: 'workflow_complete'; finalAnswer: string }
  | { type: 'workflow_aborted'; reason: string }
  | { type: 'workflow_paused'; reason: string }
  | { type: 'workflow_resumed' };
