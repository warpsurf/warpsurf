import { createLogger } from '@src/log';
import type { TaskManager } from '../../task/task-manager';
import type { WorkflowEventsPort, WorkflowConfig, TaskPlan, SubtaskId, SubtaskOutputs, PriorOutput } from './multiagent-types';
import { planSubtasksFromQuery } from './multiagent-planner';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import { buildChatHistoryBlock } from '@src/workflows/shared/utils/chat-history';
import { allocateTasks, deriveWorkerQueues } from './multiagent-scheduler';
import { buildMergedGraphAfterScheduleConsecutive, collapsePlanByConsecutiveMerges } from './multiagent-merging';
import { refinePlanWithLLM } from './multiagent-refiner';
import { buildGraphData } from './multiagent-visualization';
import { buildPriorOutputsSection } from './multiagent-placeholders';
import { errorLog } from '../../utils/error-log';
import { globalTokenTracker } from '../../utils/token-tracker';
import { safePostMessage } from '@extension/shared/lib/utils';

const logger = createLogger('workflow:multiagent');

/**
 * Coordinates multiple parallel browser agents for complex tasks.
 * Decomposes tasks into subtasks, schedules workers, and merges results.
 */
export class MultiAgentWorkflow {
  private taskManager: TaskManager;
  private port: WorkflowEventsPort;
  private config: WorkflowConfig;
  private sessionId: string;
  private subtasksById = new Map<SubtaskId, { title: string; prompt: string; deps: SubtaskId[]; isFinal?: boolean; noBrowse?: boolean; suggestedUrls?: string[]; suggestedSearchQueries?: string[] }>();
  private outputs: SubtaskOutputs = {};
  // Persisted outputs by session; in-memory map for development as requested
  private static persistedBySession: Map<string, SubtaskOutputs> = new Map();
  private status: Map<SubtaskId, 'not_started' | 'running' | 'completed' | 'failed' | 'cancelled'> = new Map();
  private workerTaskIds: number[] = [];
  private workerSessionIdByWorker = new Map<number, string>();
  private busyWorkers = new Set<number>();
  // v2 workflow: disable shared groups; keep fields for backward compatibility but unused
  private primaryGroupId?: number;
  private primaryGroupColor?: chrome.tabGroups.Color;
  private cancelled = false;
  // Cache last graph inputs for reliable redraws (e.g., on cancel)
  private lastNodes: Array<{ id: number; title: string }> = [];
  private lastSchedule: Record<number, number[]> = {};
  private lastDeps: Record<number, number[]> = {};
  private currentPlan?: TaskPlan;
  // refinementPerformed exists elsewhere; do not redeclare
  private refinementPerformed = false;
  private refinerLLM: any | null = null;
  private abortController: AbortController = new AbortController();

  constructor(taskManager: TaskManager, port: WorkflowEventsPort, sessionId: string, config: WorkflowConfig) {
    this.taskManager = taskManager;
    this.port = port;
    this.sessionId = sessionId;
    this.config = { maxWorkers: Math.max(1, config.maxWorkers || 16) };
  }

  /** Optional setter to inject a dedicated refiner model separate from the planner model. */
  setRefinerModel(llm: any | null) {
    this.refinerLLM = llm;
  }

  private emit(type: string, data: any) {
    safePostMessage(this.port, { type, data });
  }

  private buildDispatchPrompt(subtaskId: SubtaskId): string {
    const s = this.subtasksById.get(subtaskId)!;
    // Gather prior outputs for deps
    const priors: PriorOutput[] = [];
    for (const d of s.deps) {
      const o = this.outputs[d];
      if (o) priors.push({ title: this.subtasksById.get(d)?.title || `Task ${d}`, output: o.result, tabIds: o.tabIds || [], rawJson: o.raw });
    }
    const priorText = priors.length > 0 ? `\n\n${buildPriorOutputsSection(priors)}` : '';
    const header = [
      `\nYour task is to ${s.title}.\nSpecifically, you must: ${s.prompt}`,
    ].join('\n');
    const suggestions: string[] = [];
    const sugUrls = Array.isArray(s.suggestedUrls) ? s.suggestedUrls : [];
    const sugQueries = Array.isArray(s.suggestedSearchQueries) ? s.suggestedSearchQueries : [];
    if (sugUrls.length > 0) {
      suggestions.push(['Suggested URLs:', ...sugUrls.map((u: string) => `- ${u}`)].join('\n'));
    } else if (sugQueries.length > 0) {
      suggestions.push(['Suggested search queries:', ...sugQueries.map((q: string) => `- ${q}`)].join('\n'));
    }
    const suggestionText = suggestions.length > 0 ? `\n\n${suggestions.join('\n')}` : '';
    return `${header}${suggestionText}${priorText}`;
  }

  private updateGraph(nodes: Array<{ id: number; title: string }>, workerSchedules: Record<number, number[]>, deps: Record<number, number[]>) {
    // Persist last-known graph inputs for later status-only redraws
    this.lastNodes = nodes;
    this.lastSchedule = workerSchedules;
    this.lastDeps = deps;
    const titles: Record<number, string> = {};
    for (const n of nodes) titles[n.id] = n.title;
    const merged = buildMergedGraphAfterScheduleConsecutive(deps, titles, workerSchedules);
    const graph = buildGraphData(merged.vizSchedules, merged.dependenciesViz, merged.groupTitles, merged.durations);
    // attach status coloring
    const annotated = {
      ...graph,
      nodes: graph.nodes.map(n => ({ ...n, status: this.status.get(n.id) || 'not_started' })),
    };
    this.emit('workflow_graph_update', { sessionId: this.sessionId, graph: annotated });
  }

  private setStatus(id: SubtaskId, st: 'not_started' | 'running' | 'completed' | 'failed' | 'cancelled') {
    this.status.set(id, st);
  }

  async start(query: string, plannerLLM: any): Promise<void> {
    this.cancelled = false;
    this.abortController.abort();
    this.abortController = new AbortController();
    (globalTokenTracker as any)?.clearTokensForTask?.(String(this.sessionId));
    const oldWorkers = (globalTokenTracker as any)?.getWorkersForParent?.(String(this.sessionId));
    if (Array.isArray(oldWorkers)) {
      for (const w of oldWorkers) {
        (globalTokenTracker as any)?.clearTokensForTask?.(String((w as any)?.sessionId || ''));
      }
    }
    
    // Increment workflow run index for this session (to distinguish multiple runs in logs)
    const runIndex = (globalTokenTracker as any)?.incrementWorkflowRunIndex?.(String(this.sessionId)) || 1;
    logger.info(`[Orchestrator] Starting workflow run ${runIndex} for session ${this.sessionId}`);
    
    // 0) Emit immediate overall progress so the UI shows activity right away
    this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', message: 'Creating plan...' });
    
    // Check if cancelled before planning
    if (this.cancelled) {
      this.emit('workflow_ended', { sessionId: this.sessionId, ok: false, error: 'Cancelled by user' });
      return;
    }
    
    // 1) Plan
    let plan: TaskPlan;
    {
      const prevTaskId = (globalTokenTracker as any)?.getCurrentTaskId?.() || null;
      const prevRole = (globalTokenTracker as any)?.getCurrentRole?.() || null;
      try {
        (globalTokenTracker as any)?.setCurrentTaskId?.(this.sessionId);
        (globalTokenTracker as any)?.setCurrentRole?.('planner');
        let historyBlock: string | undefined;
        const session = await chatHistoryStore.getSession(this.sessionId).catch(() => null);
        if (session) {
          const sessionMsgs = Array.isArray(session?.messages) ? session!.messages : [];
          const block = buildChatHistoryBlock(sessionMsgs as any, { latestTaskText: query, stripUserRequestTags: true, maxTurns: 6 });
          if (block && block.trim().length > 0) historyBlock = block;
        }
        plan = await planSubtasksFromQuery(query, plannerLLM, this.config.maxWorkers, this.abortController.signal, historyBlock, this.sessionId);
      } finally {
        (globalTokenTracker as any)?.setCurrentTaskId?.(prevTaskId);
        (globalTokenTracker as any)?.setCurrentRole?.(prevRole);
      }
    }
    
    // Check if cancelled after planning
    if (this.cancelled) {
      this.emit('workflow_ended', { sessionId: this.sessionId, ok: false, error: 'Cancelled by user' });
      return;
    }
    const plannerOutput = JSON.stringify(plan, null, 2);
    this.emit('workflow_progress', { 
      sessionId: this.sessionId, 
      actor: 'planner', 
      message: `Plan created:\n${plannerOutput}` 
    });
    // Emit overseer/overall progress to UI after planning completes
    this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', message: `Planning complete. Scheduling workers for: ${plan.task}` });
    let nodes = plan.subtasks.map(s => ({ id: s.id, title: s.title }));
    for (const s of plan.subtasks) {
      this.subtasksById.set(s.id, { title: s.title, prompt: s.prompt, deps: s.startCriteria, isFinal: !!s.isFinal, noBrowse: (s as any).noBrowse, suggestedUrls: (s as any).suggestedUrls, suggestedSearchQueries: (s as any).suggestedSearchQueries });
      this.setStatus(s.id, 'not_started');
    }
    this.currentPlan = plan;

    // 2) Schedule (initial)
    this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', message: 'Processing plan...' });
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    
    // Check if cancelled before scheduling
    if (this.cancelled) {
      this.emit('workflow_ended', { sessionId: this.sessionId, ok: false, error: 'Cancelled by user' });
      return;
    }
    
    let schedule = allocateTasks(plan.dependencies, plan.durations, this.config.maxWorkers);
    const { collapsedPlan } = collapsePlanByConsecutiveMerges(plan, schedule);
    if (collapsedPlan && Array.isArray(collapsedPlan.subtasks) && collapsedPlan.subtasks.length > 0) {
      plan = collapsedPlan;
      this.currentPlan = collapsedPlan;
    }

    // Recompute schedule and queues based on the collapsed plan
    schedule = allocateTasks(plan.dependencies, plan.durations, this.config.maxWorkers);
    const queues = deriveWorkerQueues(schedule);

    // Rebuild subtasks mapping after collapse
    this.subtasksById.clear();
    for (const s of plan.subtasks) {
      this.subtasksById.set(s.id, { title: s.title, prompt: s.prompt, deps: s.startCriteria, isFinal: !!s.isFinal, noBrowse: (s as any).noBrowse, suggestedUrls: (s as any).suggestedUrls, suggestedSearchQueries: (s as any).suggestedSearchQueries });
      if (!this.status.has(s.id)) this.setStatus(s.id, 'not_started');
    }
    nodes = plan.subtasks.map(s => ({ id: s.id, title: s.title }));

    // 2.5) Optional refinement: improve prompts/titles/noBrowse using the planner model on the collapsed plan
    if (!this.refinementPerformed && !this.cancelled) {
      try {
        this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', message: 'Refining plan...' });
        
        // Check if cancelled before refinement
        if (this.cancelled) {
          this.emit('workflow_ended', { sessionId: this.sessionId, ok: false, error: 'Cancelled by user' });
          return;
        }
        
        // Prefer a dedicated Refiner model if provided; otherwise fall back to plannerLLM
        const llmForRefinement = this.refinerLLM || plannerLLM;
        const prevTaskId = (globalTokenTracker as any)?.getCurrentTaskId?.() || null;
        const prevRole = (globalTokenTracker as any)?.getCurrentRole?.() || null;
        let refined: TaskPlan;
        try {
          (globalTokenTracker as any)?.setCurrentTaskId?.(this.sessionId);
          (globalTokenTracker as any)?.setCurrentRole?.('refiner');
          refined = await refinePlanWithLLM(plan, llmForRefinement, this.abortController.signal, this.sessionId);
        } finally {
          (globalTokenTracker as any)?.setCurrentTaskId?.(prevTaskId);
          (globalTokenTracker as any)?.setCurrentRole?.(prevRole);
        }
        
        // Check if cancelled after refinement
        if (this.cancelled) {
          this.emit('workflow_ended', { sessionId: this.sessionId, ok: false, error: 'Cancelled by user' });
          return;
        }
        // Rebuild subtasksById from refined plan (still collapsed structure)
        this.subtasksById.clear();
        for (const s of refined.subtasks) {
          this.subtasksById.set(s.id, { title: s.title, prompt: s.prompt, deps: s.startCriteria, isFinal: !!s.isFinal, noBrowse: (s as any).noBrowse, suggestedUrls: (s as any).suggestedUrls, suggestedSearchQueries: (s as any).suggestedSearchQueries });
        }
        // Overwrite plan reference so downstream dataset/graph reflect refinements
        plan = refined;
        this.currentPlan = refined;
        nodes = plan.subtasks.map(s => ({ id: s.id, title: s.title }));
        const refinedOutput = JSON.stringify(refined, null, 2);
        this.emit('workflow_progress', { 
          sessionId: this.sessionId, 
          actor: 'refiner', 
          message: `Plan refined:\n${refinedOutput}` 
        });
        this.refinementPerformed = true;
        this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', message: 'Refinement complete.' });
      } catch (e) {
        // On any failure, continue with original plan
        this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', message: 'Refinement skipped (error). Proceeding.' });
      }
    } else {
      this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', message: 'Refinement already performed. Skipping.' });
    }

    const taskWorkerMap: Record<number, number> = {};
    for (const [widStr, arr] of Object.entries(queues)) {
      const wid = Number(widStr);
      for (const t of arr) taskWorkerMap[Number(t)] = wid;
    }
    const dataset = {
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
        no_browse: !!(s as any).noBrowse,
        suggested_urls: (s as any).suggestedUrls || [],
        suggested_search_queries: (s as any).suggestedSearchQueries || [],
        worker: taskWorkerMap[s.id] ?? null,
      })),
    };
    this.emit('workflow_plan_dataset', { sessionId: this.sessionId, dataset });

    this.updateGraph(nodes, schedule, plan.dependencies);

    // Disable shared group coordination in v2; each worker maintains its own dedicated group
    // This avoids mixing tabs and ensures isolation and non-duplication of searches per worker.

    this.workerTaskIds = Object.keys(queues).map(n => Number(n));
    const activeWorkerCount = Object.values(queues).filter(q => Array.isArray(q) && q.length > 0).length;
    this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', message: `${activeWorkerCount} workers executing plan...` });
    for (const wid of this.workerTaskIds) {
      const humanIndex = wid + 1;
      this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', workerId: humanIndex, message: `Worker ${humanIndex} ready` });
    }

    // 4) Dispatch loop honoring deps; failure policy: cancel all on first failure
    // Track whether a task is already enqueued or completed
    const done = new Set<number>();
    const enqueued = new Set<number>();
    const workerToQueueIds = new Map<number, number[]>(Object.entries(queues).map(([wid, q]) => [Number(wid), q.slice()]));
    const taskToWorker = new Map<number, number>();
    for (const [wid, q] of workerToQueueIds.entries()) for (const t of q) taskToWorker.set(t, wid);
    const queuePointers = new Map<number, number>(); // per-worker scan cursor to avoid re-scanning from start forever
    for (const wid of workerToQueueIds.keys()) queuePointers.set(wid, 0);

    const tryDispatch = async () => {
      // Stop dispatching if cancelled
      if (this.cancelled) {
        return false;
      }
      
      let progress = false;
      for (const [wid, q] of workerToQueueIds.entries()) {
        // Check cancellation before each worker dispatch
        if (this.cancelled) {
          return false;
        }
        
        if (this.busyWorkers.has(wid)) continue; // do not dispatch if worker already running a subtask
        // Find next not-started, deps satisfied task for this worker
        const startIdx = queuePointers.get(wid) ?? 0;
        for (let i = startIdx; i < q.length; i++) {
          const t = q[i];
          if (done.has(t) || enqueued.has(t)) continue;
          const s = this.subtasksById.get(t)!;
          if (s.deps.every(d => done.has(d))) {
            // If cancelled between loop checks, mark as cancelled and skip starting
            if (this.cancelled) {
              this.setStatus(t, 'cancelled');
              done.add(t);
              this.updateGraph(nodes, schedule, plan.dependencies);
              continue;
            }
            enqueued.add(t);
            progress = true;
            // Build prompt with prior outputs
            const prompt = this.buildDispatchPrompt(t);
            // Ensure a worker session exists for this worker; lazily create if missing
            let sessionId = this.workerSessionIdByWorker.get(wid);
            if (!sessionId) {
              const humanIndexLazy = wid + 1;
              const pretty = `Web Agent ${humanIndexLazy}`;
              // Do not set an initial user task to avoid confusing workers before dispatch.
              // The specific subtask will be delivered as the first follow-up instruction.
              const initialInstruction = '';
              logger.info(`[Orchestrator] Creating worker session for Web Agent ${humanIndexLazy} (wid=${wid})`);
              try {
                sessionId = await this.taskManager.createWorkerSession(initialInstruction, pretty, this.sessionId, plan.task, humanIndexLazy);
                this.workerSessionIdByWorker.set(wid, sessionId);
                const task = this.taskManager.getTask(sessionId);
                logger.info(`[Orchestrator] Successfully created worker session ${sessionId} for Web Agent ${humanIndexLazy}`);
                this.emit('worker_session_created', { sessionId: this.sessionId, workerId: humanIndexLazy, workerSessionId: sessionId, color: task?.color });
              } catch (error) {
                logger.error(`[Orchestrator] Failed to create worker session for Web Agent ${humanIndexLazy}:`, error);
                throw error;
              }
              if (this.cancelled) {
                await this.taskManager.endWorkerSession(sessionId, 'cancelled').catch(() => {});
                this.setStatus(t, 'cancelled');
                done.add(t);
                this.updateGraph(nodes, schedule, plan.dependencies);
                continue;
              }
            }
            this.busyWorkers.add(wid);
            this.setStatus(t, 'running');
            this.updateGraph(nodes, schedule, plan.dependencies);
            // Emit per-worker task start progress only if not cancelled
            if (!this.cancelled) {
              this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', workerId: (wid + 1), message: `Starting subtask ${t}: ${this.subtasksById.get(t)?.title || ''}` });
            }
            // Run subtask on this worker session
            (async () => {
              // Check if cancelled before running subtask
              if (this.cancelled) {
                this.setStatus(t, 'cancelled');
                done.add(t);
                this.busyWorkers.delete(wid);
                this.updateGraph(nodes, schedule, plan.dependencies);
                return;
              }
              
              // If this subtask depends on previous outputs that include tabIds, pass them to reuse
              const depTabIds = s.deps.flatMap(d => (this.outputs[d]?.tabIds || []));
              const uniqueTabIds = Array.from(new Set(depTabIds)).filter(n => typeof n === 'number') as number[];
              const res = await this.taskManager.runWorkerSubtask(sessionId!, prompt, uniqueTabIds.length > 0 ? uniqueTabIds : undefined, t);
              const ot = (res as any)?.outputText;
              if (typeof ot === 'string' && ot.toLowerCase().includes('cancel')) {
                this.setStatus(t, 'cancelled');
                this.cancelled = true;
                await Promise.all(Array.from(this.workerSessionIdByWorker.values()).map(id => 
                  this.taskManager.endWorkerSession(id, 'cancelled').catch(() => {})
                ));
                this.busyWorkers.delete(wid);
                this.updateGraph(nodes, schedule, plan.dependencies);
                this.emit('workflow_ended', { sessionId: this.sessionId, ok: false, error: 'Cancelled by user' });
                return;
              }
              if (!res.ok) {
                this.setStatus(t, 'failed');
                this.cancelled = true;
                errorLog.add({
                  sessionId: this.sessionId,
                  taskId: sessionId!,
                  workerId: (wid + 1),
                  source: 'worker_failure',
                  message: res.error || 'Subtask failed',
                });
                await Promise.all(Array.from(this.workerSessionIdByWorker.values()).map(id => 
                  this.taskManager.endWorkerSession(id, 'cancelled').catch(() => {})
                ));
                (this.taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(this.sessionId));
                this.busyWorkers.delete(wid);
                this.updateGraph(nodes, schedule, plan.dependencies);
                this.emit('workflow_ended', { sessionId: this.sessionId, ok: false, error: res.error || 'Subtask failed' });
                return;
              }
              // Emit worker output to UI for visibility
              if (res.outputText) {
                this.emit('workflow_progress', { 
                  sessionId: this.sessionId, 
                  actor: 'multiagent',  // Use a recognized actor 
                  workerId: (wid + 1), 
                  message: res.outputText 
                });
              }
              
              let rawOut: any = undefined;
              if (res.outputText && typeof res.outputText === 'string') {
                const trimmed = res.outputText.trim();
                const fence = trimmed.match(/```json\s*([\s\S]*?)```/i);
                const candidate = fence ? fence[1] : trimmed;
                if ((candidate.startsWith('[') && candidate.endsWith(']')) || (candidate.startsWith('{') && candidate.endsWith('}'))) {
                  try {
                    rawOut = JSON.parse(candidate);
                  } catch {
                    // Invalid JSON, keep as text
                  }
                }
              }
              this.outputs[t] = { result: res.outputText || (rawOut ? JSON.stringify(rawOut) : ''), raw: rawOut, tabIds: res.tabIds || [] };
              if (this.cancelled) {
                this.setStatus(t, 'cancelled');
              } else {
                this.setStatus(t, 'completed');
              }
              done.add(t);
              this.busyWorkers.delete(wid);
              // Emit per-worker completion only if not cancelled
              if (!this.cancelled) {
                this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', workerId: (wid + 1), message: `Completed subtask ${t}` });
              }
              // persist after each completion (dev-time persistence)
              MultiAgentWorkflow.persistedBySession.set(this.sessionId, this.outputs);
              this.updateGraph(nodes, schedule, plan.dependencies);
              const buildFinalText = (): string => {
                if (this.subtasksById.get(t)?.isFinal) {
                  const out = (this.outputs[t]?.result || '').toString().trim();
                  const raw = (this.outputs[t]?.raw as any);
                  if (raw && typeof raw === 'object') {
                    const fromDone = (raw?.done?.text || raw?.text);
                    const s = (fromDone || '').toString().trim();
                    if (s.length > 0) return s;
                  }
                  if (out.length > 0) return out;
                }
                const orderedIds = Array.from(this.subtasksById.keys()).sort((a, b) => a - b);
                const parts: string[] = [];
                for (const id of orderedIds) {
                  const val = (this.outputs[id]?.result || '').toString().trim();
                  if (val) parts.push(val);
                  if (parts.join('\n\n').length > 4000) break;
                }
                const joined = parts.join('\n\n').trim();
                return joined.length > 0 ? joined : 'Workflow completed successfully.';
              };

              if (this.subtasksById.get(t)?.isFinal) {
                if (!this.cancelled) {
                  const finalText = buildFinalText();
                  this.emit('final_answer', { sessionId: this.sessionId, text: finalText });
                  await Promise.all(Array.from(this.workerSessionIdByWorker.values()).map(id => 
                    this.taskManager.endWorkerSession(id, 'completed').catch(() => {})
                  ));
                  (this.taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(this.sessionId));
                  this.emit('workflow_ended', { sessionId: this.sessionId, ok: true });
                  return;
                }
              }
              if (done.size >= this.subtasksById.size) {
                if (!this.cancelled) {
                  await Promise.all(Array.from(this.workerSessionIdByWorker.values()).map(id => 
                    this.taskManager.endWorkerSession(id, 'completed').catch(() => {})
                  ));
                  const finalText = (() => {
                    const orderedIds = Array.from(this.subtasksById.keys()).sort((a, b) => a - b);
                    const parts: string[] = [];
                    for (const id of orderedIds) {
                      const val = (this.outputs[id]?.result || '').toString().trim();
                      if (val) parts.push(val);
                      if (parts.join('\n\n').length > 4000) break;
                    }
                    const joined = parts.join('\n\n').trim();
                    return joined.length > 0 ? joined : 'Workflow completed successfully.';
                  })();
                  this.emit('final_answer', { sessionId: this.sessionId, text: finalText });
                  (this.taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(this.sessionId));
                  this.emit('workflow_ended', { sessionId: this.sessionId, ok: true });
                  return;
                }
              }
              // Continue dispatching after a completion without deep recursion (unless cancelled)
              if (!this.cancelled) {
                setTimeout(() => { tryDispatch().catch(() => {}); }, 0);
              }
            })();
            // Advance the worker's scan cursor past this index to avoid re-visiting
            queuePointers.set(wid, i + 1);
            break; // dispatch one at a time per call
          }
        }
      }
      return progress;
    };

    // Check if cancelled before initial dispatch
    if (this.cancelled) {
      this.emit('workflow_ended', { sessionId: this.sessionId, ok: false, error: 'Cancelled by user' });
      return;
    }
    
    // Kick off initial dispatch until no progress; subsequent progress occurs in callbacks
    await tryDispatch();
  }

  /** Robustly cancels all workflow activity with timeout for stuck workers */
  async cancelAll(): Promise<void> {
    this.emit('workflow_progress', { sessionId: this.sessionId, actor: 'multiagent', message: 'Cancelling workflow...' });
    
    this.cancelled = true;
    this.abortController.abort();
    
    // Mark non-completed tasks as cancelled
    for (const [id, st] of this.status.entries()) {
      if (st !== 'completed') this.status.set(id, 'cancelled');
    }
    this.busyWorkers.clear();
    
    // Actively cancel running tasks AND end worker sessions
    const cancellationPromises = Array.from(this.workerSessionIdByWorker.entries()).map(
      async ([workerId, sessionId]) => {
        try { await this.taskManager.cancelTask(sessionId); } catch {}
        try { await this.taskManager.endWorkerSession(sessionId, 'cancelled'); } catch {}
      }
    );
    
    // Also cancel any worker sessions linked to parent session
    try { await (this.taskManager as any).cancelAllForParentSession?.(this.sessionId); } catch {}
    
    // Wait with 3s timeout to avoid hanging on stuck workers
    await Promise.race([
      Promise.allSettled(cancellationPromises),
      new Promise<void>(resolve => setTimeout(resolve, 3000))
    ]);
    
    this.workerSessionIdByWorker.clear();
    
    // Update graph to show cancelled state
    if (this.lastNodes.length > 0) {
      this.updateGraph(this.lastNodes, this.lastSchedule, this.lastDeps);
    } else {
      const nodes = Array.from(this.subtasksById.entries()).map(([id, s]) => ({ id, title: s.title }));
      const deps: Record<number, number[]> = {};
      for (const [id, s] of this.subtasksById.entries()) deps[id] = s.deps || [];
      this.updateGraph(nodes, this.lastSchedule, deps);
    }
    
    // Freeze mirrors so previews remain visible
    try { await (this.taskManager as any).tabMirrorService?.freezeMirrorsForSession?.(String(this.sessionId)); } catch {}
    
    // Build summary from token usage
    const usages = (globalTokenTracker as any)?.getTokensForTask?.(this.sessionId) || [];
    let summary: any | undefined;
    if (Array.isArray(usages) && usages.length > 0) {
      const totalInputTokens = usages.reduce((sum: number, u: any) => sum + (u.inputTokens || 0), 0);
      const totalOutputTokens = usages.reduce((sum: number, u: any) => sum + (u.outputTokens || 0), 0);
      let hasAnyCost = false;
      const totalCost = usages.reduce((sum: number, u: any) => {
        const c = Number(u.cost);
        if (isFinite(c) && c >= 0) { hasAnyCost = true; return sum + c; }
        return sum;
      }, 0) || (hasAnyCost ? 0 : -1);
      const last = usages[usages.length - 1] || {};
      const ts = usages.map((u: any) => Number(u?.timestamp || 0)).filter((n: number) => Number.isFinite(n) && n > 0).sort((a: number, b: number) => a - b);
      const totalLatencyMs = ts.length >= 2 ? Math.max(0, ts[ts.length - 1] - ts[0]) : (ts.length === 1 ? 100 : 0);
      summary = { totalInputTokens, totalOutputTokens, totalLatencyMs, totalLatencySeconds: (totalLatencyMs / 1000).toFixed(2), totalCost, apiCallCount: usages.length, provider: last.provider || 'Unknown', modelName: last.modelName || 'unknown' };
    }
    
    this.emit('workflow_ended', { sessionId: this.sessionId, ok: false, error: 'Cancelled by user', summary });
  }
}

