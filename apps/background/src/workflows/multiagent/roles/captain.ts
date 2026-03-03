import { createLogger } from '@src/log';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { extractJsonFromModelOutput } from '@src/workflows/shared/messages/utils';
import { logLLMUsage, globalTokenTracker } from '@src/utils/token-tracker';
import { generalSettingsStore } from '@extension/storage';
import { captainSystemPrompt } from './captain-prompt';
import { Quartermaster } from './quartermaster';
import { Crew, type CrewResult } from './crew';
import { CaptainState } from '../captain-state';
import { buildPriorOutputsSection } from '../multiagent-placeholders';
import type { SubtaskId, PriorOutput, WorkerSchedule, WorkerQueues } from '../multiagent-types';
import type { CaptainDecision, CaptainActionType, StructuredOutput, WorkflowEvent } from '../workflow-events';

const logger = createLogger('Captain');

const DEFAULT_MAX_RETRIES = 1;

const POLL_INTERVAL_BASE_MS = 30_000;
const POLL_INTERVAL_FAST_MS = 15_000;
const OVERDUE_THRESHOLD_MS = 120_000;
const EVENT_DEDUP_WINDOW_MS = 10_000;

export interface CaptainConfig {
  maxWorkers: number;
  maxRetries?: number;
}

export interface WarmDispatch {
  subtaskId: SubtaskId;
  crewId: number;
  sessionId: string;
  resultPromise: Promise<CrewResult>;
}

export interface WarmStartSchedule {
  schedule: WorkerSchedule;
  queues: WorkerQueues;
}

type EventHandler = (event: WorkflowEvent) => void;

/**
 * The Captain proactively oversees workflow execution in real-time.
 *
 * Consulted via LLM on three triggers:
 * 1. Periodic polling (30s base, 15s when subtasks are overdue)
 * 2. Every subtask completion (to review output and adjust downstream tasks)
 * 3. Every subtask failure (to decide on retry strategy before blind retry)
 *
 * A dedup guard prevents redundant calls when events fire close together.
 */
export class Captain {
  private state: CaptainState;
  private quartermaster = new Quartermaster();
  private crew: Crew;
  private config: Required<Pick<CaptainConfig, 'maxWorkers' | 'maxRetries'>>;
  private llm: any;
  private sessionId: string;
  private cancelled = false;
  private abortController = new AbortController();
  private onEvent: EventHandler;
  private crewQueues: Record<number, number[]> = {};

  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private currentPollIntervalMs = POLL_INTERVAL_BASE_MS;
  private lastCaptainCallTime = 0;
  private captainCallInFlight = false;

  constructor(
    state: CaptainState,
    crew: Crew,
    llm: any,
    sessionId: string,
    config: CaptainConfig,
    onEvent: EventHandler,
  ) {
    this.state = state;
    this.crew = crew;
    this.llm = llm;
    this.sessionId = sessionId;
    this.config = {
      maxWorkers: config.maxWorkers,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    };
    this.onEvent = onEvent;

    this.state.setCrewLogProvider(sid => this.crew.getSessionLogs(sid));
  }

  /**
   * Wire up already-dispatched warm-start tasks so completion flows through
   * the Captain's normal handleSubtaskCompleted / handleSubtaskFailed path.
   * Must be called BEFORE run().
   */
  adoptWarmDispatches(dispatches: WarmDispatch[]): void {
    for (const d of dispatches) {
      this.state.crewSessionIds.set(d.crewId, d.sessionId);
      this.state.crewAssignments.set(d.subtaskId, d.crewId);
      this.state.busyCrew.add(d.crewId);
      this.state.markRunning(d.subtaskId);

      this.onEvent({ type: 'subtask_dispatched', subtaskId: d.subtaskId, crewId: d.crewId, prompt: '' });
      this.onEvent({ type: 'subtask_running', subtaskId: d.subtaskId });

      d.resultPromise.then(
        result => {
          if (this.cancelled) return;
          if (result.ok && result.output) {
            this.handleSubtaskCompleted(d.subtaskId, result.output);
          } else {
            this.handleSubtaskFailed(d.subtaskId, result.error || 'Unknown failure');
          }
        },
        err => {
          if (!this.cancelled) this.handleSubtaskFailed(d.subtaskId, err?.message || 'Warm dispatch failed');
        },
      );
    }
  }

  async run(warmStart?: WarmStartSchedule): Promise<string> {
    const resultPromise = new Promise<string>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    if (warmStart) {
      this.crewQueues = warmStart.queues;
      this.onEvent({ type: 'schedule_ready', schedule: warmStart.schedule, queues: warmStart.queues });
    } else {
      const plan = this.state.plan.toTaskPlan();
      const { schedule, queues } = this.quartermaster.schedule(plan, this.config.maxWorkers);
      this.crewQueues = queues;
      this.onEvent({ type: 'schedule_ready', schedule, queues });
    }

    this.startPollingLoop();
    await this.dispatchReady();
    return resultPromise;
  }

  private _resolve!: (answer: string) => void;
  private _reject!: (error: Error) => void;

  // --- Proactive polling loop ---

  private startPollingLoop(): void {
    this.pollingTimer = setInterval(() => this.runProactiveCheck(), POLL_INTERVAL_BASE_MS);
  }

  private stopPollingLoop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private setPollingInterval(intervalMs: number): void {
    if (intervalMs === this.currentPollIntervalMs && this.pollingTimer) return;
    this.stopPollingLoop();
    this.currentPollIntervalMs = intervalMs;
    this.pollingTimer = setInterval(() => this.runProactiveCheck(), intervalMs);
  }

  private async runProactiveCheck(): Promise<void> {
    if (this.cancelled || this.state.isAllDone()) return;
    if (this.state.busyCrew.size === 0) return;
    if (this.captainCallInFlight) return;

    if (Date.now() - this.lastCaptainCallTime < EVENT_DEDUP_WINDOW_MS) return;

    const overdue = this.state.getOverdueSubtasks(OVERDUE_THRESHOLD_MS);

    this.setPollingInterval(overdue.length > 0 ? POLL_INTERVAL_FAST_MS : POLL_INTERVAL_BASE_MS);

    const runningCount = [...this.state.subtaskStatus.values()].filter(s => s === 'running').length;
    let trigger: string;
    if (overdue.length > 0) {
      const overdueDesc = overdue.map(o => `"${o.title}" running for ${formatMs(o.elapsedMs)}`).join('; ');
      trigger = `Proactive check — OVERDUE SUBTASKS: ${overdueDesc}. ${this.state.completedCount}/${this.state.totalCount} complete, ${runningCount} running. Review the action history below and intervene if any crew member appears stuck or looping.`;
    } else {
      trigger = `Proactive check: ${this.state.completedCount}/${this.state.totalCount} complete, ${runningCount} running. Review progress and intervene if needed, or return empty actions if all is well.`;
    }

    await this.consultAndExecute(trigger);
  }

  // --- Event handlers ---

  async handleSubtaskCompleted(subtaskId: SubtaskId, output: StructuredOutput): Promise<void> {
    if (this.cancelled) return;

    this.state.subtaskOutputs.set(subtaskId, output);
    this.state.markCompleted(subtaskId);
    const crewId = this.state.crewAssignments.get(subtaskId);
    if (crewId !== undefined) this.state.busyCrew.delete(crewId);

    this.onEvent({ type: 'subtask_completed', subtaskId, output });

    this.checkSpeculativeResolution(subtaskId);

    const final = this.state.plan.getFinalSubtask();
    if (final && subtaskId === final.id) {
      return this.finalize(output.text);
    }

    if (this.state.isAllDone()) {
      return this.finalize(this.buildFinalAnswer());
    }

    await this.dispatchReady();

    const title = this.state.plan.getSubtask(subtaskId)?.title ?? `Subtask ${subtaskId}`;
    const outputSnippet = output.text?.slice(0, 200) || '(no output)';
    await this.consultAndExecute(
      `Subtask "${title}" completed. Output: ${outputSnippet}\n\nReview: Is this output sufficient for downstream tasks? Should any pending subtask prompts be refined with this context? Return empty actions if all looks good.`,
    );
  }

  async handleSubtaskFailed(subtaskId: SubtaskId, error: string): Promise<void> {
    if (this.cancelled) return;

    const failCount = this.state.recordFailure(subtaskId, error);
    const crewId = this.state.crewAssignments.get(subtaskId);
    if (crewId !== undefined) this.state.busyCrew.delete(crewId);

    this.onEvent({ type: 'subtask_failed', subtaskId, error });
    const title = this.state.plan.getSubtask(subtaskId)?.title ?? `Subtask ${subtaskId}`;

    const canAutoRetry = failCount <= this.config.maxRetries;
    const trigger = canAutoRetry
      ? `Subtask "${title}" failed (attempt ${failCount}/${this.config.maxRetries + 1}). Error: ${error}\n\nAn automatic retry is available. You may modify_subtask to refine the prompt before the retry fires, or take other action. Return empty actions to allow the default retry.`
      : `Subtask "${title}" failed after ${failCount} attempts (max retries exhausted). Error: ${error}\n\nAutomatic retry is no longer available. You must decide: retry_subtask with a modified prompt, add alternative subtasks, restructure the plan, or abort.`;

    const decision = await this.consultAndExecute(trigger);

    const captainHandledThis =
      decision?.actions.some(
        a =>
          (a.type === 'retry_subtask' && a.subtask_id === subtaskId) ||
          (a.type === 'cancel_subtask' && a.subtask_id === subtaskId) ||
          a.type === 'abort_workflow' ||
          a.type === 'modify_plan',
      ) ?? false;

    if (canAutoRetry && !captainHandledThis) {
      logger.info(`Default retry for ${title} (attempt ${failCount + 1})`);
      this.state.subtaskStatus.set(subtaskId, 'pending');
      await this.dispatchReady();
    } else if (!canAutoRetry && !captainHandledThis) {
      await this.dispatchReady();
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.stopPollingLoop();
    this.abortController.abort();

    for (const [id, st] of this.state.subtaskStatus) {
      if (st !== 'completed') this.state.subtaskStatus.set(id, 'cancelled');
    }

    const sessionIds = Array.from(this.state.crewSessionIds.values());
    await Promise.allSettled(sessionIds.map(sid => this.crew.cancel(sid)));
    this.state.crewSessionIds.clear();
    this.state.busyCrew.clear();

    this.onEvent({ type: 'workflow_aborted', reason: 'Cancelled by user' });
    this._resolve?.('Workflow cancelled.');
  }

  // --- Core dispatch logic (programmatic, no LLM) ---

  private async dispatchReady(): Promise<void> {
    if (this.cancelled) return;

    const completed = this.state.getCompletedIds();
    const ready = this.state.plan.getReadySubtasks(completed).filter(id => {
      const st = this.state.subtaskStatus.get(id);
      return st === 'pending';
    });
    if (import.meta.env.DEV) {
      const statuses = Object.fromEntries([...this.state.subtaskStatus]);
      logger.info(
        `[dispatchReady] completed=${completed.length} ready=${ready.length} busy=${this.state.busyCrew.size}`,
        statuses,
      );
    }

    for (const subtaskId of ready) {
      if (this.cancelled) return;

      const crewId = this.pickCrew(subtaskId);
      if (crewId === null) break;

      const prompt = await this.buildDispatchPrompt(subtaskId);

      let sessionId = this.state.crewSessionIds.get(crewId);
      if (!sessionId) {
        try {
          sessionId = await this.crew.createSession(crewId);
          this.state.crewSessionIds.set(crewId, sessionId);
        } catch (e) {
          logger.error(`Failed to create session for Crew ${crewId}:`, e);
          continue;
        }
      }

      this.state.subtaskStatus.set(subtaskId, 'dispatched');
      this.state.crewAssignments.set(subtaskId, crewId);
      this.state.busyCrew.add(crewId);

      this.onEvent({ type: 'subtask_dispatched', subtaskId, crewId, prompt });

      this.runSubtask(subtaskId, sessionId, prompt, crewId);
    }

    if (this.state.busyCrew.size === 0 && !this.state.isAllDone() && !this.cancelled) {
      const pendingCount = [...this.state.subtaskStatus.values()].filter(s => s === 'pending').length;
      if (pendingCount === 0 && !this.state.isAllDone()) {
        this.finalize(this.buildFinalAnswer());
      }
    }
  }

  private async runSubtask(subtaskId: SubtaskId, sessionId: string, prompt: string, crewId: number): Promise<void> {
    this.state.markRunning(subtaskId);
    this.onEvent({ type: 'subtask_running', subtaskId });
    const title = this.state.plan.getSubtask(subtaskId)?.title ?? `Subtask ${subtaskId}`;
    if (import.meta.env.DEV)
      logger.info(`[runSubtask] START #${subtaskId} "${title}" on crew ${crewId} (session=${sessionId})`);

    const deps = this.state.plan.getDependencies(subtaskId);
    const depTabIds = deps.flatMap(d => this.state.subtaskOutputs.get(d)?.tabIds ?? []);
    const uniqueTabIds = [...new Set(depTabIds)].filter(n => typeof n === 'number');

    const result = await this.crew.dispatch(
      sessionId,
      prompt,
      subtaskId,
      uniqueTabIds.length ? uniqueTabIds : undefined,
    );

    if (import.meta.env.DEV)
      logger.info(
        `[runSubtask] END #${subtaskId} "${title}" ok=${result.ok} cancelled=${this.cancelled}`,
        result.error || '',
      );
    if (this.cancelled) return;

    if (result.ok && result.output) {
      await this.handleSubtaskCompleted(subtaskId, result.output);
    } else {
      await this.handleSubtaskFailed(subtaskId, result.error || 'Unknown failure');
    }
  }

  // --- Prompt building ---

  private async buildDispatchPrompt(subtaskId: SubtaskId): Promise<string> {
    const s = this.state.plan.getSubtask(subtaskId)!;
    const priors: PriorOutput[] = [];
    for (const depId of this.state.plan.getDependencies(subtaskId)) {
      const output = this.state.subtaskOutputs.get(depId);
      if (output) {
        const tabUrls: Record<number, string> = {};
        for (const tid of output.tabIds) {
          try {
            const tab = await chrome.tabs.get(tid);
            if (tab?.url) tabUrls[tid] = tab.url;
          } catch {}
        }
        priors.push({
          title: this.state.plan.getSubtask(depId)?.title || `Task ${depId}`,
          output: output.text,
          tabIds: output.tabIds,
          tabUrls,
          rawJson: output.raw,
        });
      }
    }

    const header = `\nYour task is to ${s.title}.\nSpecifically, you must: ${s.prompt}`;
    const priorText = priors.length > 0 ? `\n\n${buildPriorOutputsSection(priors)}` : '';

    const suggestions: string[] = [];
    if (s.suggestedUrls?.length) {
      suggestions.push(['Suggested URLs:', ...s.suggestedUrls.map(u => `- ${u}`)].join('\n'));
    } else if (s.suggestedSearchQueries?.length) {
      suggestions.push(['Suggested search queries:', ...s.suggestedSearchQueries.map(q => `- ${q}`)].join('\n'));
    }
    const suggestionText = suggestions.length ? `\n\n${suggestions.join('\n')}` : '';

    const hasDependents =
      !s.isFinal && this.state.plan.getAllSubtasks().some(other => other.startCriteria.includes(subtaskId));
    const outputReminder = hasDependents
      ? '\n\nIMPORTANT: Your output will be passed to a downstream worker. Include ALL findings, data, and results in your done action text.'
      : '';

    return `${header}${suggestionText}${priorText}${outputReminder}`;
  }

  // --- Crew assignment ---

  private pickCrew(subtaskId: SubtaskId): number | null {
    for (const [crewId, queue] of Object.entries(this.crewQueues)) {
      if (queue.includes(subtaskId) && !this.state.busyCrew.has(Number(crewId))) {
        return Number(crewId);
      }
    }
    for (const crewId of Object.keys(this.crewQueues).map(Number)) {
      if (!this.state.busyCrew.has(crewId)) return crewId;
    }
    return null;
  }

  // --- LLM-powered decisions ---

  /**
   * Consult the captain LLM and execute any resulting actions.
   * Returns the decision (or undefined if skipped/failed).
   */
  private async consultAndExecute(trigger: string): Promise<CaptainDecision | undefined> {
    if (this.cancelled || this.captainCallInFlight) return undefined;

    this.captainCallInFlight = true;
    try {
      const decision = await this.consultLLM(trigger);
      this.lastCaptainCallTime = Date.now();
      if (decision.actions.length > 0) {
        await this.executeDecision(decision);
      }
      return decision;
    } catch (e) {
      logger.error('Captain LLM call failed:', e);
      return undefined;
    } finally {
      this.captainCallInFlight = false;
    }
  }

  private async consultLLM(trigger: string): Promise<CaptainDecision> {
    const context = this.state.buildContextSummary();
    const userMessage = `${trigger}\n\nCurrent workflow state:\n${context}\n\nRespond with a JSON object containing status_message and actions. Return empty actions array if no intervention is needed.`;

    const timeoutMs = ((await generalSettingsStore.getSettings()).responseTimeoutSeconds ?? 120) * 1000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (this.abortController.signal.aborted) controller.abort();
    this.abortController.signal.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const prevTaskId = (globalTokenTracker as any)?.getCurrentTaskId?.();
      const prevRole = (globalTokenTracker as any)?.getCurrentRole?.();
      (globalTokenTracker as any)?.setCurrentTaskId?.(this.sessionId);
      (globalTokenTracker as any)?.setCurrentRole?.('captain');

      const msgs = [new SystemMessage(captainSystemPrompt), new HumanMessage(userMessage)];
      const res = await this.llm.invoke(msgs as any, { signal: controller.signal } as any);
      const content = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
      logLLMUsage(res, {
        taskId: this.sessionId,
        role: 'captain',
        modelName: this.llm?.modelName || 'unknown',
        inputMessages: msgs,
      });

      (globalTokenTracker as any)?.setCurrentTaskId?.(prevTaskId);
      (globalTokenTracker as any)?.setCurrentRole?.(prevRole);

      const parsed = extractJsonFromModelOutput(content);
      return this.validateDecision(parsed);
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateDecision(raw: any): CaptainDecision {
    const statusMessage = String(raw?.status_message || 'Processing...');
    const actions: CaptainActionType[] = [];

    for (const a of Array.isArray(raw?.actions) ? raw.actions : []) {
      if (!a?.type) continue;
      switch (a.type) {
        case 'dispatch_subtask':
        case 'cancel_subtask':
        case 'retry_subtask':
        case 'modify_subtask':
        case 'abort_workflow':
          actions.push(a);
          break;
        case 'add_subtask':
          if (a.subtask?.title && a.subtask?.prompt) actions.push(a);
          break;
        case 'modify_plan':
          if (Array.isArray(a.revised_subtasks)) actions.push(a);
          break;
        case 'launch_speculative':
          if (a.goal_id && Array.isArray(a.alternatives)) actions.push(a);
          break;
        case 'resolve_speculative':
          if (a.goal_id && typeof a.winner_id === 'number') actions.push(a);
          break;
      }
    }

    return { status_message: statusMessage, actions };
  }

  // --- Action execution ---

  private async executeDecision(decision: CaptainDecision): Promise<void> {
    this.onEvent({ type: 'captain_decision', decision });
    let planModified = false;

    for (const action of decision.actions) {
      if (this.cancelled) return;

      switch (action.type) {
        case 'dispatch_subtask': {
          const sub = this.state.plan.getSubtask(action.subtask_id);
          if (sub && this.state.subtaskStatus.get(action.subtask_id) === 'pending') {
            if (action.refined_prompt)
              this.state.plan.modifySubtask(action.subtask_id, { prompt: action.refined_prompt });
          }
          break;
        }
        case 'cancel_subtask': {
          const sessionId = this.findCrewSession(action.subtask_id);
          if (sessionId) await this.crew.cancel(sessionId);
          this.state.subtaskStatus.set(action.subtask_id, 'cancelled');
          const sid = this.state.crewAssignments.get(action.subtask_id);
          if (sid !== undefined) this.state.busyCrew.delete(sid);
          break;
        }
        case 'retry_subtask': {
          if (action.modified_prompt) {
            this.state.plan.modifySubtask(action.subtask_id, { prompt: action.modified_prompt });
          }
          this.state.subtaskStatus.set(action.subtask_id, 'pending');
          this.state.failureCounts.set(action.subtask_id, 0);
          break;
        }
        case 'add_subtask': {
          const newId = this.state.plan.addSubtask(action.subtask);
          this.state.subtaskStatus.set(newId, 'pending');
          planModified = true;
          break;
        }
        case 'modify_subtask': {
          const changes: any = {};
          if (action.new_prompt) changes.prompt = action.new_prompt;
          if (action.new_title) changes.title = action.new_title;
          if (action.no_browse !== undefined) changes.noBrowse = action.no_browse;
          this.state.plan.modifySubtask(action.subtask_id, changes);
          break;
        }
        case 'modify_plan': {
          const newIds = this.state.plan.replacePendingSubtasks(action.revised_subtasks, this.state.getCompletedIds());
          for (const id of newIds) this.state.subtaskStatus.set(id, 'pending');
          planModified = true;
          this.onEvent({ type: 'plan_modified', reason: action.reason, addedIds: newIds, removedIds: [] });
          break;
        }
        case 'launch_speculative': {
          const ids: SubtaskId[] = [];
          for (const alt of action.alternatives) {
            const id = this.state.plan.addSubtask(alt);
            this.state.subtaskStatus.set(id, 'pending');
            ids.push(id);
          }
          this.state.plan.addSpeculativeGroup(action.goal_id, ids);
          this.state.speculativeRaces.set(action.goal_id, { candidates: ids });
          planModified = true;
          this.onEvent({ type: 'speculative_launched', goalId: action.goal_id, candidates: ids });
          break;
        }
        case 'resolve_speculative': {
          const losers = this.state.plan.resolveSpeculation(action.goal_id, action.winner_id);
          for (const lid of losers) {
            const sid = this.findCrewSession(lid);
            if (sid) await this.crew.cancel(sid);
            this.state.subtaskStatus.set(lid, 'cancelled');
          }
          const race = this.state.speculativeRaces.get(action.goal_id);
          if (race) race.winner = action.winner_id;
          this.onEvent({
            type: 'speculative_resolved',
            goalId: action.goal_id,
            winnerId: action.winner_id,
            cancelledIds: losers,
          });
          planModified = true;
          break;
        }
        case 'abort_workflow': {
          this.abort(action.reason);
          return;
        }
      }
    }

    if (planModified) {
      const updatedPlan = this.state.plan.toTaskPlan();
      const { queues } = this.quartermaster.schedule(updatedPlan, this.config.maxWorkers);
      this.crewQueues = queues;
    }

    await this.dispatchReady();
  }

  // --- Speculative resolution ---

  private checkSpeculativeResolution(completedId: SubtaskId): void {
    for (const [goalId, race] of this.state.speculativeRaces) {
      if (race.winner) continue;
      if (race.candidates.includes(completedId)) {
        const losers = this.state.plan.resolveSpeculation(goalId, completedId);
        race.winner = completedId;
        for (const lid of losers) {
          const sid = this.findCrewSession(lid);
          if (sid) this.crew.cancel(sid).catch(() => {});
          this.state.subtaskStatus.set(lid, 'cancelled');
        }
        this.onEvent({ type: 'speculative_resolved', goalId, winnerId: completedId, cancelledIds: losers });
      }
    }
  }

  // --- Finalization ---

  private finalize(answer: string): void {
    if (this.cancelled) return;
    this.stopPollingLoop();
    if (import.meta.env.DEV) logger.info(`[finalize] answer length=${answer.length}`);

    for (const sid of this.state.crewSessionIds.values()) {
      this.crew.endSession(sid, 'completed').catch(() => {});
    }

    this.onEvent({ type: 'workflow_complete', finalAnswer: answer });
    this._resolve?.(answer);
  }

  private buildFinalAnswer(): string {
    const final = this.state.plan.getFinalSubtask();
    if (final) {
      const output = this.state.subtaskOutputs.get(final.id);
      if (output?.text?.trim()) {
        if (output.raw?.done?.text || output.raw?.text) {
          const s = String(output.raw.done?.text || output.raw.text).trim();
          if (s.length > 0) return s;
        }
        return output.text;
      }
    }

    const parts: string[] = [];
    for (const s of this.state.plan.getAllSubtasks().sort((a, b) => a.id - b.id)) {
      const out = this.state.subtaskOutputs.get(s.id)?.text?.trim();
      if (out) parts.push(out);
      if (parts.join('\n\n').length > 4000) break;
    }
    return parts.join('\n\n').trim() || 'Workflow completed successfully.';
  }

  private abort(reason: string): void {
    if (import.meta.env.DEV) logger.info(`[abort] reason="${reason}"`);
    this.cancelled = true;
    this.stopPollingLoop();
    this.abortController.abort();

    for (const [id, st] of this.state.subtaskStatus) {
      if (st !== 'completed') this.state.subtaskStatus.set(id, 'cancelled');
    }
    for (const sid of this.state.crewSessionIds.values()) {
      this.crew.cancel(sid).catch(() => {});
    }

    this.onEvent({ type: 'workflow_aborted', reason });
    this._resolve?.(reason);
  }

  private findCrewSession(subtaskId: SubtaskId): string | undefined {
    const crewId = this.state.crewAssignments.get(subtaskId);
    if (crewId === undefined) return undefined;
    return this.state.crewSessionIds.get(crewId);
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return remainingSec > 0 ? `${minutes}m ${remainingSec}s` : `${minutes}m`;
}
