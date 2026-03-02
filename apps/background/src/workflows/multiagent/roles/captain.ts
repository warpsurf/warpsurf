import { createLogger } from '@src/log';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { extractJsonFromModelOutput } from '@src/workflows/shared/messages/utils';
import { logLLMUsage, globalTokenTracker } from '@src/utils/token-tracker';
import { generalSettingsStore } from '@extension/storage';
import { captainSystemPrompt } from './captain-prompt';
import { Quartermaster } from './quartermaster';
import { Sailor, type SailorResult } from './sailor';
import { CaptainState } from '../captain-state';
import { LivePlan } from '../live-plan';
import { buildPriorOutputsSection } from '../multiagent-placeholders';
import type { SubtaskId, PriorOutput } from '../multiagent-types';
import type {
  CaptainDecision,
  CaptainActionType,
  StructuredOutput,
  SubtaskStatus,
  WorkflowEvent,
} from '../workflow-events';

const logger = createLogger('Captain');

const DEFAULT_MAX_RETRIES = 1;
const CHECKPOINT_INTERVAL = 3;

export interface CaptainConfig {
  maxWorkers: number;
  maxRetries?: number;
  checkpointInterval?: number;
}

type EventHandler = (event: WorkflowEvent) => void;

/**
 * The Captain oversees workflow execution in real-time.
 * Event-driven: responds to sailor completions/failures, makes LLM-powered decisions when needed.
 */
export class Captain {
  private state: CaptainState;
  private quartermaster = new Quartermaster();
  private sailor: Sailor;
  private config: Required<CaptainConfig>;
  private llm: any;
  private sessionId: string;
  private cancelled = false;
  private abortController = new AbortController();
  private onEvent: EventHandler;
  private completionsSinceCheckpoint = 0;
  // Sailor session tracking
  private sailorQueues: Record<number, number[]> = {};

  constructor(
    state: CaptainState,
    sailor: Sailor,
    llm: any,
    sessionId: string,
    config: CaptainConfig,
    onEvent: EventHandler,
  ) {
    this.state = state;
    this.sailor = sailor;
    this.llm = llm;
    this.sessionId = sessionId;
    this.config = {
      maxWorkers: config.maxWorkers,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      checkpointInterval: config.checkpointInterval ?? CHECKPOINT_INTERVAL,
    };
    this.onEvent = onEvent;
  }

  async run(): Promise<string> {
    // Initial scheduling
    const plan = this.state.plan.toTaskPlan();
    const { schedule, queues } = this.quartermaster.schedule(plan, this.config.maxWorkers);
    this.sailorQueues = queues;
    this.onEvent({ type: 'schedule_ready', schedule, queues });

    // Dispatch root subtasks
    await this.dispatchReady();

    // Wait for all work to complete
    return new Promise<string>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  private _resolve!: (answer: string) => void;
  private _reject!: (error: Error) => void;

  // --- Event handlers called by the orchestrator ---

  async handleSubtaskCompleted(subtaskId: SubtaskId, output: StructuredOutput): Promise<void> {
    if (this.cancelled) return;

    this.state.subtaskOutputs.set(subtaskId, output);
    this.state.subtaskStatus.set(subtaskId, 'completed');
    const sailorId = this.state.sailorAssignments.get(subtaskId);
    if (sailorId !== undefined) this.state.busySailors.delete(sailorId);

    this.onEvent({ type: 'subtask_completed', subtaskId, output });
    this.completionsSinceCheckpoint++;

    // Check speculative race resolution
    this.checkSpeculativeResolution(subtaskId);

    // Check if final subtask completed
    const final = this.state.plan.getFinalSubtask();
    if (final && subtaskId === final.id) {
      return this.finalize(output.text);
    }

    // Check if all done
    if (this.state.isAllDone()) {
      return this.finalize(this.buildFinalAnswer());
    }

    // Checkpoint LLM call if threshold reached
    if (this.completionsSinceCheckpoint >= this.config.checkpointInterval) {
      await this.runCheckpoint();
      this.completionsSinceCheckpoint = 0;
    }

    // Dispatch newly-ready subtasks
    await this.dispatchReady();
  }

  async handleSubtaskFailed(subtaskId: SubtaskId, error: string): Promise<void> {
    if (this.cancelled) return;

    const failCount = this.state.recordFailure(subtaskId, error);
    const sailorId = this.state.sailorAssignments.get(subtaskId);
    if (sailorId !== undefined) this.state.busySailors.delete(sailorId);

    this.onEvent({ type: 'subtask_failed', subtaskId, error });
    const title = this.state.plan.getSubtask(subtaskId)?.title ?? `Subtask ${subtaskId}`;

    if (failCount <= this.config.maxRetries) {
      // Simple retry — no LLM call
      logger.info(`Retrying ${title} (attempt ${failCount + 1})`);
      this.state.subtaskStatus.set(subtaskId, 'pending');
      await this.dispatchReady();
      return;
    }

    // Consult LLM for re-planning
    try {
      const decision = await this.consultLLM(`Subtask "${title}" failed after ${failCount} attempts. Error: ${error}`);
      await this.executeDecision(decision);
    } catch (e) {
      logger.error('Captain LLM call failed, aborting workflow:', e);
      this.abort(`Captain decision failed: ${e}`);
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.abortController.abort();

    for (const [id, st] of this.state.subtaskStatus) {
      if (st !== 'completed') this.state.subtaskStatus.set(id, 'cancelled');
    }

    const sessionIds = Array.from(this.state.sailorSessionIds.values());
    await Promise.allSettled(sessionIds.map(sid => this.sailor.cancel(sid)));
    this.state.sailorSessionIds.clear();
    this.state.busySailors.clear();

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
        `[dispatchReady] completed=${completed.length} ready=${ready.length} busy=${this.state.busySailors.size}`,
        statuses,
      );
    }

    for (const subtaskId of ready) {
      if (this.cancelled) return;

      const sailorId = this.pickSailor(subtaskId);
      if (sailorId === null) break; // No free sailors

      const subtask = this.state.plan.getSubtask(subtaskId)!;
      const prompt = this.buildDispatchPrompt(subtaskId);

      // Ensure sailor session exists
      let sessionId = this.state.sailorSessionIds.get(sailorId);
      if (!sessionId) {
        try {
          sessionId = await this.sailor.createSession(sailorId);
          this.state.sailorSessionIds.set(sailorId, sessionId);
        } catch (e) {
          logger.error(`Failed to create session for Sailor ${sailorId}:`, e);
          continue;
        }
      }

      this.state.subtaskStatus.set(subtaskId, 'dispatched');
      this.state.sailorAssignments.set(subtaskId, sailorId);
      this.state.busySailors.add(sailorId);

      this.onEvent({ type: 'subtask_dispatched', subtaskId, sailorId, prompt });

      // Run async — don't await, so we dispatch in parallel
      this.runSubtask(subtaskId, sessionId, prompt, sailorId);
    }

    // If nothing is running and nothing is ready, check if we're stuck
    if (this.state.busySailors.size === 0 && !this.state.isAllDone() && !this.cancelled) {
      const pendingCount = [...this.state.subtaskStatus.values()].filter(s => s === 'pending').length;
      if (pendingCount === 0 && !this.state.isAllDone()) {
        this.finalize(this.buildFinalAnswer());
      }
    }
  }

  private async runSubtask(subtaskId: SubtaskId, sessionId: string, prompt: string, sailorId: number): Promise<void> {
    this.state.subtaskStatus.set(subtaskId, 'running');
    const title = this.state.plan.getSubtask(subtaskId)?.title ?? `Subtask ${subtaskId}`;
    if (import.meta.env.DEV)
      logger.info(`[runSubtask] START #${subtaskId} "${title}" on sailor ${sailorId} (session=${sessionId})`);

    // Collect tab IDs from dependencies for reuse
    const deps = this.state.plan.getDependencies(subtaskId);
    const depTabIds = deps.flatMap(d => this.state.subtaskOutputs.get(d)?.tabIds ?? []);
    const uniqueTabIds = [...new Set(depTabIds)].filter(n => typeof n === 'number');

    const result = await this.sailor.dispatch(
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

  // --- Prompt building (absorbs refiner role) ---

  private buildDispatchPrompt(subtaskId: SubtaskId): string {
    const s = this.state.plan.getSubtask(subtaskId)!;
    const priors: PriorOutput[] = [];
    for (const depId of this.state.plan.getDependencies(subtaskId)) {
      const output = this.state.subtaskOutputs.get(depId);
      if (output) {
        priors.push({
          title: this.state.plan.getSubtask(depId)?.title || `Task ${depId}`,
          output: output.text,
          tabIds: output.tabIds,
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

    return `${header}${suggestionText}${priorText}`;
  }

  // --- Sailor assignment ---

  private pickSailor(subtaskId: SubtaskId): number | null {
    // Try the scheduled sailor first
    for (const [sailorId, queue] of Object.entries(this.sailorQueues)) {
      if (queue.includes(subtaskId) && !this.state.busySailors.has(Number(sailorId))) {
        return Number(sailorId);
      }
    }
    // Fall back to any free sailor
    for (const sailorId of Object.keys(this.sailorQueues).map(Number)) {
      if (!this.state.busySailors.has(sailorId)) return sailorId;
    }
    return null;
  }

  // --- LLM-powered decisions ---

  private async consultLLM(trigger: string): Promise<CaptainDecision> {
    const context = this.state.buildContextSummary();
    const userMessage = `${trigger}\n\nCurrent workflow state:\n${context}\n\nWhat should we do? Return a JSON object with status_message and actions.`;

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
          const sessionId = this.findSailorSession(action.subtask_id);
          if (sessionId) await this.sailor.cancel(sessionId);
          this.state.subtaskStatus.set(action.subtask_id, 'cancelled');
          const sid = this.state.sailorAssignments.get(action.subtask_id);
          if (sid !== undefined) this.state.busySailors.delete(sid);
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
            const sid = this.findSailorSession(lid);
            if (sid) await this.sailor.cancel(sid);
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

    // Re-schedule and dispatch if plan was modified
    if (planModified) {
      const updatedPlan = this.state.plan.toTaskPlan();
      const { queues } = this.quartermaster.schedule(updatedPlan, this.config.maxWorkers);
      this.sailorQueues = queues;
    }

    await this.dispatchReady();
  }

  // --- Speculative resolution ---

  private checkSpeculativeResolution(completedId: SubtaskId): void {
    for (const [goalId, race] of this.state.speculativeRaces) {
      if (race.winner) continue;
      if (race.candidates.includes(completedId)) {
        // Auto-resolve: first to complete wins
        const losers = this.state.plan.resolveSpeculation(goalId, completedId);
        race.winner = completedId;
        for (const lid of losers) {
          const sid = this.findSailorSession(lid);
          if (sid) this.sailor.cancel(sid).catch(() => {});
          this.state.subtaskStatus.set(lid, 'cancelled');
        }
        this.onEvent({ type: 'speculative_resolved', goalId, winnerId: completedId, cancelledIds: losers });
      }
    }
  }

  // --- Checkpoint ---

  private async runCheckpoint(): Promise<void> {
    if (this.cancelled || !this.llm) return;
    try {
      const decision = await this.consultLLM(
        `Checkpoint: ${this.state.completedCount} of ${this.state.totalCount} subtasks complete. Any adjustments needed?`,
      );
      if (decision.actions.length > 0) {
        await this.executeDecision(decision);
      }
    } catch (e) {
      logger.error('Checkpoint LLM call failed, continuing:', e);
    }
  }

  // --- Finalization ---

  private finalize(answer: string): void {
    if (this.cancelled) return;
    if (import.meta.env.DEV) logger.info(`[finalize] answer length=${answer.length}`);

    // End all sailor sessions
    for (const sid of this.state.sailorSessionIds.values()) {
      this.sailor.endSession(sid, 'completed').catch(() => {});
    }

    this.onEvent({ type: 'workflow_complete', finalAnswer: answer });
    this._resolve?.(answer);
  }

  private buildFinalAnswer(): string {
    // Check if final subtask has output
    const final = this.state.plan.getFinalSubtask();
    if (final) {
      const output = this.state.subtaskOutputs.get(final.id);
      if (output?.text?.trim()) {
        // Try to extract from structured done output
        if (output.raw?.done?.text || output.raw?.text) {
          const s = String(output.raw.done?.text || output.raw.text).trim();
          if (s.length > 0) return s;
        }
        return output.text;
      }
    }

    // Concatenate all outputs in order
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
    this.abortController.abort();

    for (const [id, st] of this.state.subtaskStatus) {
      if (st !== 'completed') this.state.subtaskStatus.set(id, 'cancelled');
    }
    for (const sid of this.state.sailorSessionIds.values()) {
      this.sailor.cancel(sid).catch(() => {});
    }

    this.onEvent({ type: 'workflow_aborted', reason });
    this._resolve?.(reason);
  }

  private findSailorSession(subtaskId: SubtaskId): string | undefined {
    const sailorId = this.state.sailorAssignments.get(subtaskId);
    if (sailorId === undefined) return undefined;
    return this.state.sailorSessionIds.get(sailorId);
  }
}
