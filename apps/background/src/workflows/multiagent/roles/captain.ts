import { createLogger } from '@src/log';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { extractJsonFromModelOutput, wrapUntrustedContent } from '@src/workflows/shared/messages/utils';
import { logLLMUsage, globalTokenTracker } from '@src/utils/token-tracker';
import { generalSettingsStore } from '@extension/storage';
import { captainSystemPrompt } from './captain-prompt';
import { Quartermaster } from './quartermaster';
import { Crew, type CrewResult } from './crew';
import { CaptainState } from '../captain-state';
import { buildPriorOutputsSection } from '../multiagent-placeholders';
import {
  buildCaptainActions,
  parseDecision,
  executeActions,
  MAX_TOTAL_ATTEMPTS,
  type CaptainAction,
  type CaptainActionContext,
} from '../captain-actions';
import type { SubtaskId, PriorOutput, WorkerSchedule, WorkerQueues } from '../multiagent-types';
import type { CaptainDecision, StructuredOutput, WorkflowEvent } from '../workflow-events';

const logger = createLogger('Captain');

const DEFAULT_MAX_RETRIES = 1;

const POLL_INTERVAL_BASE_MS = 30_000;
const POLL_INTERVAL_FAST_MS = 15_000;
const OVERDUE_THRESHOLD_MS = 120_000;
const EVENT_DEDUP_WINDOW_MS = 10_000;
const MAX_CAPTAIN_STEPS = 25;
const STALE_THRESHOLD = 5;

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
  private paused = false;
  private abortController = new AbortController();
  private onEvent: EventHandler;
  private crewQueues: Record<number, number[]> = {};
  private pendingUserMessages: string[] = [];
  private holdDispatchForUserMessage = false;

  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private currentPollIntervalMs = POLL_INTERVAL_BASE_MS;
  private lastCaptainCallTime = 0;
  private captainCallInFlight = false;
  private captainStepCount = 0;
  private lastStateFingerprint = '';
  private staleCount = 0;

  private captainActions: CaptainAction[];
  private actionNames: Set<string>;

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

    const ctx: CaptainActionContext = {
      state: this.state,
      crew: this.crew,
      findCrewSession: id => this.findCrewSession(id),
      abort: reason => this.abort(reason),
      pause: reason => this.pause(reason),
      finalize: answer => this.finalize(answer),
      buildFinalAnswer: () => this.buildFinalAnswer(),
      emit: event => this.onEvent(event),
      isCancelled: () => this.cancelled,
    };
    this.captainActions = buildCaptainActions(ctx);
    this.actionNames = new Set(this.captainActions.map(a => a.name()));
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
    if (this.cancelled || this.paused || this.state.isAllDone()) return;
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
    if (!this.state.plan.getSubtask(subtaskId)) return;

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

    const title = this.state.plan.getSubtask(subtaskId)?.title ?? `Subtask ${subtaskId}`;

    const resolved = this.state.getResolvedIds();
    const pendingFanOut = this.state.plan
      .getReadySubtasks(resolved)
      .filter(
        id => this.state.subtaskStatus.get(id) === 'pending' && this.state.plan.getDependencies(id).includes(subtaskId),
      );

    if (pendingFanOut.length >= 2) {
      // Fan-out: consult Captain FIRST so it can inject specific URLs/details
      // into each research subtask before they are dispatched.
      const outputSnippet = wrapUntrustedContent(output.text?.slice(0, 2000) || '(no output)');
      await this.consultAndExecute(
        `Subtask "${title}" completed and unblocked ${pendingFanOut.length} parallel downstream tasks. Full output:\n${outputSnippet}\n\nCRITICAL — FAN-OUT: Use modify_subtask to inject the specific item URL and name from this output into each pending downstream subtask's prompt BEFORE they are dispatched. This is your only chance to refine prompts before workers start. Review the output, identify each item, and update each research subtask with the exact URL and item name.`,
      );
      await this.dispatchReady();
    } else {
      // Normal completion: dispatch immediately, then consult asynchronously.
      await this.dispatchReady();
      const outputSnippet = wrapUntrustedContent(output.text?.slice(0, 200) || '(no output)');
      await this.consultAndExecute(
        `Subtask "${title}" completed. Output:\n${outputSnippet}\n\nReview: Is this output sufficient for downstream tasks? Should any pending subtask prompts be refined with this context? Return empty actions if all looks good.`,
      );
    }
  }

  async handleSubtaskFailed(subtaskId: SubtaskId, error: string): Promise<void> {
    if (this.cancelled) return;
    if (!this.state.plan.getSubtask(subtaskId)) return;

    const failCount = this.state.recordFailure(subtaskId, error);
    const totalAttempts = this.state.dispatchAttempts.get(subtaskId) ?? 0;
    const crewId = this.state.crewAssignments.get(subtaskId);
    if (crewId !== undefined) this.state.busyCrew.delete(crewId);

    this.onEvent({ type: 'subtask_failed', subtaskId, error });
    const title = this.state.plan.getSubtask(subtaskId)?.title ?? `Subtask ${subtaskId}`;

    // Hard cap: if total dispatch attempts exceeded, permanently fail and move on
    if (totalAttempts >= MAX_TOTAL_ATTEMPTS) {
      logger.warning(`Subtask "${title}" permanently failed after ${totalAttempts} total attempts. Skipping.`);
      this.state.subtaskStatus.set(subtaskId, 'failed');
      await this.dispatchReady();
      return;
    }

    const canAutoRetry = failCount <= this.config.maxRetries;
    const trigger = canAutoRetry
      ? `Subtask "${title}" failed (attempt ${totalAttempts}/${MAX_TOTAL_ATTEMPTS} total). Error: ${error}\n\nAn automatic retry is available. You may modify_subtask to refine the prompt before the retry fires, or take other action. Return empty actions to allow the default retry.`
      : `Subtask "${title}" failed after ${totalAttempts} total attempts (max: ${MAX_TOTAL_ATTEMPTS}). Error: ${error}\n\nAutomatic retry is no longer available. You must decide: cancel this subtask, restructure the plan to work around it, or abort if unrecoverable. Do NOT use retry_subtask if the error is a session or infrastructure problem.`;

    const decision = await this.consultAndExecute(trigger);

    const captainHandledThis =
      decision?.actions.some(
        a =>
          (a.type === 'retry_subtask' && a.subtask_id === subtaskId) ||
          (a.type === 'cancel_subtask' && a.subtask_id === subtaskId) ||
          (a.type === 'skip_subtask' && a.subtask_id === subtaskId) ||
          a.type === 'abort_workflow' ||
          a.type === 'pause_workflow' ||
          a.type === 'complete_workflow' ||
          a.type === 'modify_plan',
      ) ?? false;

    if (canAutoRetry && !captainHandledThis) {
      logger.info(`Default retry for ${title} (attempt ${totalAttempts + 1}/${MAX_TOTAL_ATTEMPTS})`);
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

  async pause(reason: string): Promise<void> {
    this.paused = true;
    this.stopPollingLoop();
    const sessionIds = Array.from(this.state.crewSessionIds.values());
    await Promise.allSettled(sessionIds.map(sid => this.crew.pause(sid)));
    this.onEvent({ type: 'workflow_paused', reason });
  }

  async resume(userMessage?: string): Promise<void> {
    this.paused = false;
    const sessionIds = Array.from(this.state.crewSessionIds.values());
    await Promise.allSettled(sessionIds.map(sid => this.crew.resume(sid)));
    this.onEvent({ type: 'workflow_resumed' });
    this.startPollingLoop();
    if (userMessage) {
      await this.consultAndExecute(
        `Workflow resumed by user with message: "${userMessage}". Review the current state and decide if any changes are needed.`,
      );
    } else {
      await this.dispatchReady();
    }
  }

  injectUserMessage(text: string): void {
    this.pendingUserMessages.push(text);
    this.holdDispatchForUserMessage = true;
    this.pauseRunningCrews();
    if (!this.paused && !this.captainCallInFlight && !this.cancelled) {
      this.consultAndExecute('User sent a live message. Review and act if needed.');
    }
  }

  cancelUserMessage(text: string): boolean {
    const idx = this.pendingUserMessages.indexOf(text);
    if (idx >= 0) {
      this.pendingUserMessages.splice(idx, 1);
      if (this.pendingUserMessages.length === 0) {
        this.holdDispatchForUserMessage = false;
        this.resumeRunningCrews();
      }
      return true;
    }
    return false;
  }

  private pauseRunningCrews(): void {
    for (const [crewId, sessionId] of this.state.crewSessionIds) {
      if (this.state.busyCrew.has(crewId)) {
        this.crew.pause(sessionId).catch(() => {});
      }
    }
  }

  private async resumeRunningCrews(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [crewId, sessionId] of this.state.crewSessionIds) {
      if (this.state.busyCrew.has(crewId)) {
        promises.push(this.crew.resume(sessionId).catch(() => {}));
      }
    }
    if (promises.length) await Promise.allSettled(promises);
  }

  // --- Core dispatch logic (programmatic, no LLM) ---

  private async dispatchReady(): Promise<void> {
    if (this.cancelled || this.paused || this.holdDispatchForUserMessage) return;

    const resolved = this.state.getResolvedIds();
    const ready = this.state.plan.getReadySubtasks(resolved).filter(id => {
      const st = this.state.subtaskStatus.get(id);
      return st === 'pending';
    });
    if (import.meta.env.DEV) {
      const statuses = Object.fromEntries([...this.state.subtaskStatus]);
      logger.info(
        `[dispatchReady] resolved=${resolved.size} ready=${ready.length} busy=${this.state.busyCrew.size}`,
        statuses,
      );
    }

    for (const subtaskId of ready) {
      if (this.cancelled || this.paused) return;

      const crewId = this.pickCrew(subtaskId);
      if (crewId === null) break;

      // Claim immediately to prevent double-dispatch across await points
      this.state.subtaskStatus.set(subtaskId, 'dispatched');
      this.state.crewAssignments.set(subtaskId, crewId);
      this.state.busyCrew.add(crewId);

      const prompt = await this.buildDispatchPrompt(subtaskId);

      let sessionId = this.state.crewSessionIds.get(crewId);
      if (!sessionId) {
        try {
          sessionId = await this.crew.createSession(crewId);
          this.state.crewSessionIds.set(crewId, sessionId);
        } catch (e) {
          logger.error(`Failed to create session for Crew ${crewId}:`, e);
          this.state.subtaskStatus.set(subtaskId, 'pending');
          this.state.crewAssignments.delete(subtaskId);
          this.state.busyCrew.delete(crewId);
          continue;
        }
      }

      this.onEvent({ type: 'subtask_dispatched', subtaskId, crewId, prompt });

      this.runSubtask(subtaskId, sessionId, prompt, crewId).catch(err => {
        if (!this.cancelled) this.handleSubtaskFailed(subtaskId, err?.message || 'Unexpected dispatch error');
      });
    }

    if (this.state.busyCrew.size === 0 && !this.state.isAllDone() && !this.cancelled) {
      const pendingCount = [...this.state.subtaskStatus.values()].filter(s => s === 'pending').length;
      if (pendingCount === 0) {
        this.finalize(this.buildFinalAnswer());
      } else if (this.state.hasBlockedSubtasks()) {
        await this.consultAndExecute(
          `Workflow is BLOCKED: ${pendingCount} subtask(s) are waiting on failed or cancelled dependencies that will never complete. Use skip_subtask on the blocked dependencies to unblock downstream work, or use complete_workflow to finalize with available results.`,
        );
      }
    }
  }

  private async runSubtask(subtaskId: SubtaskId, sessionId: string, prompt: string, crewId: number): Promise<void> {
    this.state.incrementDispatchAttempts(subtaskId);
    this.state.markRunning(subtaskId);
    this.onEvent({ type: 'subtask_running', subtaskId });
    const title = this.state.plan.getSubtask(subtaskId)?.title ?? `Subtask ${subtaskId}`;
    if (import.meta.env.DEV)
      logger.info(`[runSubtask] START #${subtaskId} "${title}" on crew ${crewId} (session=${sessionId})`);

    // Collect dependency tabs. Skip tabs from other crews that are currently
    // active — they have priority on their own tabs. Own tabs go last so
    // adoptTargetTabs (which iterates in reverse) tries them first.
    const deps = this.state.plan.getDependencies(subtaskId);
    const ownTabs: number[] = [];
    const otherTabs: number[] = [];
    for (const d of deps) {
      const tabIds = this.state.subtaskOutputs.get(d)?.tabIds ?? [];
      if (!tabIds.length) continue;
      const producerId = this.state.crewAssignments.get(d);
      if (producerId === crewId) {
        ownTabs.push(...tabIds);
      } else if (producerId === undefined || !this.state.busyCrew.has(producerId)) {
        otherTabs.push(...tabIds);
      }
    }
    const uniqueTabIds = [...new Set([...otherTabs, ...ownTabs])].filter(n => typeof n === 'number');

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
    if (this.cancelled || this.paused || this.captainCallInFlight) return undefined;

    this.captainStepCount++;
    if (this.captainStepCount > MAX_CAPTAIN_STEPS) {
      logger.warning(`Captain step limit (${MAX_CAPTAIN_STEPS}) reached — finalizing`);
      this.finalize(this.buildFinalAnswer());
      return undefined;
    }

    this.captainCallInFlight = true;
    const hadUserMessages = this.pendingUserMessages.length > 0;
    try {
      const drained = this.pendingUserMessages.splice(0);
      const fullTrigger =
        drained.length > 0
          ? `${trigger}\n\nUser messages received:\n${drained.map(m => `- "${m}"`).join('\n')}`
          : trigger;

      const decision = await this.consultLLM(fullTrigger);
      this.lastCaptainCallTime = Date.now();

      if (drained.length > 0) this.holdDispatchForUserMessage = false;

      if (decision.actions.length > 0) {
        await this.executeDecision(decision, drained);
      } else {
        this.onEvent({ type: 'captain_decision', decision, drainedMessages: drained.length > 0 ? drained : undefined });
        if (drained.length > 0) await this.dispatchReady();
      }

      if (hadUserMessages) await this.resumeRunningCrews();

      // Stale state detection: finalize if no progress across consecutive calls
      const fp = this.buildStateFingerprint();
      if (fp === this.lastStateFingerprint) {
        this.staleCount++;
        if (this.staleCount >= STALE_THRESHOLD) {
          logger.warning(`No state change after ${STALE_THRESHOLD} captain steps — finalizing`);
          this.finalize(this.buildFinalAnswer());
          return decision;
        }
      } else {
        this.staleCount = 0;
        this.lastStateFingerprint = fp;
      }

      return decision;
    } catch (e) {
      logger.error('Captain LLM call failed:', e);
      this.holdDispatchForUserMessage = false;
      if (hadUserMessages) this.resumeRunningCrews().catch(() => {});
      return undefined;
    } finally {
      this.captainCallInFlight = false;
    }
  }

  private buildStateFingerprint(): string {
    const parts: string[] = [];
    for (const [id, st] of [...this.state.subtaskStatus].sort((a, b) => a[0] - b[0])) {
      parts.push(`${id}:${st}`);
    }
    return parts.join(',');
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
      return parseDecision(parsed, this.actionNames);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async executeDecision(decision: CaptainDecision, drainedMessages?: string[]): Promise<void> {
    this.onEvent({
      type: 'captain_decision',
      decision,
      drainedMessages: drainedMessages?.length ? drainedMessages : undefined,
    });

    const { planModified } = await executeActions(this.captainActions, decision, () => this.cancelled);

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

  private async finalize(answer: string): Promise<void> {
    if (this.cancelled) return;
    this.stopPollingLoop();
    if (import.meta.env.DEV) logger.info(`[finalize] answer length=${answer.length}`);

    await Promise.allSettled(
      Array.from(this.state.crewSessionIds.values()).map(sid => this.crew.endSession(sid, 'completed')),
    );

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

  private async abort(reason: string): Promise<void> {
    if (import.meta.env.DEV) logger.info(`[abort] reason="${reason}"`);
    this.cancelled = true;
    this.stopPollingLoop();
    this.abortController.abort();

    for (const [id, st] of this.state.subtaskStatus) {
      if (st !== 'completed') this.state.subtaskStatus.set(id, 'cancelled');
    }

    await Promise.allSettled(Array.from(this.state.crewSessionIds.values()).map(sid => this.crew.cancel(sid)));

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
