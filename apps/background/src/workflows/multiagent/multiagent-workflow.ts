import { createLogger } from '@src/log';
import type { TaskManager } from '../../task/task-manager';
import type { PortGetter, WorkflowConfig, TaskPlan, SubtaskId, Subtask } from './multiagent-types';
import { Commodore } from './roles/commodore';
import { Quartermaster } from './roles/quartermaster';
import { Captain, type CaptainConfig, type WarmDispatch } from './roles/captain';
import { Crew } from './roles/crew';
import { LivePlan } from './live-plan';
import { CaptainState } from './captain-state';
import { SharedTabRegistry } from '../../task/shared-tab-registry';
import { buildMergedGraphAfterScheduleConsecutive, collapsePlanByConsecutiveMerges } from './multiagent-merging';
import { remapSchedule } from './multiagent-scheduler';
import { buildGraphData } from './multiagent-visualization';
import { buildRootSubtaskPrompt } from './incremental-plan-parser';
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
 * Wires together the four roles: Commodore, Quartermaster, Captain, Crew.
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
      nodes: graph.nodes.map(n => ({ ...n, status: this.resolveNodeStatus(n.id) })),
    };
  }

  private resolveNodeStatus(id: SubtaskId): string {
    const status = this.statusMap.get(id) || 'not_started';
    if (status === 'completed' && this.captainState?.obsoleteCompletedIds.has(id)) return 'obsolete';
    return status;
  }

  async start(query: string, plannerLLM: any): Promise<void> {
    this.cancelled = false;
    trajectoryPersistence.markMultiagent(this.sessionId);
    (globalTokenTracker as any)?.clearTokensForTask?.(String(this.sessionId));
    const runIndex = (globalTokenTracker as any)?.incrementWorkflowRunIndex?.(String(this.sessionId)) || 1;
    logger.info(`Starting workflow run ${runIndex} for session ${this.sessionId}`);

    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'multiagent',
      message: 'Commodore planning...',
    });
    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'planner',
      message: 'Planning task decomposition...',
    });

    if (this.cancelled) return this.emitEnded(false, 'Cancelled by user');

    // --- Phase 1: Stream plan from Commodore, warm-dispatch root tasks ---
    // Session creation in the TaskManager is not safe under concurrent calls
    // (tab groups, executors, color slots share state), so warm dispatches are
    // chained sequentially while the LLM stream continues in parallel.
    const crew = new Crew(this.taskManager, this.sessionId, query);
    const warmDispatches: WarmDispatch[] = [];
    let warmChain = Promise.resolve<void>(undefined);
    let nextCrewId = 0;

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

      plan = await commodore.createPlanStreaming(
        query,
        plannerLLM,
        this.config.maxWorkers,
        undefined,
        { historyBlock, sessionId: this.sessionId, contextTabIds: this.contextTabIds },
        (subtask: Subtask) => {
          if (this.cancelled || nextCrewId >= this.config.maxWorkers) return;
          const crewId = nextCrewId++;
          logger.info(
            `[warm-start] Root subtask #${subtask.id} "${subtask.title}" parsed from stream → queued for Crew ${crewId}`,
          );
          warmChain = warmChain.then(async () => {
            if (this.cancelled) return;
            try {
              warmDispatches.push(await this.dispatchWarmTask(crew, subtask, crewId));
            } catch (e) {
              logger.error(`[warm-start] Dispatch failed for subtask #${subtask.id}:`, e);
            }
          });
        },
      );

      // Wait for all queued warm dispatches to finish session creation
      await warmChain;
      if (warmDispatches.length > 0) {
        logger.info(
          `[warm-start] ${warmDispatches.length} root tasks dispatched during streaming: [${warmDispatches.map(d => `#${d.subtaskId}→C${d.crewId}`).join(', ')}]`,
        );
      }

      (globalTokenTracker as any)?.setCurrentTaskId?.(prevTaskId);
      (globalTokenTracker as any)?.setCurrentRole?.(prevRole);
    } catch (e: any) {
      logger.error('Commodore planning failed:', e);
      await warmChain.catch(() => {});
      for (const d of warmDispatches) crew.cancel(d.sessionId).catch(() => {});
      return this.emitEnded(false, e?.message || 'Planning failed');
    }

    if (this.cancelled) {
      for (const d of warmDispatches) crew.cancel(d.sessionId).catch(() => {});
      return this.emitEnded(false, 'Cancelled by user');
    }

    // Cancel any warm dispatches for tasks removed by optimizePlan
    const planIds = new Set(plan.subtasks.map(s => s.id));
    const validDispatches = warmDispatches.filter(d => {
      if (planIds.has(d.subtaskId)) return true;
      crew.cancel(d.sessionId).catch(() => {});
      return false;
    });

    const warmCount = validDispatches.length;
    const planSummary = plan.subtasks.map(s => `  ${s.id}. ${s.title}`).join('\n');
    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'multiagent',
      message: `Plan created: ${plan.subtasks.length} tasks` + (warmCount ? ` (${warmCount} warm-started)` : ''),
    });
    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'planner',
      message: `Plan created (${plan.subtasks.length} subtasks, ${warmCount} warm-started):\n${planSummary}`,
    });

    // --- Phase 2: Quartermaster scheduling + consecutive merging ---
    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'multiagent',
      message: 'Quartermaster assigning crew...',
    });
    const quartermaster = new Quartermaster();

    const initialSchedule = quartermaster.schedule(plan, this.config.maxWorkers);
    const { collapsedPlan } = collapsePlanByConsecutiveMerges(plan, initialSchedule.schedule);
    if (collapsedPlan?.subtasks?.length > 0) plan = collapsedPlan;

    let { schedule, queues } = quartermaster.schedule(plan, this.config.maxWorkers);

    // Remap QM worker IDs → actual crew IDs for warm-dispatched root tasks
    if (validDispatches.length > 0) {
      const earlyMap = new Map(validDispatches.map(d => [d.subtaskId, d.crewId]));
      ({ schedule, queues } = remapSchedule(schedule, queues, earlyMap));
    }

    const qmLog = Quartermaster.buildLog(plan, { schedule, queues }, this.config.maxWorkers);
    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'quartermaster',
      message: Quartermaster.formatSummary(qmLog),
    });
    this.emit('workflow_quartermaster_log', { sessionId: this.sessionId, log: qmLog });

    if (this.cancelled) {
      for (const d of validDispatches) crew.cancel(d.sessionId).catch(() => {});
      return this.emitEnded(false, 'Cancelled by user');
    }

    // --- Phase 3: Initialize state, graph, Captain ---
    const livePlan = new LivePlan(plan);
    this.captainState = new CaptainState(livePlan);
    this.statusMap = this.captainState.subtaskStatus;

    const tabRegistry = new SharedTabRegistry(
      id => livePlan.getTransitiveDependencies(id),
      id => this.captainState!.subtaskStatus.get(id),
    );
    this.taskManager.setSharedTabRegistry(tabRegistry);
    this.lastNodes = plan.subtasks.map(s => ({ id: s.id, title: s.title }));
    this.lastSchedule = schedule;
    this.lastDeps = plan.dependencies;

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
      message: `${activeWorkerCount} Crew deployed`,
    });

    const captainLLM = this.refinerLLM || plannerLLM;
    const captainConfig: CaptainConfig = { maxWorkers: this.config.maxWorkers };

    this.captain = new Captain(this.captainState, crew, captainLLM, this.sessionId, captainConfig, event =>
      this.handleWorkflowEvent(event),
    );

    // Hand warm dispatches to the Captain before run() so completion handlers are wired
    if (validDispatches.length > 0) {
      this.captain.adoptWarmDispatches(validDispatches);
    }

    const graphRefreshTimer = setInterval(() => {
      if (!this.cancelled && this.lastNodes.length > 0) this.updateGraph();
    }, 3000);

    try {
      const finalAnswer = await this.captain.run(validDispatches.length > 0 ? { schedule, queues } : undefined);
      if (!this.cancelled) {
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
      // End orphaned crew sessions so their tasks don't stay stuck as 'running'
      if (this.captainState) {
        await Promise.allSettled(
          Array.from(this.captainState.crewSessionIds.values()).map(sid => crew.endSession(sid, 'error')),
        );
      }
      (this.taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(this.sessionId));
      this.emitEnded(false, e?.message || 'Workflow failed');
    } finally {
      clearInterval(graphRefreshTimer);
    }
  }

  // --- Warm-start helpers ---

  private async dispatchWarmTask(crew: Crew, subtask: Subtask, crewId: number): Promise<WarmDispatch> {
    logger.info(`[warm-start] Creating session for Crew ${crewId} (subtask #${subtask.id} "${subtask.title}")`);
    const sessionId = await crew.createSession(crewId);

    logger.info(`[warm-start] Dispatching subtask #${subtask.id} → Crew ${crewId} (session=${sessionId})`);
    const prompt = buildRootSubtaskPrompt(subtask);
    const resultPromise = crew.dispatch(sessionId, prompt, subtask.id);

    this.emit('workflow_progress', {
      sessionId: this.sessionId,
      actor: 'planner',
      message: `Warm start: Crew ${crewId + 1} deployed early — ${subtask.title}`,
    });
    return { subtaskId: subtask.id, crewId, sessionId, resultPromise };
  }

  async cancelAll(): Promise<void> {
    this.cancelled = true;
    if (this.captain) {
      await this.captain.cancel();
    }
    (this.taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(this.sessionId));
  }

  async pauseAll(reason = 'Paused by user'): Promise<void> {
    if (this.captain) await this.captain.pause(reason);
  }

  async resumeAll(userMessage?: string): Promise<void> {
    if (this.captain) await this.captain.resume(userMessage);
  }

  injectUserMessage(text: string): void {
    if (this.captain) this.captain.injectUserMessage(text);
  }

  cancelUserMessage(text: string): boolean {
    return this.captain?.cancelUserMessage(text) ?? false;
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
          workerId: event.crewId + 1,
          message: `Crew ${event.crewId + 1} deployed: ${title}`,
        });

        // Emit worker session creation if this is the first dispatch for this crew member
        const task = this.taskManager.getTask(this.captainState?.crewSessionIds.get(event.crewId) || '');
        if (task) {
          this.emit('worker_session_created', {
            sessionId: this.sessionId,
            workerId: event.crewId + 1,
            workerSessionId: this.captainState?.crewSessionIds.get(event.crewId),
            color: task.color,
          });
        }
        this.updateGraph();
        break;
      }

      case 'subtask_running':
        this.updateGraph();
        break;

      case 'subtask_completed': {
        const title = this.captainState?.plan.getSubtask(event.subtaskId)?.title ?? '';
        const workerId = (this.captainState?.crewAssignments.get(event.subtaskId) ?? 0) + 1;
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
        this.updateGraph();
        break;
      }

      case 'subtask_failed': {
        const title = this.captainState?.plan.getSubtask(event.subtaskId)?.title ?? '';
        const failWorkerId = (this.captainState?.crewAssignments.get(event.subtaskId) ?? 0) + 1;
        this.emit('workflow_progress', {
          sessionId: this.sessionId,
          actor: 'multiagent',
          workerId: failWorkerId,
          message: `Failed: ${title} — ${event.error}`,
        });
        this.updateGraph();
        break;
      }

      case 'captain_decision':
        this.emit('workflow_progress', {
          sessionId: this.sessionId,
          actor: 'captain',
          message: event.decision.status_message,
          drainedMessages: event.drainedMessages,
        });
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

      case 'plan_modified': {
        // Re-cache graph data from the updated plan
        if (this.captainState) {
          const updated = this.captainState.plan.toTaskPlan();
          this.lastNodes = updated.subtasks.map(s => ({ id: s.id, title: s.title }));
          this.lastDeps = updated.dependencies;
          const result = new Quartermaster().schedule(updated, this.config.maxWorkers);
          this.lastSchedule = result.schedule;
          const log = Quartermaster.buildLog(updated, result, this.config.maxWorkers, event.reason);
          this.emit('workflow_progress', {
            sessionId: this.sessionId,
            actor: 'quartermaster',
            message: Quartermaster.formatSummary(log),
          });
          this.emit('workflow_quartermaster_log', { sessionId: this.sessionId, log });
        }
        this.updateGraph();
        break;
      }

      case 'workflow_paused':
        this.emit('workflow_progress', {
          sessionId: this.sessionId,
          actor: 'captain',
          message: `Paused: ${event.reason}`,
        });
        this.emit('workflow_paused', { sessionId: this.sessionId, reason: event.reason });
        break;

      case 'workflow_resumed':
        this.emit('workflow_progress', {
          sessionId: this.sessionId,
          actor: 'captain',
          message: 'Workflow resumed',
        });
        break;

      case 'workflow_complete':
        break;

      case 'workflow_aborted':
        this.trace('system', `Workflow aborted: ${event.reason}`);
        this.updateGraph();
        this.emitEnded(false, event.reason);
        break;
    }
  }

  // --- Helpers ---

  private emitSeq = 0;

  private emit(type: string, data: any): void {
    const port = this.getPort();
    if (import.meta.env.DEV) {
      logger.info(`[emit] ${type}`, data?.message || data?.text || '');
    }

    // Attach a stable eventId so background + panel dedup to one trace item
    if (type === 'workflow_progress' && data?.message) {
      const eventId = `ma-${this.sessionId}-${++this.emitSeq}`;
      data = { ...data, eventId };
      const actor = data.actor || 'multiagent';
      const wid = data.workerId;
      // Only persist role-specific or crew items; generic 'multiagent' without
      // workerId are ephemeral status updates (e.g. "Commodore planning...",
      // "Plan created: N tasks") that drive the aggregate root content only.
      if (actor !== 'multiagent' || wid != null) {
        try {
          trajectoryPersistence.addTraceItem(this.sessionId, actor, data.message, Date.now(), {
            ...(wid != null && { workerId: wid }),
            eventId,
          });
        } catch {}
      }
    }

    if (port) {
      safePostMessage(port as any, { type, data });
    } else if (import.meta.env.DEV) {
      logger.warning(`[emit] No port available for ${type} — message dropped`);
    }
  }

  private traceSeq = 0;

  private trace(actor: string, content: string, workerId?: number): void {
    try {
      const eventId = `mat-${this.sessionId}-${++this.traceSeq}`;
      trajectoryPersistence.addTraceItem(this.sessionId, actor, content, Date.now(), {
        ...(workerId != null && { workerId }),
        eventId,
      });
    } catch {}
  }

  private buildSummary(): any {
    try {
      const usages = globalTokenTracker.getTokensForTask(this.sessionId);
      if (!usages || usages.length === 0) return null;
      let inputTokens = 0;
      let outputTokens = 0;
      let totalCost = 0;
      let hasAnyCost = false;
      const timestamps: number[] = [];
      const startTimes: number[] = [];
      for (const u of usages) {
        inputTokens += Math.max(0, Number((u as any).inputTokens) || 0);
        outputTokens += Math.max(0, Number((u as any).outputTokens) || 0);
        const c = Number((u as any).cost);
        if (isFinite(c) && c >= 0) {
          totalCost += c;
          hasAnyCost = true;
        }
        const ts = Number((u as any).timestamp);
        if (isFinite(ts) && ts > 0) timestamps.push(ts);
        const start = Number((u as any).requestStartTime || (u as any).timestamp);
        if (isFinite(start) && start > 0) startTimes.push(start);
      }
      if (!hasAnyCost) totalCost = -1;
      let totalLatencyMs = 0;
      if (startTimes.length > 0 && timestamps.length > 0) {
        totalLatencyMs = Math.max(0, Math.max(...timestamps) - Math.min(...startTimes));
      }
      return {
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        totalCost,
        totalLatencyMs,
        totalLatencySeconds: (totalLatencyMs / 1000).toFixed(2),
        apiCallCount: usages.length,
      };
    } catch {
      return null;
    }
  }

  private emitEnded(ok: boolean, error?: string): void {
    const summary = this.buildSummary();
    this.emit('workflow_ended', { sessionId: this.sessionId, ok, error, summary });
    try {
      if (!ok && error) this.trace('system', `Workflow failed: ${error}`);
      // Attach graph + plan items to the trajectory BEFORE markCompleted so they
      // are included in the same persistNow write (avoids race with a separate call).
      const patch: Record<string, any> = {};
      const graph = this.getCurrentGraph();
      if (graph) {
        patch.__workflowGraph = graph;
        patch.__workflowGraphInitial = graph;
      }
      if (this.captainState?.plan) {
        const subtasks = this.captainState.plan.getAllSubtasks();
        if (subtasks.length > 0) {
          patch.__workflowPlanItems = subtasks.map(s => ({
            text: s.title,
            status:
              this.resolveNodeStatus(s.id) === 'completed' ? 'done' : String(this.resolveNodeStatus(s.id) || 'pending'),
          }));
        }
      }
      if (Object.keys(patch).length > 0) {
        trajectoryPersistence.setExtraMetadata(this.sessionId, patch);
      }
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
        status: this.resolveNodeStatus(n.id),
      })),
    };
    this.emit('workflow_graph_update', { sessionId: this.sessionId, graph: annotated });
  }
}
