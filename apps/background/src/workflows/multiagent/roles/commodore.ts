import { createLogger } from '@src/log';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { extractJsonFromModelOutput } from '@src/workflows/shared/messages/utils';
import { logLLMUsage, globalTokenTracker } from '@src/utils/token-tracker';
import { generalSettingsStore } from '@extension/storage';
import { buildContextTabsSystemMessage } from '@src/workflows/shared/context/context-tab-injector';
import { WorkflowType } from '@extension/shared/lib/workflows/types';
import { convertZodToJsonSchema } from '@src/utils';
import { commodoreSystemPrompt } from './commodore-prompt';
import { commodorePlanSchema } from './commodore-schema';
import { IncrementalPlanParser } from '../incremental-plan-parser';
import type { TaskPlan, Subtask, SubtaskId } from '../multiagent-types';

const logger = createLogger('Commodore');

interface CommodoreOptions {
  historyBlock?: string;
  sessionId?: string;
  contextTabIds?: number[];
}

/**
 * The Commodore plans the workflow — decomposes a user query into a TaskPlan DAG.
 * Single LLM call, then done. No further involvement in execution.
 */
export class Commodore {
  /** Blocking plan creation. Prefers structured output; falls back to text-parse. */
  async createPlan(
    query: string,
    llm: any,
    maxWorkers: number,
    signal?: AbortSignal,
    options?: CommodoreOptions,
  ): Promise<TaskPlan> {
    logger.info('Creating plan...');
    if (typeof llm?.withStructuredOutput === 'function') {
      try {
        return await this.createPlanStructured(query, llm, signal, options);
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.toLowerCase().includes('abort') || msg.includes('timed out')) throw e;
        logger.warning(`Structured-output plan failed (${msg}); falling back to text-parse path`);
      }
    }

    const timeoutMs = ((await generalSettingsStore.getSettings()).responseTimeoutSeconds ?? 120) * 1000;
    const { signal: combinedSignal, isTimeout, cleanup } = createTimeoutSignal(signal, timeoutMs);
    const msgs = await this.buildMessages(query, llm, options);

    let content: string;
    try {
      const res = await llm.invoke(msgs as any, { signal: combinedSignal } as any);
      cleanup();
      content = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
      this.logUsage(res, llm, msgs, options);
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

    return this.finalizePlanFromText(content);
  }

  /**
   * Structured-output path — the model API enforces schema conformance
   * server-side, so the extension never has to parse prose. This is the
   * preferred implementation when the adapter exposes withStructuredOutput.
   */
  private async createPlanStructured(
    query: string,
    llm: any,
    signal?: AbortSignal,
    options?: CommodoreOptions,
  ): Promise<TaskPlan> {
    const timeoutMs = ((await generalSettingsStore.getSettings()).responseTimeoutSeconds ?? 120) * 1000;
    const { signal: combinedSignal, isTimeout, cleanup } = createTimeoutSignal(signal, timeoutMs);
    const msgs = await this.buildMessages(query, llm, options);

    const jsonSchema = convertZodToJsonSchema(commodorePlanSchema, 'commodore_plan', true);
    const structured = llm.withStructuredOutput(jsonSchema, {
      includeRaw: true,
      name: 'commodore_plan',
    });

    let response: any;
    try {
      response = await structured.invoke(msgs as any, { signal: combinedSignal } as any);
      cleanup();
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

    this.logUsage(response?.raw ?? response, llm, msgs, options);

    const parsed = response?.parsed ?? response;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Commodore structured output returned no parsed result');
    }
    return this.finalizePlanFromParsed(parsed as Record<string, unknown>);
  }

  /**
   * Streaming plan creation with warm-start support.
   * Calls onRootSubtask for each root subtask (dependencies: []) as soon as
   * it is fully parseable in the stream, before the complete plan is available.
   * Falls back to blocking createPlan if the LLM lacks invokeStreaming.
   */
  async createPlanStreaming(
    query: string,
    llm: any,
    maxWorkers: number,
    signal?: AbortSignal,
    options?: CommodoreOptions,
    onRootSubtask?: (subtask: Subtask) => void,
  ): Promise<TaskPlan> {
    // Structured output is more reliable than streaming text-parse for a single
    // planning call, so prefer it when the adapter supports it. UX regression
    // (no token-by-token plan rendering) is acceptable for a <10 s call.
    if (typeof llm?.withStructuredOutput === 'function') {
      return this.createPlan(query, llm, maxWorkers, signal, options);
    }
    if (typeof llm.invokeStreaming !== 'function') {
      return this.createPlan(query, llm, maxWorkers, signal, options);
    }

    logger.info('Creating plan (streaming)...');
    const timeoutMs = ((await generalSettingsStore.getSettings()).responseTimeoutSeconds ?? 120) * 1000;
    const { signal: combinedSignal, isTimeout, cleanup } = createTimeoutSignal(signal, timeoutMs);
    const msgs = await this.buildMessages(query, llm, options);

    const parser = new IncrementalPlanParser();
    let lastUsage: any;

    try {
      for await (const chunk of llm.invokeStreaming(msgs as any, combinedSignal)) {
        if (chunk.usage) lastUsage = chunk.usage;
        for (const subtask of parser.feed(chunk.text)) {
          onRootSubtask?.(subtask);
        }
      }
      cleanup();
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

    this.logUsage(
      { content: parser.getFullContent(), response_metadata: { usage: lastUsage }, usage_metadata: lastUsage },
      llm,
      msgs,
      options,
    );
    return this.finalizePlanFromText(parser.getFullContent());
  }

  // --- Private helpers ---

  private async buildMessages(
    query: string,
    llm: any,
    options?: CommodoreOptions,
  ): Promise<Array<SystemMessage | HumanMessage>> {
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
    return msgs;
  }

  private finalizePlanFromText(content: string): TaskPlan {
    const parsed = extractJsonFromModelOutput(content);
    return this.finalizePlanFromParsed(parsed);
  }

  private finalizePlanFromParsed(parsed: Record<string, unknown>): TaskPlan {
    let plan = normalizePlannerJson(parsed);
    plan = optimizePlan(plan);
    const finals = plan.subtasks.filter(s => s.isFinal);
    if (finals.length !== 1) throw new Error('Commodore must produce exactly one final subtask');
    return plan;
  }

  private logUsage(res: any, llm: any, msgs: any[], options?: CommodoreOptions): void {
    const taskId = options?.sessionId || globalTokenTracker.getCurrentTaskId() || 'unknown';
    logLLMUsage(res, {
      taskId,
      role: 'commodore',
      modelName: llm?.modelName || llm?.model || 'unknown',
      inputMessages: msgs,
    });
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
