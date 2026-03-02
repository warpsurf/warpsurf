import { createLogger } from '@src/log';
import type { TaskManager } from '../../task/task-manager';
import type { PortGetter, WorkflowConfig, TaskPlan, SubtaskId } from './multiagent-types';
import { Commodore } from './roles/commodore';
import { Quartermaster } from './roles/quartermaster';
import { Captain, type CaptainConfig } from './roles/captain';
import { Sailor } from './roles/sailor';
import { LivePlan } from './live-plan';
import { CaptainState } from './captain-state';
import { buildMergedGraphAfterScheduleConsecutive, collapsePlanByConsecutiveMerges } from './multiagent-merging';
import { buildGraphData } from './multiagent-visualization';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import { buildChatHistoryBlock } from '@src/workflows/shared/utils/chat-history';
import { errorLog } from '../../utils/error-log';
import { globalTokenTracker } from '../../utils/token-tracker';
import { safePostMessage } from '@extension/shared/lib/utils';
import { trajectoryPersistence } from '../../task/trajectory-persistence';
import type { WorkflowEvent, SubtaskStatus } from './workflow-events';

const logger = createLogger('workflow:multiagent');

/**
 * Orchestrates multiple parallel browser agents for complex tasks.
 * Wires together the four roles: Commodore, Quartermaster, Captain, Sailors.
 */
export class MultiAgentWorkflow {
  private taskManager: TaskManager;
  private getPort: PortGetter;
  private config: WorkflowConfig;
  private sessionId: string;
  private cancelled = false;
  private captain?: Captain;
  private captainState?: CaptainState;

  // Graph state for UI
  private lastNodes: Array<{ id: number; title: string }> = [];
  private lastSchedule: Record<number, number[]> = {};
  private lastDeps: Record<number, number[]> = {};
  private statusMap = new Map<SubtaskId, SubtaskStatus>();

  // Backward-compat fields
  private contextTabIds: number[] = [];
  /** @deprecated Refiner is no longer used; Captain handles prompt refinement. */
  private refinerLLM: any = null;

  constructor(taskManager: TaskManager, getPort: PortGetter, sessionId: string, config: WorkflowConfig) {
    this.taskManager = taskManager;
    this.getPort = getPort;
    this.sessionId = sessionId;
    this.config = { maxWorkers: Math.max(1, config.maxWorkers || 16) };
  }

  setContextTabIds(tabIds: number[]): void {
    this.contextTabIds = tabIds;
  }

  /** @deprecated Refiner model is no longer used. Captain handles refinement. */
  setRefinerModel(llm: any) {
    this.refinerLLM = llm;
  }

  getCurrentGraph(): any {
    if (this.lastNodes.length === 0) return null;
    const titles: Record<number, string> = {};
    for (const n of this.lastNodes) titles[n.id] = n.title;
    const merged = buildMergedGraphAfterScheduleConsecutive(this.lastDeps, titles, this.lastSchedule);
    const graph = buildGraphData(merged.vizSchedules, merged.dependenciesViz, merged.groupTitles, merged.durations);
    return {
      ...graph,
      nodes: graph.nodes.map(n => ({ ...n, status: this.statusMap.get(n.id) || 'not_started' })),
    };
  }

  async start(query: string, plannerLLM: any): Promise<void> {
    this.cancelled = false;
    (globalTokenTracker as any)?.clearTokensForTask?.(String(this.sessionId));
    const runIndex = (globalTokenTracker as any)?.incrementWorkflowRunIndex?.(String(this.sessionId)) || 1;
    logger.info(`Starting workflow run ${runIndex} for session ${this.sessionId}`);

    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'multiagent',
      message: 'Commodore planning...',
    });
    this.trace('planner', 'Planning workflow...');

    if (this.cancelled) return this.emitEnded(false, 'Cancelled by user');

    // 1. Commodore creates the plan
    let plan: TaskPlan;
    const commodore = new Commodore();
    try {
      const prevTaskId = (globalTokenTracker as any)?.getCurrentTaskId?.();
      const prevRole = (globalTokenTracker as any)?.getCurrentRole?.();
      (globalTokenTracker as any)?.setCurrentTaskId?.(this.sessionId);
      (globalTokenTracker as any)?.setCurrentRole?.('commodore');

      let historyBlock: string | undefined;
      const session = await chatHistoryStore.getSession(this.sessionId).catch(() => null);
      if (session) {
        const msgs = Array.isArray(session?.messages) ? session.messages : [];
        const block = buildChatHistoryBlock(msgs as any, { latestTaskText: query, stripUserRequestTags: true });
        if (block?.trim()) historyBlock = block;
      }

      plan = await commodore.createPlan(query, plannerLLM, this.config.maxWorkers, undefined, {
        historyBlock,
        sessionId: this.sessionId,
        contextTabIds: this.contextTabIds,
      });

      (globalTokenTracker as any)?.setCurrentTaskId?.(prevTaskId);
      (globalTokenTracker as any)?.setCurrentRole?.(prevRole);
    } catch (e: any) {
      logger.error('Commodore planning failed:', e);
      return this.emitEnded(false, e?.message || 'Planning failed');
    }

    if (this.cancelled) return this.emitEnded(false, 'Cancelled by user');

    const planSummary = plan.subtasks.map(s => `  ${s.id}. ${s.title}`).join('\n');
    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'multiagent',
      message: `Plan created: ${plan.subtasks.length} tasks`,
    });
    this.trace('planner', `Plan created (${plan.subtasks.length} subtasks):\n${planSummary}`);

    // 2. Quartermaster schedules (with consecutive merging)
    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'multiagent',
      message: 'Quartermaster assigning crew...',
    });
    const quartermaster = new Quartermaster();

    // Collapse consecutive same-worker subtasks
    const initialSchedule = quartermaster.schedule(plan, this.config.maxWorkers);
    const { collapsedPlan } = collapsePlanByConsecutiveMerges(plan, initialSchedule.schedule);
    if (collapsedPlan?.subtasks?.length > 0) plan = collapsedPlan;

    const { schedule, queues } = quartermaster.schedule(plan, this.config.maxWorkers);

    if (this.cancelled) return this.emitEnded(false, 'Cancelled by user');

    // Initialize status tracking and graph
    const livePlan = new LivePlan(plan);
    this.captainState = new CaptainState(livePlan);
    this.statusMap = this.captainState.subtaskStatus;
    this.lastNodes = plan.subtasks.map(s => ({ id: s.id, title: s.title }));
    this.lastSchedule = schedule;
    this.lastDeps = plan.dependencies;

    // Emit plan dataset for UI
    const taskWorkerMap: Record<number, number> = {};
    for (const [wid, arr] of Object.entries(queues)) {
      for (const t of arr) taskWorkerMap[Number(t)] = Number(wid);
    }
    this.emit('workflow_plan_dataset', {
      sessionId: this.sessionId,
      dataset: {
        task: plan.task,
        max_workers: this.config.maxWorkers,
        dependencies: plan.dependencies,
        schedule: queues,
        subtasks: plan.subtasks.map(s => ({
          id: s.id,
          title: s.title,
          prompt: s.prompt,
          start_criteria: s.startCriteria,
          is_final: !!s.isFinal,
          no_browse: !!s.noBrowse,
          suggested_urls: s.suggestedUrls || [],
          suggested_search_queries: s.suggestedSearchQueries || [],
          worker: taskWorkerMap[s.id] ?? null,
        })),
      },
    });

    this.updateGraph();

    const activeWorkerCount = Object.values(queues).filter(q => q.length > 0).length;
    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'multiagent',
      message: `${activeWorkerCount} workers deployed`,
    });
    this.trace('scheduler', `Scheduled across ${activeWorkerCount} workers`);

    // 3. Captain takes command
    const sailor = new Sailor(this.taskManager, this.sessionId, plan.task);
    const captainLLM = this.refinerLLM || plannerLLM;

    const captainConfig: CaptainConfig = { maxWorkers: this.config.maxWorkers };

    this.captain = new Captain(this.captainState, sailor, captainLLM, this.sessionId, captainConfig, event =>
      this.handleWorkflowEvent(event),
    );

    try {
      const finalAnswer = await this.captain.run();
      if (!this.cancelled) {
        this.trace('system', `Final answer: ${(finalAnswer || '').slice(0, 500)}`);
        this.emit('final_answer', { sessionId: this.sessionId, text: finalAnswer });
        (this.taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(this.sessionId));
        this.emitEnded(true);
      }
    } catch (e: any) {
      logger.error('Captain execution failed:', e);
      errorLog.add({
        sessionId: this.sessionId,
        taskId: this.sessionId,
        source: 'captain_failure',
        message: e?.message || 'Workflow failed',
      });
      (this.taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(this.sessionId));
      this.emitEnded(false, e?.message || 'Workflow failed');
    }
  }

  async cancelAll(): Promise<void> {
    this.cancelled = true;
    if (this.captain) {
      await this.captain.cancel();
    }
    (this.taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(this.sessionId));
  }

  // --- Event routing: translate Captain events into panel messages ---

  private handleWorkflowEvent(event: WorkflowEvent): void {
    switch (event.type) {
      case 'schedule_ready':
        break; // Already handled above during initialization

      case 'subtask_dispatched': {
        const title = this.captainState?.plan.getSubtask(event.subtaskId)?.title ?? '';
        this.emit('workflow_progress', {
          sessionId: this.sessionId,
          actor: 'multiagent',
          workerId: event.sailorId + 1,
          message: `Worker ${event.sailorId + 1} deployed: ${title}`,
        });
        this.trace('overseer', `Dispatched subtask ${event.subtaskId} "${title}" to worker ${event.sailorId + 1}`);

        // Emit worker session creation if this is the first dispatch for this sailor
        const task = this.taskManager.getTask(this.captainState?.sailorSessionIds.get(event.sailorId) || '');
        if (task) {
          this.emit('worker_session_created', {
            sessionId: this.sessionId,
            workerId: event.sailorId + 1,
            workerSessionId: this.captainState?.sailorSessionIds.get(event.sailorId),
            color: task.color,
          });
        }
        this.updateGraph();
        break;
      }

      case 'subtask_completed': {
        const title = this.captainState?.plan.getSubtask(event.subtaskId)?.title ?? '';
        const workerId = (this.captainState?.sailorAssignments.get(event.subtaskId) ?? 0) + 1;
        if (event.output.text) {
          this.emit('workflow_progress', {
            sessionId: this.sessionId,
            actor: 'multiagent',
            workerId,
            message: event.output.text,
          });
        }
        this.emit('workflow_progress', {
          sessionId: this.sessionId,
          actor: 'multiagent',
          workerId,
          message: `Completed: ${title}`,
        });
        const outputSnippet = event.output.text ? ` — ${event.output.text.slice(0, 200)}` : '';
        this.trace('worker', `Subtask ${event.subtaskId} "${title}" completed (worker ${workerId})${outputSnippet}`);
        this.updateGraph();
        break;
      }

      case 'subtask_failed': {
        const title = this.captainState?.plan.getSubtask(event.subtaskId)?.title ?? '';
        this.emit('workflow_progress', {
          sessionId: this.sessionId,
          actor: 'multiagent',
          message: `Failed: ${title} — ${event.error}`,
        });
        this.trace('worker', `Subtask ${event.subtaskId} "${title}" failed: ${event.error}`);
        this.updateGraph();
        break;
      }

      case 'captain_decision':
        this.emit('workflow_progress', {
          sessionId: this.sessionId,
          actor: 'multiagent',
          message: event.decision.status_message,
        });
        this.trace('overseer', `Decision: ${event.decision.action} — ${event.decision.status_message}`);
        break;

      case 'speculative_launched':
        this.trace('overseer', `Speculative path launched for subtask ${(event as any).subtaskId ?? 'unknown'}`);
        this.updateGraph();
        break;

      case 'speculative_resolved':
        this.trace(
          'overseer',
          `Speculative path resolved for subtask ${(event as any).subtaskId ?? 'unknown'} — winner: ${(event as any).winnerId ?? 'unknown'}`,
        );
        this.updateGraph();
        break;

      case 'plan_modified':
        // Re-cache graph data from the updated plan
        if (this.captainState) {
          const updated = this.captainState.plan.toTaskPlan();
          this.lastNodes = updated.subtasks.map(s => ({ id: s.id, title: s.title }));
          this.lastDeps = updated.dependencies;
          const qm = new Quartermaster();
          const { schedule } = qm.schedule(updated, this.config.maxWorkers);
          this.lastSchedule = schedule;
        }
        this.trace('overseer', 'Plan modified');
        this.updateGraph();
        break;

      case 'workflow_complete':
        this.trace('system', 'Workflow completed successfully');
        break;

      case 'workflow_aborted':
        this.trace('system', `Workflow aborted: ${event.reason}`);
        this.updateGraph();
        this.emitEnded(false, event.reason);
        break;
    }
  }

  // --- Helpers ---

  private emit(type: string, data: any): void {
    const port = this.getPort();
    if (import.meta.env.DEV) {
      logger.info(`[emit] ${type}`, data?.message || data?.text || '');
    }
    if (port) {
      safePostMessage(port as any, { type, data });
    } else if (import.meta.env.DEV) {
      logger.warning(`[emit] No port available for ${type} — message dropped`);
    }
  }

  private trace(actor: string, content: string): void {
    try {
      trajectoryPersistence.addTraceItem(this.sessionId, actor, content, Date.now());
    } catch {}
  }

  private emitEnded(ok: boolean, error?: string): void {
    this.emit('workflow_ended', { sessionId: this.sessionId, ok, error });
    try {
      if (!ok && error) this.trace('system', `Workflow failed: ${error}`);
      trajectoryPersistence.markCompleted(this.sessionId);
    } catch {}
  }

  private updateGraph(): void {
    if (this.lastNodes.length === 0) return;
    const titles: Record<number, string> = {};
    for (const n of this.lastNodes) titles[n.id] = n.title;
    const merged = buildMergedGraphAfterScheduleConsecutive(this.lastDeps, titles, this.lastSchedule);
    const graph = buildGraphData(merged.vizSchedules, merged.dependenciesViz, merged.groupTitles, merged.durations);
    const annotated = {
      ...graph,
      nodes: graph.nodes.map(n => ({
        ...n,
        status: this.statusMap.get(n.id) || 'not_started',
      })),
    };
    this.emit('workflow_graph_update', { sessionId: this.sessionId, graph: annotated });
  }
}
