import { createLogger } from '../log';
import { calculateCost } from './cost-calculator';

const logger = createLogger('TokenTracker');

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number; // includes thought tokens
  totalTokens: number;
  thoughtTokens?: number;
  webSearchCount?: number;
  timestamp: number;
  requestStartTime?: number; // When the API request started (for accurate latency calculation)
  provider: string;
  modelName: string;
  cost: number; // Cost in USD
  // Track associated task to be resilient if ID generation changes
  taskId?: string;
  // Parent session id for grouping (stamped by tracker)
  sessionId?: string;
  // Attached worker index (1-based) when available to support strict grouping in UI
  workerIndex?: number;
  // Workflow run index (1-based) to distinguish between multiple workflow runs in the same session
  workflowRunIndex?: number;
  // Logical role responsible for the call
  role?:
    | 'agent_planner'
    | 'agent_navigator'
    | 'agent_validator'
    | 'multiagent_planner'
    | 'multiagent_worker'
    | 'multiagent_refiner'
    | 'chat'
    | 'search'
    | 'auto'
    | 'system'
    | string;
  // Optional subtask id when available
  subtaskId?: number;
  // Optional raw payloads for logging (redacted where appropriate)
  request?: any;
  response?: any;
}

class TokenUsageTracker {
  // Single storage for all tokens - simpler and avoids race condition issues with parallel workers
  private apiCallTokens: Map<string, TokenUsage> = new Map();
  private fingerprints: Set<string> = new Set();
  private currentTaskId: string | null = null;
  private currentRole: string | null = null;
  private currentSubtaskId: number | null = null;
  // Track worker ID for each worker session
  private workerIds: Map<string, number> = new Map();
  // Map worker session → parent session for grouping
  private workerToParent: Map<string, string> = new Map();
  // Current parent session - stable within a multi-agent workflow
  private currentParentSession: string | null = null;
  // Track workflow run index per session (1-based, incremented each time a new workflow starts)
  private workflowRunIndices: Map<string, number> = new Map();
  // Current workflow run index for the active session
  private currentWorkflowRunIndex: number = 0;
  // Store action schema per session (logged once at workflow start)
  private sessionSchemas: Map<string, { schema: any; timestamp: number }> = new Map();

  setCurrentTaskId(taskId: string) {
    this.currentTaskId = taskId;
  }

  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  setCurrentRole(role: string | null) {
    this.currentRole = role;
  }

  getCurrentRole(): string | null {
    return this.currentRole;
  }

  setCurrentSubtaskId(subtaskId: number | null) {
    this.currentSubtaskId = typeof subtaskId === 'number' && Number.isFinite(subtaskId) ? subtaskId : null;
  }

  getCurrentSubtaskId(): number | null {
    return this.currentSubtaskId;
  }

  // Register a worker session with its worker ID (1-based)
  registerWorkerSession(sessionId: string, workerId: number) {
    this.workerIds.set(sessionId, workerId);
  }

  linkWorkerToParentSession(workerSessionId: string, parentSessionId: string) {
    if (workerSessionId && parentSessionId) {
      this.workerToParent.set(workerSessionId, parentSessionId);
      // Set as current parent session - this is stable for all workers in the same workflow
      this.currentParentSession = parentSessionId;
    }
  }

  getCurrentParentSession(): string | null {
    return this.currentParentSession;
  }

  setCurrentParentSession(sessionId: string | null) {
    this.currentParentSession = sessionId;
  }

  // Get the worker ID for a session
  getWorkerIdForSession(sessionId: string): number | undefined {
    return this.workerIds.get(sessionId);
  }

  // Increment and return the workflow run index for a session (called when a new workflow starts)
  incrementWorkflowRunIndex(sessionId: string): number {
    const current = this.workflowRunIndices.get(sessionId) || 0;
    const next = current + 1;
    this.workflowRunIndices.set(sessionId, next);
    this.currentWorkflowRunIndex = next;
    return next;
  }

  // Get the current workflow run index for a session
  getWorkflowRunIndex(sessionId: string): number {
    return this.workflowRunIndices.get(sessionId) || 0;
  }

  // Get the current active workflow run index
  getCurrentWorkflowRunIndex(): number {
    return this.currentWorkflowRunIndex;
  }

  // Set the current workflow run index (for use when context switches)
  setCurrentWorkflowRunIndex(index: number) {
    this.currentWorkflowRunIndex = index;
  }

  // Store action schema for a session (called once at workflow start)
  setSessionSchema(sessionId: string, schema: any) {
    if (!sessionId || !schema) return;
    // Only store once per session - don't overwrite if already set
    if (!this.sessionSchemas.has(sessionId)) {
      this.sessionSchemas.set(sessionId, { schema, timestamp: Date.now() });
      logger.debug('Stored action schema for session', { sessionId });
    }
  }

  // Get action schema for a session
  getSessionSchema(sessionId: string): { schema: any; timestamp: number } | null {
    return this.sessionSchemas.get(sessionId) || null;
  }

  addTokenUsage(apiCallId: string, usage: TokenUsage) {
    const taskId = usage.taskId || this.currentTaskId || 'unknown';

    // CRITICAL: Resolve parent session for grouping
    // Priority: explicit workerToParent mapping > currentParentSession > taskId itself
    // currentParentSession is stable within a multi-agent workflow, so even if taskId is wrong
    // due to race conditions, the sessionId will be correct for querying
    const parentSessionId = this.workerToParent.get(taskId) || this.currentParentSession || taskId;

    // Try to get workerIndex from multiple sources (thorough lookup)
    let workerIndex = usage.workerIndex;
    if (typeof workerIndex !== 'number') {
      // Check if this taskId is a registered worker
      workerIndex = this.workerIds.get(taskId);
    }
    if (typeof workerIndex !== 'number' && this.currentTaskId) {
      // Check if currentTaskId is a registered worker
      workerIndex = this.workerIds.get(this.currentTaskId);
    }
    if (typeof workerIndex !== 'number') {
      // Try to find any worker session that maps to this parent session
      for (const [sid, parent] of this.workerToParent.entries()) {
        if (String(parent) === String(parentSessionId)) {
          const wid = this.workerIds.get(sid);
          if (typeof wid === 'number' && (taskId === sid || this.currentTaskId === sid)) {
            workerIndex = wid;
            break;
          }
        }
      }
    }

    // Get the workflow run index for this session
    const workflowRunIndex =
      usage.workflowRunIndex || this.workflowRunIndices.get(parentSessionId) || this.currentWorkflowRunIndex || 0;

    const stamped: TokenUsage = {
      ...usage,
      taskId,
      sessionId: parentSessionId,
      workerIndex,
      workflowRunIndex: workflowRunIndex > 0 ? workflowRunIndex : undefined,
      role: usage.role || (this.currentRole as any) || undefined,
      subtaskId: typeof usage.subtaskId === 'number' ? usage.subtaskId : this.currentSubtaskId || undefined,
    };

    // Always store in the single apiCallTokens map
    this.apiCallTokens.set(apiCallId, stamped);
  }

  /** Add usage only once based on a stable fingerprint (prevents SDK+fetch double-logs). */
  addTokenUsageOnce(fingerprint: string, usage: TokenUsage) {
    // Use taskId for de-duplication scope - each agent call should be unique
    const taskScope = usage.taskId || this.currentTaskId || 'unknown';
    const scopedFingerprint = `${fingerprint}|task:${taskScope}`;

    if (this.fingerprints.has(scopedFingerprint)) {
      logger.debug('addTokenUsageOnce: Duplicate fingerprint, skipping', { fingerprint: scopedFingerprint });
      return;
    }
    this.fingerprints.add(scopedFingerprint);

    const apiCallId = this.generateApiCallId();
    this.addTokenUsage(apiCallId, usage);
  }

  getTokensForTask(taskId: string): TokenUsage[] {
    const taskTokens: TokenUsage[] = [];
    for (const [id, usage] of this.apiCallTokens.entries()) {
      // Match by:
      // 1. API call ID prefix (legacy)
      // 2. Exact taskId match
      // 3. sessionId match - THIS IS THE KEY for parallel workers
      //    Since sessionId is stamped from currentParentSession which is stable,
      //    querying for the parent session ID will find all worker tokens
      if (id.startsWith(taskId + '_') || usage.taskId === taskId || usage.sessionId === taskId) {
        taskTokens.push(usage);
      }
    }
    return taskTokens;
  }

  clearTokensForTask(taskId: string) {
    this.workerIds.delete(taskId);
    this.workerToParent.delete(taskId);

    // Clear tokens using same matching logic as getTokensForTask to ensure consistency
    const idsToDelete: string[] = [];
    for (const [id, usage] of this.apiCallTokens.entries()) {
      if (id.startsWith(taskId + '_') || usage.taskId === taskId || usage.sessionId === taskId) {
        idsToDelete.push(id);
      }
    }
    for (const id of idsToDelete) {
      this.apiCallTokens.delete(id);
    }

    // Clear fingerprints scoped to this task
    const fingerprintsToDelete: string[] = [];
    for (const fp of this.fingerprints) {
      if (fp.includes(`|task:${taskId}`)) {
        fingerprintsToDelete.push(fp);
      }
    }
    for (const fp of fingerprintsToDelete) {
      this.fingerprints.delete(fp);
    }
  }

  getWorkersForParent(parentSessionId: string): Array<{ sessionId: string; workerIndex: number }> {
    const out: Array<{ sessionId: string; workerIndex: number }> = [];
    for (const [sid, parent] of this.workerToParent.entries()) {
      if (String(parent) === String(parentSessionId)) {
        const wid = this.workerIds.get(sid);
        if (typeof wid === 'number' && wid > 0) out.push({ sessionId: sid, workerIndex: wid });
      }
    }
    return out;
  }

  // Get all worker sessions for a parent session
  getWorkerSessions(parentSessionId: string): string[] {
    return Array.from(this.workerToParent.entries())
      .filter(([_, parent]) => parent === parentSessionId)
      .map(([sid]) => sid);
  }

  generateApiCallId(): string {
    return `${this.currentTaskId || 'unknown'}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Collate logs for a parent session id into main/worker groups and compute totals.
   */
  getSessionLogs(sessionId: string): {
    main: TokenUsage[];
    workers: Record<number, TokenUsage[]>;
    totals: {
      perWorker: Record<number, { inputTokens: number; outputTokens: number; totalTokens: number; cost: number }>;
      overall: { inputTokens: number; outputTokens: number; totalTokens: number; cost: number };
    };
  } {
    // Get all tokens for this session (main + workers via sessionId match)
    const allTokens = this.getTokensForTask(String(sessionId));

    // Split into main (no workerIndex) and workers (has workerIndex)
    const main = allTokens.filter(u => !u.workerIndex);
    const workers: Record<number, TokenUsage[]> = {};
    for (const u of allTokens) {
      const idx = u.workerIndex;
      if (typeof idx === 'number' && idx > 0) {
        if (!workers[idx]) workers[idx] = [];
        workers[idx].push(u);
      }
    }

    // Compute totals (cost -1 means unavailable, only sum valid costs)
    const sum = (arr: TokenUsage[]) => {
      let hasAnyCost = false;
      const result = arr.reduce(
        (acc, u) => {
          acc.inputTokens += Math.max(0, Number(u.inputTokens) || 0);
          acc.outputTokens += Math.max(0, Number(u.outputTokens) || 0);
          acc.totalTokens += Math.max(0, Number(u.totalTokens) || 0);
          const uCost = Number(u.cost);
          if (isFinite(uCost) && uCost >= 0) {
            acc.cost += uCost;
            hasAnyCost = true;
          }
          return acc;
        },
        { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
      );
      if (!hasAnyCost) result.cost = -1;
      return result;
    };

    const perWorker: Record<number, { inputTokens: number; outputTokens: number; totalTokens: number; cost: number }> =
      {};
    for (const [k, arr] of Object.entries(workers)) {
      perWorker[Number(k)] = sum(arr);
    }
    const overall = sum(allTokens);

    return { main, workers, totals: { perWorker, overall } };
  }
}

export const globalTokenTracker = new TokenUsageTracker();

/**
 * Helper to log LLM token usage from a LangChain response.
 * Call this after receiving a response - the caller knows its own taskId.
 */
export function logLLMUsage(
  response: any,
  options: {
    taskId: string;
    role: string;
    modelName: string;
    provider?: string;
    inputMessages?: any[];
    requestStartTime?: number;
  },
): void {
  try {
    const { taskId, role, modelName, inputMessages } = options;
    if (!taskId) return;

    let inputTokens = 0;
    let outputTokens = 0;
    let thoughtTokens = 0;
    let webSearchCount = 0;

    // Try response_metadata (common for OpenAI, Anthropic)
    const metadata = response?.response_metadata || response?.raw?.response_metadata;
    if (metadata?.token_usage || metadata?.usage) {
      const usage = metadata.token_usage || metadata.usage;
      inputTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
      outputTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
      thoughtTokens = Number(usage.thinking_tokens || usage.reasoning_tokens || 0);
      webSearchCount = Number(usage.server_tool_use?.web_search_requests || 0);
    }
    // Try usage_metadata (Gemini format)
    else if (metadata?.usage_metadata || response?.usage_metadata) {
      const usage = metadata?.usage_metadata || response?.usage_metadata;
      inputTokens = Number(usage.promptTokenCount || usage.prompt_token_count || 0);
      outputTokens = Number(usage.candidatesTokenCount || usage.candidates_token_count || 0);
      thoughtTokens = Number(usage.thoughtsTokenCount || usage.thoughts_token_count || 0);
    }
    // Try raw response
    else if (response?.raw?.usage_metadata) {
      const usage = response.raw.usage_metadata;
      inputTokens = Number(usage.input_tokens || usage.promptTokenCount || 0);
      outputTokens = Number(usage.output_tokens || usage.candidatesTokenCount || 0);
      thoughtTokens = Number(usage.thoughts_token_count || usage.thoughtsTokenCount || 0);
    }

    const totalTokens = inputTokens + outputTokens + thoughtTokens;
    const hasUsageData = totalTokens > 0;

    // Determine provider
    let provider = options.provider || 'LLM';
    const modelLower = modelName.toLowerCase();
    if (modelLower.includes('gemini') || modelLower.includes('google')) {
      provider = 'Google Gemini';
    } else if (modelLower.includes('gpt') || modelLower.includes('openai')) {
      provider = 'OpenAI';
    } else if (modelLower.includes('claude') || modelLower.includes('anthropic')) {
      provider = 'Anthropic';
    }

    // Cost is -1 (unavailable) if we don't have actual token counts from API
    const cost = hasUsageData
      ? calculateCost(modelName, inputTokens, outputTokens + thoughtTokens, webSearchCount)
      : -1;

    const usage: TokenUsage = {
      inputTokens,
      outputTokens: outputTokens + thoughtTokens,
      totalTokens,
      thoughtTokens,
      webSearchCount,
      timestamp: Date.now(),
      requestStartTime: options.requestStartTime,
      provider,
      modelName,
      cost,
      taskId,
      role,
      request: inputMessages
        ? {
            messages: inputMessages.map((m: any) => ({
              // LangChain messages use _getType() for role, fallback to role property
              role: typeof m?._getType === 'function' ? m._getType() : m?.role,
              content: String(m?.content || ''),
            })),
          }
        : undefined,
      response: response?.content || response?.parsed || response,
    };

    const fingerprint = `llm|${provider}|${modelName}|${totalTokens}|${Math.round(Date.now() / 500)}`;
    globalTokenTracker.addTokenUsageOnce(fingerprint, usage);
  } catch (e) {
    // Silent fail
  }
}
