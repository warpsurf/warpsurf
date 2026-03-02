import { createLogger } from '@src/log';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { extractJsonFromModelOutput } from '@src/workflows/shared/messages/utils';
import { logLLMUsage, globalTokenTracker } from '@src/utils/token-tracker';
import { generalSettingsStore } from '@extension/storage';
import { buildContextTabsSystemMessage } from '@src/workflows/shared/context/context-tab-injector';
import { WorkflowType } from '@extension/shared/lib/workflows/types';
import { commodoreSystemPrompt } from './commodore-prompt';
import type { TaskPlan, Subtask, SubtaskId } from '../multiagent-types';

const logger = createLogger('Commodore');

/**
 * The Commodore plans the workflow — decomposes a user query into a TaskPlan DAG.
 * Single LLM call, then done. No further involvement in execution.
 */
export class Commodore {
  async createPlan(
    query: string,
    llm: any,
    maxWorkers: number,
    signal?: AbortSignal,
    options?: {
      historyBlock?: string;
      sessionId?: string;
      contextTabIds?: number[];
    },
  ): Promise<TaskPlan> {
    logger.info('Creating plan...');
    const timeoutMs = ((await generalSettingsStore.getSettings()).responseTimeoutSeconds ?? 120) * 1000;
    const { signal: combinedSignal, isTimeout, cleanup } = createTimeoutSignal(signal, timeoutMs);

    const msgs: Array<SystemMessage | HumanMessage> = [new SystemMessage(commodoreSystemPrompt)];

    if (options?.contextTabIds?.length) {
      try {
        const modelName = llm?.modelName || llm?.model_name;
        const contextMsg = await buildContextTabsSystemMessage(
          options.contextTabIds,
          WorkflowType.MULTIAGENT,
          modelName,
        );
        if (contextMsg) msgs.push(contextMsg);
      } catch (err) {
        logger.error('Failed to inject context tabs:', err);
      }
    }

    try {
      const { getHistoryContextMessage } = await import('@src/workflows/shared/context/history-injector');
      const historyMsg = await getHistoryContextMessage();
      if (historyMsg) msgs.push(historyMsg);
    } catch {}

    if (options?.historyBlock?.trim()) {
      msgs.push(new SystemMessage(options.historyBlock));
    }

    msgs.push(new HumanMessage(`User query: ${query}\n\nReturn only the JSON object described above.`));

    let content: string;
    try {
      const res = await llm.invoke(msgs as any, { signal: combinedSignal } as any);
      cleanup();
      content = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
      const taskId = options?.sessionId || globalTokenTracker.getCurrentTaskId() || 'unknown';
      logLLMUsage(res, {
        taskId,
        role: 'commodore',
        modelName: llm?.modelName || llm?.model || 'unknown',
        inputMessages: msgs,
      });
    } catch (e: any) {
      cleanup();
      if (isTimeout()) throw new Error(`Response timed out after ${timeoutMs / 1000} seconds`);
      if (
        String(e?.message || e)
          .toLowerCase()
          .includes('abort')
      )
        throw new Error('Cancelled by user');
      throw e;
    }

    const parsed = extractJsonFromModelOutput(content);
    let plan = normalizePlannerJson(parsed);
    plan = optimizePlan(plan);
    const finals = plan.subtasks.filter(s => s.isFinal);
    if (finals.length !== 1) throw new Error('Commodore must produce exactly one final subtask');
    return plan;
  }
}

// --- Helpers (ported from legacy planner, kept minimal) ---

function createTimeoutSignal(parentSignal?: AbortSignal, timeoutMs?: number) {
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

function normalizePlannerJson(raw: any): TaskPlan {
  if (!raw || typeof raw !== 'object') throw new Error('Commodore returned empty or invalid JSON');
  const task = String(raw.task || raw.title || 'User task').trim();
  const subtasksRaw: any[] = Array.isArray(raw.subtasks) ? raw.subtasks : [];
  if (subtasksRaw.length === 0) throw new Error('Commodore produced no subtasks');

  const seen = new Set<number>();
  const subtasks: Subtask[] = subtasksRaw.map((t, idx) => {
    const id = Number.parseInt(String(t.id ?? idx + 1), 10);
    if (!Number.isFinite(id)) throw new Error(`Invalid subtask id: ${t.id}`);
    if (seen.has(id)) throw new Error(`Duplicate subtask id: ${id}`);
    seen.add(id);
    const deps: SubtaskId[] = (Array.isArray(t.dependencies) ? t.dependencies : [])
      .map((d: any) => Number.parseInt(String(d), 10))
      .filter((n: number) => Number.isFinite(n));
    return {
      id,
      title: String(t.title || `Step ${id}`).trim(),
      prompt: String(t.prompt || '').trim(),
      startCriteria: deps,
      noBrowse: !!(t.no_browse || t.noBrowse),
      suggestedUrls: (Array.isArray(t.suggested_urls)
        ? t.suggested_urls
        : Array.isArray(t.suggestedUrls)
          ? t.suggestedUrls
          : []
      ).map(String),
      suggestedSearchQueries: (Array.isArray(t.suggested_search_queries)
        ? t.suggested_search_queries
        : Array.isArray(t.suggestedSearchQueries)
          ? t.suggestedSearchQueries
          : []
      ).map(String),
    };
  });

  const allIds = new Set(subtasks.map(s => s.id));
  for (const s of subtasks) {
    for (const d of s.startCriteria) {
      if (!allIds.has(d)) throw new Error(`Subtask ${s.id} has missing dependency ${d}`);
    }
  }

  // Mark the terminal node as final
  const dependents = new Map<SubtaskId, number>(Array.from(allIds).map(id => [id, 0]));
  for (const s of subtasks) for (const d of s.startCriteria) dependents.set(d, (dependents.get(d) || 0) + 1);
  const sinks = subtasks.filter(s => (dependents.get(s.id) || 0) === 0);
  const finalId =
    sinks.length >= 1
      ? sinks.sort((a, b) => a.id - b.id)[sinks.length - 1].id
      : subtasks.sort((a, b) => a.id - b.id)[subtasks.length - 1].id;
  for (const s of subtasks) s.isFinal = s.id === finalId;

  const dependencies: Record<SubtaskId, SubtaskId[]> = {};
  for (const s of subtasks) dependencies[s.id] = [...s.startCriteria];

  // Cycle detection
  const temp = new Set<SubtaskId>();
  const perm = new Set<SubtaskId>();
  const visit = (n: SubtaskId) => {
    if (perm.has(n)) return;
    if (temp.has(n)) throw new Error('Commodore produced cyclic dependencies');
    temp.add(n);
    for (const d of dependencies[n] || []) visit(d);
    temp.delete(n);
    perm.add(n);
  };
  for (const s of subtasks) visit(s.id);

  return { task, subtasks, dependencies, durations: {} };
}

function optimizePlan(plan: TaskPlan): TaskPlan {
  try {
    const subtasks = plan.subtasks.map(s => ({ ...s }));
    const dependencies: Record<number, number[]> = JSON.parse(JSON.stringify(plan.dependencies));

    // Mark knowledge-only steps as noBrowse
    for (const s of subtasks) {
      const text = (s.title + ' ' + s.prompt).toLowerCase();
      if (/(generate|list|provide|output)\b[\s\S]*\b(list|names|items|colleges|universities|examples)\b/.test(text)) {
        s.noBrowse = true;
        if (!/do not browse|no browse|without browsing/.test(s.prompt.toLowerCase())) {
          s.prompt =
            `${s.prompt}\n\nConstraints: Use your internal knowledge to produce the list. Do not browse.`.trim();
        }
      }
    }

    // Remove redundant generic searches feeding knowledge-only steps
    const isGenericSearch = (s: Subtask) =>
      /google\s+search|web\s+search/.test((s.title + ' ' + s.prompt).toLowerCase());
    const toRemove = new Set<number>();
    for (const s of subtasks) {
      if (!isGenericSearch(s)) continue;
      const consumers = subtasks.filter(x => (dependencies[x.id] || []).includes(s.id));
      if (consumers.some(c => !!c.noBrowse)) toRemove.add(s.id);
    }
    if (toRemove.size > 0) {
      for (const [tid, deps] of Object.entries(dependencies)) {
        const newDeps: number[] = [];
        for (const d of deps) {
          if (toRemove.has(d)) {
            for (const upstream of dependencies[d] || []) newDeps.push(upstream);
          } else newDeps.push(d);
        }
        dependencies[Number(tid)] = Array.from(new Set(newDeps));
      }
    }

    return {
      task: plan.task,
      subtasks: subtasks.filter(s => !toRemove.has(s.id)),
      dependencies,
      durations: plan.durations,
    };
  } catch {
    return plan;
  }
}
