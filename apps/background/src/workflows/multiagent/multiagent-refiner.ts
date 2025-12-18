import { createLogger } from '@src/log';
import { extractJsonFromModelOutput } from '@src/workflows/shared/messages/utils';
import type { TaskPlan, Subtask, SubtaskId } from './multiagent-types';
import { logLLMUsage, globalTokenTracker } from '@src/utils/token-tracker';
import { generalSettingsStore } from '@extension/storage';
import { multiagentRefinerSystemPrompt } from '@src/workflows/multiagent/multiagent-refiner-prompt';

const logger = createLogger('workflow:refiner');

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
    parentSignal.addEventListener('abort', () => {
      if (timeoutId) clearTimeout(timeoutId);
      controller.abort(parentSignal.reason);
    }, { once: true });
  }
  
  controller.signal.addEventListener('abort', () => {
    if (timeoutId) clearTimeout(timeoutId);
  }, { once: true });
  
  return {
    signal: controller.signal,
    isTimeout: () => timedOut,
    cleanup: () => { if (timeoutId) clearTimeout(timeoutId); },
  };
}

function buildRefinerSystemPrompt(): string {
  return multiagentRefinerSystemPrompt;
}

function stringifyTaskPlanForLLM(plan: TaskPlan): string {
  // Convert internal startCriteria->dependencies and noBrowse->no_browse for clarity to the LLM
  const subtasks = plan.subtasks.map(s => ({
    id: String(s.id),
    title: s.title,
    dependencies: s.startCriteria.map(d => String(d)),
    prompt: s.prompt,
    isFinal: !!s.isFinal,
    no_browse: !!s.noBrowse,
  }));
  const obj: any = {
    task: plan.task,
    subtasks,
    dependencies: plan.dependencies,
  };
  if (plan.durations && Object.keys(plan.durations).length > 0) obj.durations = plan.durations;
  return JSON.stringify(obj, null, 2);
}

async function invokeLLM(llm: any, system: string, user: string): Promise<string> {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const res = await llm.invoke(messages as any);
  const content: string = typeof (res as any)?.content === 'string' ? (res as any).content : JSON.stringify((res as any)?.content ?? '');
  return content;
}

function arraysEqualNumeric(a: Array<number>, b: Array<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Merge LLM-proposed refinements back into the existing plan, guarding invariants.
 */
function validateAndMergeRefinements(original: TaskPlan, candidate: any): TaskPlan {
  try {
    if (!candidate || typeof candidate !== 'object') throw new Error('Candidate is not an object');
    const candSubtasks: any[] = Array.isArray(candidate.subtasks) ? candidate.subtasks : [];
    if (candSubtasks.length !== original.subtasks.length) throw new Error('Subtask count changed');

    const originalById = new Map<SubtaskId, Subtask>(original.subtasks.map(s => [s.id, s]));
    const refined: Subtask[] = [];

    for (const ct of candSubtasks) {
      const idNum = Number.parseInt(String(ct.id), 10);
      if (!Number.isFinite(idNum)) throw new Error(`Invalid candidate id: ${ct.id}`);
      const base = originalById.get(idNum);
      if (!base) throw new Error(`Unknown subtask id in candidate: ${idNum}`);
      // Dependencies must not change; tolerate absent candidate.dependencies by ignoring
      const candDeps: number[] = Array.isArray(ct.dependencies)
        ? ct.dependencies.map((d: any) => Number.parseInt(String(d), 10)).filter((n: number) => Number.isFinite(n))
        : base.startCriteria.slice();
      if (!arraysEqualNumeric(candDeps, base.startCriteria)) {
        throw new Error(`Dependencies changed for subtask ${idNum}`);
      }

      const title = String(ct.title ?? base.title).trim();
      const prompt = String(ct.prompt ?? base.prompt).trim();
      const noBrowse = ct.no_browse !== undefined ? !!ct.no_browse : (ct.noBrowse !== undefined ? !!ct.noBrowse : !!base.noBrowse);

      refined.push({
        id: base.id,
        title,
        prompt,
        startCriteria: base.startCriteria.slice(),
        isFinal: !!base.isFinal,
        noBrowse,
      });
    }

    // Keep original order by sorting by id
    refined.sort((a, b) => a.id - b.id);

    // Sanity: Task string unchanged
    if (String(candidate.task || original.task) !== original.task) {
      logger.warning('Refiner attempted to modify top-level task; ignoring change.');
    }

    // Durations and dependencies preserved from original
    const merged: TaskPlan = {
      task: original.task,
      subtasks: refined,
      dependencies: original.dependencies,
      durations: original.durations,
    };
    return merged;
  } catch (e) {
    logger.warning('Refiner output rejected; falling back to original plan:', e);
    return original;
  }
}

export async function refinePlanWithLLM(plan: TaskPlan, llm: any, signal?: AbortSignal, sessionId?: string): Promise<TaskPlan> {
  console.info('[Refiner] Refining plan...');
  try {
    const system = buildRefinerSystemPrompt();
    const user = [
      '[[REFINER_RULES]]',
      system,
      '[[/REFINER_RULES]]',
      '',
      'Here is the current Task Plan JSON. Improve only subtask.title, subtask.prompt, and subtask.no_browse, preserving all other fields and structure. Return only the full JSON.',
      '',
      stringifyTaskPlanForLLM(plan),
    ].join('\n');
    
    // Get timeout from settings and create combined signal
    const settings = await generalSettingsStore.getSettings();
    const timeoutMs = (settings.responseTimeoutSeconds ?? 120) * 1000;
    const { signal: timeoutSignal, isTimeout, cleanup } = createTimeoutSignal(signal, timeoutMs);
    
    let content: string;
    try {
      if (llm && typeof llm.invoke === 'function') {
        const msgs = [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ];
        const res = await llm.invoke(msgs as any, { signal: timeoutSignal } as any);
        cleanup();
        content = typeof (res as any)?.content === 'string' ? (res as any).content : JSON.stringify((res as any)?.content ?? '');
        
        // Log token usage with the session ID
        const taskId = sessionId || globalTokenTracker.getCurrentTaskId() || 'unknown';
        const modelName = llm?.modelName || llm?.model || 'unknown';
        logLLMUsage(res, { taskId, role: 'refiner', modelName, inputMessages: msgs });
      } else {
        content = await invokeLLM(llm, system, user);
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
    const parsed = extractJsonFromModelOutput(content);
    const merged = validateAndMergeRefinements(plan, parsed);
    return merged;
  } catch (e) {
    logger.warning('Refiner invocation failed; using original plan:', e);
    return plan;
  }
}


