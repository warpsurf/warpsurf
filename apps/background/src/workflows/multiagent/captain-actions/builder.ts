import { createLogger } from '@src/log';
import type { CaptainActionSchema } from './schemas';
import { allCaptainActionSchemas } from './schemas';
import type { CaptainState } from '../captain-state';
import type { Crew } from '../roles/crew';
import type { SubtaskId } from '../multiagent-types';
import type { CaptainDecision, WorkflowEvent } from '../workflow-events';

const logger = createLogger('CaptainAction');

export const MAX_TOTAL_ATTEMPTS = 3;

export interface CaptainActionResult {
  planModified?: boolean;
  halt?: boolean;
}

export interface CaptainActionContext {
  state: CaptainState;
  crew: Crew;
  findCrewSession(subtaskId: SubtaskId): string | undefined;
  abort(reason: string): void;
  pause(reason: string): Promise<void>;
  finalize(answer: string): void;
  buildFinalAnswer(): string;
  emit(event: WorkflowEvent): void;
  isCancelled(): boolean;
}

type ActionHandler = (args: any) => Promise<CaptainActionResult>;

export class CaptainAction {
  constructor(
    public readonly schema: CaptainActionSchema,
    private readonly handler: ActionHandler,
  ) {}

  async execute(raw: unknown): Promise<CaptainActionResult> {
    const parsed = this.schema.schema.safeParse(raw);
    if (!parsed.success) {
      logger.warning(`Invalid ${this.schema.name}: ${parsed.error.message}`);
      return {};
    }
    return this.handler(parsed.data);
  }

  name(): string {
    return this.schema.name;
  }
}

// --- Builder: constructs all captain actions bound to a context ---

export function buildCaptainActions(ctx: CaptainActionContext): CaptainAction[] {
  const { state, crew } = ctx;

  async function cancelCrewForSubtask(subtaskId: SubtaskId): Promise<void> {
    const sessionId = ctx.findCrewSession(subtaskId);
    if (!sessionId) return;
    await crew.cancel(sessionId);
    const crewId = state.crewAssignments.get(subtaskId);
    if (crewId !== undefined) {
      state.crewSessionIds.delete(crewId);
      state.busyCrew.delete(crewId);
    }
  }

  function isCompleted(id: SubtaskId): boolean {
    return state.subtaskStatus.get(id) === 'completed';
  }

  const handlers: Record<string, ActionHandler> = {
    async dispatch_subtask(args) {
      if (state.subtaskStatus.get(args.subtask_id) === 'pending' && args.refined_prompt) {
        state.plan.modifySubtask(args.subtask_id, { prompt: args.refined_prompt });
      }
      return {};
    },

    async cancel_subtask(args) {
      if (isCompleted(args.subtask_id)) return {};
      await cancelCrewForSubtask(args.subtask_id);
      state.subtaskStatus.set(args.subtask_id, 'cancelled');
      return {};
    },

    async retry_subtask(args) {
      if (isCompleted(args.subtask_id)) return {};
      const attempts = state.dispatchAttempts.get(args.subtask_id) ?? 0;
      if (attempts >= MAX_TOTAL_ATTEMPTS) {
        logger.warning(`Ignoring retry for #${args.subtask_id} — hard cap reached`);
        state.subtaskStatus.set(args.subtask_id, 'failed');
        return {};
      }
      if (args.modified_prompt) state.plan.modifySubtask(args.subtask_id, { prompt: args.modified_prompt });
      state.subtaskStatus.set(args.subtask_id, 'pending');
      return {};
    },

    async skip_subtask(args) {
      if (isCompleted(args.subtask_id)) return {};
      await cancelCrewForSubtask(args.subtask_id);
      state.markSkipped(args.subtask_id);
      return {};
    },

    async add_subtask(args) {
      const newId = state.plan.addSubtask(args.subtask);
      state.subtaskStatus.set(newId, 'pending');
      return { planModified: true };
    },

    async modify_subtask(args) {
      const changes: any = {};
      if (args.new_prompt) changes.prompt = args.new_prompt;
      if (args.new_title) changes.title = args.new_title;
      if (args.no_browse !== undefined) changes.noBrowse = args.no_browse;
      state.plan.modifySubtask(args.subtask_id, changes);
      if (Array.isArray(args.new_dependencies)) {
        state.plan.setDependencies(args.subtask_id, args.new_dependencies);
        return { planModified: true };
      }
      return {};
    },

    async modify_plan(args) {
      const completedIds = state.getCompletedIds();
      const removedIds: SubtaskId[] = [];

      for (const [id, st] of state.subtaskStatus) {
        if (completedIds.has(id)) continue;
        removedIds.push(id);
        if (st === 'running' || st === 'dispatched') {
          await cancelCrewForSubtask(id);
        }
        state.subtaskStatus.set(id, 'cancelled');
      }

      const newIds = state.plan.replacePendingSubtasks(args.revised_subtasks, completedIds);
      for (const id of newIds) state.subtaskStatus.set(id, 'pending');

      // Identify completed subtasks no longer referenced by any new subtask
      const referencedByNew = new Set<SubtaskId>();
      for (const nid of newIds) {
        for (const dep of state.plan.getTransitiveDependencies(nid)) {
          if (completedIds.has(dep)) referencedByNew.add(dep);
        }
      }
      const obsoleteIds = [...completedIds].filter(id => !referencedByNew.has(id));
      state.obsoleteCompletedIds = new Set(obsoleteIds);

      ctx.emit({ type: 'plan_modified', reason: args.reason, addedIds: newIds, removedIds, obsoleteIds });
      return { planModified: true };
    },

    async launch_speculative(args) {
      const ids: SubtaskId[] = [];
      for (const alt of args.alternatives) {
        const id = state.plan.addSubtask(alt);
        state.subtaskStatus.set(id, 'pending');
        ids.push(id);
      }
      state.plan.addSpeculativeGroup(args.goal_id, ids);
      state.speculativeRaces.set(args.goal_id, { candidates: ids });
      ctx.emit({ type: 'speculative_launched', goalId: args.goal_id, candidates: ids });
      return { planModified: true };
    },

    async resolve_speculative(args) {
      const losers = state.plan.resolveSpeculation(args.goal_id, args.winner_id);
      for (const lid of losers) {
        const sid = ctx.findCrewSession(lid);
        if (sid) await crew.cancel(sid);
        state.subtaskStatus.set(lid, 'cancelled');
      }
      const race = state.speculativeRaces.get(args.goal_id);
      if (race) race.winner = args.winner_id;
      ctx.emit({
        type: 'speculative_resolved',
        goalId: args.goal_id,
        winnerId: args.winner_id,
        cancelledIds: losers,
      });
      return { planModified: true };
    },

    async complete_workflow(args) {
      for (const [crewId, sid] of state.crewSessionIds) {
        crew.cancel(sid).catch(() => {});
      }
      state.crewSessionIds.clear();
      state.busyCrew.clear();
      for (const [id, st] of state.subtaskStatus) {
        if (st !== 'completed' && st !== 'skipped') {
          state.subtaskStatus.set(id, 'cancelled');
        }
      }
      const partial = ctx.buildFinalAnswer();
      const answer = partial
        ? `${partial}\n\nNote: This workflow was completed early. ${args.reason}`
        : `Workflow completed early. ${args.reason}`;
      ctx.finalize(answer);
      return { halt: true };
    },

    async abort_workflow(args) {
      ctx.abort(args.reason);
      return { halt: true };
    },

    async pause_workflow(args) {
      await ctx.pause(args.reason);
      return { halt: true };
    },
  };

  return allCaptainActionSchemas.map(schema => new CaptainAction(schema, handlers[schema.name]));
}

// --- Validation + execution ---

export function parseDecision(raw: any, actionNames: Set<string>): CaptainDecision {
  const statusMessage = String(raw?.status_message || 'Processing...');
  const actions: any[] = [];
  for (const a of Array.isArray(raw?.actions) ? raw.actions : []) {
    if (a?.type && actionNames.has(a.type)) actions.push(a);
  }
  return { status_message: statusMessage, actions };
}

export async function executeActions(
  actions: CaptainAction[],
  decision: CaptainDecision,
  isCancelled?: () => boolean,
): Promise<{ planModified: boolean }> {
  const registry = new Map(actions.map(a => [a.name(), a]));
  let planModified = false;

  for (const raw of decision.actions) {
    if (isCancelled?.()) break;
    const action = registry.get(raw.type);
    if (!action) continue;
    const result = await action.execute(raw);
    if (result.planModified) planModified = true;
    if (result.halt) break;
  }

  return { planModified };
}
