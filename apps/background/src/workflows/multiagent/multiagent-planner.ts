import { createLogger } from '@src/log';
import { extractJsonFromModelOutput } from '@src/workflows/shared/messages/utils';
import type { TaskPlan, Subtask, SubtaskId } from './multiagent-types';
import { multiagentPlannerSystemPrompt } from '@src/workflows/multiagent/multiagent-planner-prompt';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { logLLMUsage, globalTokenTracker } from '@src/utils/token-tracker';
import { generalSettingsStore } from '@extension/storage';
import { buildContextTabsSystemMessage } from '@src/workflows/shared/context/context-tab-injector';
import { WorkflowType } from '@extension/shared/lib/workflows/types';

const logger = createLogger('workflow:planner');

interface TimeoutSignalResult {
  signal: AbortSignal;
  isTimeout: () => boolean;
  cleanup: () => void;
}

/** Create an AbortSignal with timeout, respecting an optional parent signal */
function createTimeoutSignal(parentSignal?: AbortSignal, timeoutMs?: number): TimeoutSignalResult {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Response timeout exceeded'));
    }, timeoutMs);
  }

  if (parentSignal) {
    parentSignal.addEventListener(
      'abort',
      () => {
        if (timeoutId) clearTimeout(timeoutId);
        controller.abort(parentSignal.reason);
      },
      { once: true },
    );
  }

  controller.signal.addEventListener(
    'abort',
    () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
    { once: true },
  );

  return {
    signal: controller.signal,
    isTimeout: () => timedOut,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}

/** Build the system prompt for the multi-agent workflow planner. */
export function buildPlannerSystemPrompt(maxWorkers: number): string {
  // Use the Multiagent Planner template verbatim for consistency across Planner paths,
  return multiagentPlannerSystemPrompt;
}

/**
 * Call an LLM with messages and return string content. This is a minimal wrapper to keep planner generic.
 */
async function invokeLLM(llm: any, system: string, user: string, historyBlock?: string): Promise<string> {
  const messages = [
    new SystemMessage(system),
    ...(historyBlock && historyBlock.trim().length > 0 ? [new SystemMessage(historyBlock)] : []),
    new HumanMessage(user),
  ];
  const res = await llm.invoke(messages as any);
  const content: string = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  return content;
}

/** Parse planner JSON into TaskPlan and validate constraints. */
function normalizePlannerJson(raw: any): TaskPlan {
  if (!raw || typeof raw !== 'object') throw new Error('Planner returned empty or invalid JSON');
  const task = String(raw.task || raw.title || 'User task').trim();
  const subtasksRaw: any[] = Array.isArray(raw.subtasks) ? raw.subtasks : [];
  if (subtasksRaw.length === 0) throw new Error('Planner produced no subtasks');

  // Convert ids to numbers, ensure unique and sequential-like
  const seen = new Set<number>();
  const subtasks: Subtask[] = subtasksRaw.map((t, idx) => {
    const idStr = String(t.id ?? String(idx + 1));
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id)) throw new Error(`Invalid subtask id: ${idStr}`);
    if (seen.has(id)) throw new Error(`Duplicate subtask id: ${id}`);
    seen.add(id);
    const title = String(t.title || `Step ${id}`).trim();
    const prompt = String(t.prompt || '').trim();
    const deps: SubtaskId[] = Array.isArray(t.dependencies)
      ? t.dependencies.map((d: any) => Number.parseInt(String(d), 10)).filter((n: number) => Number.isFinite(n))
      : [];
    const noBrowse = !!(t.no_browse || t.noBrowse);
    const suggestedUrls: string[] = Array.isArray(t.suggested_urls)
      ? t.suggested_urls.map((s: any) => String(s))
      : Array.isArray(t.suggestedUrls)
        ? t.suggestedUrls.map((s: any) => String(s))
        : [];
    const suggestedSearchQueries: string[] = Array.isArray(t.suggested_search_queries)
      ? t.suggested_search_queries.map((s: any) => String(s))
      : Array.isArray(t.suggestedSearchQueries)
        ? t.suggestedSearchQueries.map((s: any) => String(s))
        : [];
    return { id, title, prompt, startCriteria: deps, noBrowse, suggestedUrls, suggestedSearchQueries };
  });

  // Validate dependencies exist
  const allIds = new Set(subtasks.map(s => s.id));
  for (const s of subtasks) {
    for (const d of s.startCriteria) {
      if (!allIds.has(d)) throw new Error(`Subtask ${s.id} has missing dependency ${d}`);
    }
  }

  // Enforce single final validator: choose last node (sink) by no dependents OR last id if ambiguous
  const dependents = new Map<SubtaskId, number>(Array.from(allIds).map(id => [id, 0]));
  for (const s of subtasks) {
    for (const d of s.startCriteria) dependents.set(d, (dependents.get(d) || 0) + 1);
  }
  const sinks = subtasks.filter(s => (dependents.get(s.id) || 0) === 0);
  let finalId: SubtaskId;
  if (sinks.length >= 1) {
    finalId = sinks.sort((a, b) => a.id - b.id)[sinks.length - 1].id;
  } else {
    finalId = subtasks.sort((a, b) => a.id - b.id)[subtasks.length - 1].id;
  }
  for (const s of subtasks) s.isFinal = s.id === finalId;

  // Build dependencies map and durations=1 by default
  const dependencies: Record<SubtaskId, SubtaskId[]> = {};
  for (const s of subtasks) dependencies[s.id] = [...s.startCriteria];

  // Validate DAG (cycle detection via DFS)
  const temp = new Set<SubtaskId>();
  const perm = new Set<SubtaskId>();
  const visit = (n: SubtaskId) => {
    if (perm.has(n)) return;
    if (temp.has(n)) throw new Error('Planner produced cyclic dependencies');
    temp.add(n);
    for (const d of dependencies[n] || []) visit(d);
    temp.delete(n);
    perm.add(n);
  };
  for (const s of subtasks) visit(s.id);

  return { task, subtasks, dependencies, durations: {} };
}

/**
 * Produce a TaskPlan from a user query using the provided LLM.
 */
export async function planSubtasksFromQuery(
  query: string,
  llm: any,
  maxWorkers: number,
  signal?: AbortSignal,
  historyBlock?: string,
  sessionId?: string,
  contextTabIds?: number[],
): Promise<TaskPlan> {
  console.info('[Planner] Creating plan...');
  const system = buildPlannerSystemPrompt(maxWorkers);
  const user = `User query: ${query}\n\nReturn only the JSON object described above.`;

  // Get timeout from settings and create combined signal
  const settings = await generalSettingsStore.getSettings();
  const timeoutMs = (settings.responseTimeoutSeconds ?? 120) * 1000;
  const { signal: timeoutSignal, isTimeout, cleanup } = createTimeoutSignal(signal, timeoutMs);

  let content: string;
  try {
    if (llm && typeof llm.invoke === 'function') {
      const msgs: Array<SystemMessage | HumanMessage> = [new SystemMessage(system)];

      // Inject context tabs if available (for multi-agent planner)
      if (contextTabIds && contextTabIds.length > 0) {
        try {
          const modelName = llm?.modelName || llm?.model_name;
          const contextMsg = await buildContextTabsSystemMessage(contextTabIds, WorkflowType.MULTIAGENT, modelName);
          if (contextMsg) {
            msgs.push(contextMsg);
            logger.info(`Context tabs injected into Planner: ${contextTabIds.length} tabs`);
          }
        } catch (err) {
          logger.error('Failed to inject context tabs into planner:', err);
        }
      }

      // Inject history context if available (for multi-agent workflow)
      try {
        const { getHistoryContextMessage } = await import('@src/workflows/shared/context/history-injector');
        const historyContextMsg = await getHistoryContextMessage();
        if (historyContextMsg) {
          msgs.push(historyContextMsg);
          logger.info('History context injected into Planner (multi-agent)');
        }
      } catch (err) {
        logger.error('Failed to inject history context into planner:', err);
      }

      // Add chat history block if provided
      if (historyBlock && historyBlock.trim().length > 0) {
        msgs.push(new SystemMessage(historyBlock));
      }

      // Add user query
      msgs.push(new HumanMessage(user));

      const res = await llm.invoke(msgs as any, { signal: timeoutSignal } as any);
      cleanup();
      content =
        typeof (res as any)?.content === 'string' ? (res as any).content : JSON.stringify((res as any)?.content ?? '');

      // Log token usage with the session ID - planner knows its context
      const taskId = sessionId || globalTokenTracker.getCurrentTaskId() || 'unknown';
      const modelName = llm?.modelName || llm?.model || 'unknown';
      logLLMUsage(res, { taskId, role: 'planner', modelName, inputMessages: msgs });
    } else {
      content = await invokeLLM(llm, system, user, historyBlock);
      cleanup();
    }
  } catch (e: any) {
    cleanup();
    // Check timeout FIRST using tracked state
    if (isTimeout()) {
      throw new Error(`Response timed out after ${timeoutMs / 1000} seconds`);
    }
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes('abort')) {
      throw new Error('Cancelled by user');
    }
    throw e;
  }
  let parsed: any;
  try {
    parsed = extractJsonFromModelOutput(content);
  } catch (e) {
    logger.error('Failed to parse planner output:', e);
    throw new Error('Planner returned invalid JSON');
  }
  let plan = normalizePlannerJson(parsed);
  // Apply a lightweight optimizer to enforce knowledge-first behavior and remove redundant generic searches
  plan = optimizePlan(plan);
  // Ensure exactly one final
  const finals = plan.subtasks.filter(s => s.isFinal);
  if (finals.length !== 1) throw new Error('Planner must produce exactly one final subtask');
  return plan;
}

/** Heuristic optimizer to enforce no-browse for knowledge-only steps and prune redundant searches. */
function optimizePlan(plan: TaskPlan): TaskPlan {
  try {
    const subtasks = plan.subtasks.map(s => ({ ...s }));
    const idToIndex = new Map<number, number>(subtasks.map((s, i) => [s.id, i]));
    const dependencies: Record<number, number[]> = JSON.parse(JSON.stringify(plan.dependencies));

    // 1) Mark knowledge-only generation/listing steps as noBrowse and tighten prompts
    for (const s of subtasks) {
      const titleL = s.title.toLowerCase();
      const promptL = s.prompt.toLowerCase();
      const looksLikeList =
        /(generate|list|provide|output)\b[\s\S]*\b(list|names|items|colleges|universities|examples)\b/.test(
          titleL + ' ' + promptL,
        );
      if (looksLikeList) {
        s.noBrowse = true;
        if (!/do not browse|no browse|without browsing/.test(promptL)) {
          s.prompt =
            `${s.prompt}\n\nConstraints: Use your internal knowledge to produce the list. Do not browse.`.trim();
        }
      }
    }

    // 2) Remove redundant generic Google search tasks that only feed listing tasks
    const isGenericSearch = (s: Subtask) =>
      /google\s+search|web\s+search/.test(s.title.toLowerCase() + ' ' + s.prompt.toLowerCase());
    const toRemove = new Set<number>();
    for (const s of subtasks) {
      if (!isGenericSearch(s)) continue;
      // If a dependent is a knowledge list step, we can bypass the search
      const consumers = subtasks.filter(x => (dependencies[x.id] || []).includes(s.id));
      if (consumers.some(c => !!c.noBrowse)) {
        toRemove.add(s.id);
      }
    }
    if (toRemove.size > 0) {
      // Rewire dependencies: replace references to removed node with its deps
      for (const [tid, deps] of Object.entries(dependencies)) {
        const numTid = Number(tid);
        const newDeps: number[] = [];
        for (const d of deps) {
          if (toRemove.has(d)) {
            for (const upstream of dependencies[d] || []) newDeps.push(upstream);
          } else {
            newDeps.push(d);
          }
        }
        dependencies[numTid] = Array.from(new Set(newDeps));
      }
    }

    const filtered = subtasks.filter(s => !toRemove.has(s.id));
    return { task: plan.task, subtasks: filtered, dependencies, durations: plan.durations };
  } catch {
    return plan;
  }
}
