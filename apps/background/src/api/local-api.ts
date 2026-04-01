// Local API for programmatic access to WarpSurf via CDP

import { createLogger } from '../log';
import type { TaskManager } from '../task/task-manager';
import type { APIConfig, APIRunOptions, APIResult, APISettingsOverrides, APIUsage, APITraceEntry } from './types';
import { ephemeralStore } from './ephemeral-storage';
import {
  generalSettingsStore,
  firewallStore,
  llmProviderStore,
  agentModelStore,
  warningsSettingsStore,
  AgentNameEnum,
} from '@extension/storage';
import { handleNewTask } from '../executor/task-handlers';
import { subscribeToExecutorEvents } from '../workflows/shared/subscribe-to-executor-events';
import { globalTokenTracker } from '../utils/token-tracker';
import { MultiAgentWorkflow } from '../workflows/multiagent';
import { createChatModel } from '../workflows/models';
import { getAllProvidersDecrypted, getAllAgentModelsDecrypted } from '../crypto/service';

const logger = createLogger('LocalAPI');

const PROVIDER_ALIASES: Record<string, string> = {
  google: 'gemini',
  'google-ai': 'gemini',
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
  grok: 'grok',
  openrouter: 'openrouter',
  custom_openai: 'custom_openai',
  custom: 'custom_openai',
};

function normalizeProvider(provider: string): string {
  return PROVIDER_ALIASES[provider.toLowerCase()] ?? provider;
}

class LocalAPI {
  private taskManager: TaskManager | null = null;

  setTaskManager(tm: TaskManager): void {
    this.taskManager = tm;
    logger.info('Local API initialized');
  }

  /**
   * Apply optional setting overrides.
   * Only updates settings explicitly provided - leaves everything else unchanged.
   */
  async applyOverrides(overrides: APISettingsOverrides): Promise<void> {
    if (overrides.general && Object.keys(overrides.general).length > 0) {
      await generalSettingsStore.updateSettings(overrides.general);
    }

    if (overrides.firewall && Object.keys(overrides.firewall).length > 0) {
      await firewallStore.updateFirewall(overrides.firewall);
    }
  }

  /** Get current settings (for inspection) */
  async getSettings(): Promise<{
    general: unknown;
    firewall: unknown;
    providers: Record<string, unknown>;
    agentModels: Record<string, unknown>;
  }> {
    return {
      general: await generalSettingsStore.getSettings(),
      firewall: await firewallStore.getFirewall(),
      providers: await llmProviderStore.getAllProviders(),
      agentModels: await agentModelStore.getAllAgentModels(),
    };
  }

  /** Run a task with the specified config */
  async run(options: APIRunOptions, overrides?: APISettingsOverrides): Promise<APIResult> {
    if (!this.taskManager) throw new Error('Not initialized');

    const startTime = Date.now();
    const taskId = options.taskId || `api-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const { modelName, apiKey, baseUrl, parameters, thinkingLevel } = options.config;
    const provider = normalizeProvider(options.config.provider);
    const workflow = options.workflow || 'auto';

    // 1. Accept disclaimers (required for API mode)
    await warningsSettingsStore.updateWarnings({
      hasAcceptedFirstRun: true,
      disablePerChatWarnings: true,
    });

    // 2. Store provider credentials in ephemeral storage (NOT chrome.storage)
    ephemeralStore.setProvider(provider, {
      apiKey,
      baseUrl,
      modelNames: [modelName],
      type: provider,
      name: provider,
      createdAt: Date.now(),
    });

    // 3. Store model configs in ephemeral storage (NOT chrome.storage)
    const modelConfig = { provider, modelName, parameters: parameters || {}, thinkingLevel };

    // Set models based on workflow - always include navigator as it's required by executor
    ephemeralStore.setAgentModel(AgentNameEnum.AgentNavigator, modelConfig);

    switch (workflow) {
      case 'chat':
        ephemeralStore.setAgentModel(AgentNameEnum.Chat, modelConfig);
        break;
      case 'search':
        ephemeralStore.setAgentModel(AgentNameEnum.Search, { ...modelConfig, webSearch: true });
        break;
      case 'agent':
        // Navigator already set above
        break;
      case 'multiagent':
        ephemeralStore.setAgentModel(AgentNameEnum.MultiagentPlanner, modelConfig);
        ephemeralStore.setAgentModel(AgentNameEnum.MultiagentWorker, modelConfig);
        break;
      case 'auto':
      default:
        // Auto needs triage model + fallback models for routing
        ephemeralStore.setAgentModel(AgentNameEnum.Auto, modelConfig);
        ephemeralStore.setAgentModel(AgentNameEnum.Chat, modelConfig);
        ephemeralStore.setAgentModel(AgentNameEnum.Search, { ...modelConfig, webSearch: true });
        break;
    }

    // 4. Apply optional overrides (only if provided)
    if (overrides) {
      await this.applyOverrides(overrides);
    }

    // 4b. Sync responseTimeoutSeconds with SDK timeout so internal LLM calls don't expire early
    const timeoutMs = this.resolveTimeoutMs(options);
    await generalSettingsStore.updateSettings({
      responseTimeoutSeconds: Math.ceil(timeoutMs / 1000),
    });

    // 5. Execute task and capture response + usage + trace from events
    let capturedResponse = '';
    let finalTaskResult = '';
    let partialActionResult = '';
    let capturedUsage: APIUsage | undefined;
    const capturedTrace: APITraceEntry[] = [];
    let taskFinished = false; // Set true after completionPromise resolves; prevents cancel events from stomping output

    // Expose partial results to globalThis for timeout scenarios (eval harness can read these)
    (globalThis as any).__evalPartialTrace = capturedTrace;
    (globalThis as any).__evalPartialUsage = null;
    (globalThis as any).__evalPartialOutput = '';
    (globalThis as any).__evalTaskId = taskId;
    (globalThis as any).__evalWorkflow = workflow;
    (globalThis as any).__tokenTracker = globalTokenTracker;

    // Completion promise — resolves when a terminal event arrives through the
    // virtual port.  handleNewTask dispatches asynchronously, so without this
    // we'd return before the task actually runs.
    let resolveCompletion!: (terminal: string) => void;
    const completionPromise = new Promise<string>(resolve => {
      resolveCompletion = resolve;
    });

    const virtualPort = this.createVirtualPort((event: any) => {
      // Handle error messages from handleNewTask (e.g. triage failure, missing provider)
      if (event?.type === 'error') {
        logger.info('[API] Error event:', event.error);
        capturedResponse = event.error || 'Unknown error';
        resolveCompletion('task.fail');
        return;
      }

      // Log terminal events for diagnostics
      if (event?.state?.startsWith('task.')) {
        logger.info(
          '[API] Terminal event:',
          event.state,
          'taskId:',
          event?.data?.taskId,
          'summary:',
          !!event?.data?.summary,
          event?.data?.summary,
        );
        // For multiagent workflows, ignore crew subtask terminal events — the
        // proper signals are 'final_answer' and 'workflow_ended' handled above.
        const isCrewEvent = event?.data?.parentSessionId != null;
        const ignoreForMultiagent = workflow === 'multiagent' && isCrewEvent;
        if (event.state === 'task.ok' && !ignoreForMultiagent) {
          finalTaskResult = event?.data?.details || event?.data?.message || '';
          if (finalTaskResult) {
            (globalThis as any).__evalPartialOutput = finalTaskResult;
          }
        }
        if (event.state === 'task.ok' || event.state === 'task.fail' || event.state === 'task.cancel') {
          if (!ignoreForMultiagent) {
            resolveCompletion(event.state);
          }
        }
      }

      // Capture stream chunks to build the response (chat/search workflows)
      if (event?.state === 'step.streaming' && event?.data?.message) {
        capturedResponse += event.data.message;
        (globalThis as any).__evalPartialOutput = capturedResponse;
      }
      // Track partial action results for timeout scenarios (not added to trace)
      if (event?.state === 'act.ok') {
        const details = event?.data?.details || event?.data?.message || '';
        if (details) {
          const shouldReplace =
            !partialActionResult ||
            (partialActionResult.startsWith('Cached findings:') && !details.startsWith('Cached findings:'));
          if (shouldReplace) {
            partialActionResult = details;
            if (!finalTaskResult) {
              (globalThis as any).__evalPartialOutput = details;
            }
          }
        }

        // Update partial usage from token tracker on each action (for timeout scenarios)
        try {
          const usages = (globalTokenTracker as any)?.getTokensForTask?.(taskId) || [];
          if (Array.isArray(usages) && usages.length > 0) {
            const totalInputTokens = usages.reduce((sum: number, u: any) => sum + (u.inputTokens || 0), 0);
            const totalOutputTokens = usages.reduce((sum: number, u: any) => sum + (u.outputTokens || 0), 0);
            let hasAnyCost = false;
            const totalCost =
              usages.reduce((sum: number, u: any) => {
                const c = Number(u.cost);
                if (isFinite(c) && c >= 0) {
                  hasAnyCost = true;
                  return sum + c;
                }
                return sum;
              }, 0) || (hasAnyCost ? 0 : -1);
            const last = usages[usages.length - 1] || {};
            (globalThis as any).__evalPartialUsage = {
              totalInputTokens,
              totalOutputTokens,
              totalLatencyMs: Date.now() - startTime,
              totalCost,
              apiCallCount: usages.length,
              provider: last.provider || '',
              modelName: last.modelName || '',
            };
          }
        } catch (e) {
          // Ignore errors from token tracker query
        }
      }
      // Capture usage data from terminal events
      if (event?.data?.summary) {
        const s = event.data.summary;
        logger.info('[API] Captured usage:', s);
        capturedUsage = {
          totalInputTokens: s.totalInputTokens || 0,
          totalOutputTokens: s.totalOutputTokens || 0,
          totalLatencyMs: s.totalLatencyMs || 0,
          totalCost: s.totalCost >= 0 ? s.totalCost : 0,
          apiCallCount: s.apiCallCount || 0,
          provider: s.provider || '',
          modelName: s.modelName || '',
        };
        (globalThis as any).__evalPartialUsage = capturedUsage;
      }
    });

    try {
      if (workflow === 'multiagent') {
        // Multiagent uses its own orchestrator instead of handleNewTask/Executor
        const providers = await getAllProvidersDecrypted();
        const agentModels = await getAllAgentModelsDecrypted();

        const plannerCfg =
          agentModels[AgentNameEnum.MultiagentPlanner] ||
          agentModels[AgentNameEnum.AgentPlanner] ||
          agentModels[AgentNameEnum.AgentNavigator];
        if (!plannerCfg) throw new Error('Planner model not configured');

        const plannerProvider = providers[plannerCfg.provider];
        if (!plannerProvider) throw new Error(`Provider '${plannerCfg.provider}' not found`);

        const plannerLLM = createChatModel(plannerProvider, plannerCfg);

        const settings = await generalSettingsStore.getSettings();
        const maxWorkers = Math.max(1, Math.min(32, settings?.maxWorkerAgents ?? 3));

        const orchestrator = new MultiAgentWorkflow(this.taskManager!, () => virtualPort, taskId, { maxWorkers });

        // Subscribe the virtual port for event delivery
        this.taskManager!.subscribePortToSession?.(`api:${taskId}`, virtualPort as any, taskId);

        // Listen for multiagent-specific events on the virtual port
        const origHandler = (virtualPort as any).postMessage;
        (virtualPort as any).postMessage = (event: any) => {
          // Map multiagent events to terminal states
          if (event?.type === 'workflow_ended') {
            const ok = event?.data?.ok ?? event?.ok;
            const error = event?.data?.error ?? event?.error;
            if (ok) {
              resolveCompletion('task.ok');
            } else {
              capturedResponse = error || 'Workflow failed';
              resolveCompletion('task.fail');
            }
            return;
          }
          if (event?.type === 'final_answer') {
            if (event?.data?.text) {
              finalTaskResult = event.data.text;
              (globalThis as any).__evalPartialOutput = finalTaskResult;
            }
          }
          // Capture multiagent orchestration events into trace (skip generic 'multiagent' status duplicates)
          // Use a sequence counter to preserve ordering when timestamps are identical
          if (event?.type === 'workflow_progress' && event?.data?.message && event?.data?.actor !== 'multiagent') {
            let actor = event.data.actor;
            if (actor === 'planner') actor = 'commodore';
            capturedTrace.push({
              action: 'workflow_progress',
              status: 'ok',
              details: event.data.message,
              timestamp: Date.now(),
              actor,
              workerId: event.data.workerId,
            });
          }
          if (event?.type === 'workflow_plan_dataset' && event?.data?.dataset) {
            capturedTrace.push({
              action: 'workflow_plan',
              status: 'ok',
              details: JSON.stringify(event.data.dataset),
              timestamp: Date.now() + 1, // ensure after the "Plan created" progress message
              actor: 'commodore',
            });
          }
          if (event?.type === 'workflow_quartermaster_log' && event?.data?.log) {
            capturedTrace.push({
              action: 'workflow_schedule',
              status: 'ok',
              details: JSON.stringify(event.data.log),
              timestamp: Date.now() + 2, // ensure after plan dataset
              actor: 'quartermaster',
            });
          }
          // For multiagent, only delegate error events to the generic handler.
          // Do NOT delegate task.* or act.ok events — the generic handler would
          // overwrite finalTaskResult with crew subtask data, clobbering the
          // actual answer captured from 'final_answer' above.
          if (event?.type === 'error') {
            if (typeof origHandler === 'function') origHandler(event);
          }
          // Capture partial output from crew actions for timeout/empty-answer fallback.
          // Don't overwrite after task finished (cancel events from cleanup would stomp output).
          // Also filter out noise strings that are system messages, not research output.
          if (!taskFinished) {
            const details = event?.data?.details || event?.data?.message || '';
            const isNoise = !details || /^(Task cancelled|Task completed|Navigating|Action:)/i.test(details);
            if (event?.state === 'act.ok' && !isNoise && !finalTaskResult) {
              partialActionResult = details;
              (globalThis as any).__evalPartialOutput = details;
            }
          }
          // Capture usage summary from terminal events
          if (event?.data?.summary) {
            const s = event.data.summary;
            capturedUsage = {
              totalInputTokens: s.totalInputTokens || 0,
              totalOutputTokens: s.totalOutputTokens || 0,
              totalLatencyMs: s.totalLatencyMs || 0,
              totalCost: s.totalCost >= 0 ? s.totalCost : 0,
              apiCallCount: s.apiCallCount || 0,
              provider: s.provider || '',
              modelName: s.modelName || '',
            };
            (globalThis as any).__evalPartialUsage = capturedUsage;
          }
        };

        (async () => {
          try {
            await orchestrator.start(options.task, plannerLLM);
          } catch (e: any) {
            capturedResponse = e?.message || 'Workflow failed';
            resolveCompletion('task.fail');
          }
        })();
      } else {
        let currentExecutor: any = null;
        await handleNewTask(
          { type: 'new_task', task: options.task, taskId, tabId: undefined, agentType: workflow },
          {
            taskManager: this.taskManager,
            logger,
            getCurrentPort: () => virtualPort,
            getCurrentExecutor: () => currentExecutor,
            setCurrentExecutor: (e: any) => {
              currentExecutor = e;
              if (e) {
                subscribeToExecutorEvents(e, () => virtualPort, this.taskManager, {
                  warning: (...args: any[]) => logger.info('[API-SW]', ...args),
                  debug: (...args: any[]) => logger.debug('[API-SW]', ...args),
                });
              }
            },
          },
        );
      }

      // handleNewTask dispatches asynchronously — wait for a terminal event
      const terminalState = await Promise.race([
        completionPromise,
        new Promise<string>(resolve => setTimeout(() => resolve('timeout'), timeoutMs)),
      ]);
      logger.info('[API] Task finished with terminal state:', terminalState);
      taskFinished = true;

      // For multiagent, if no proper answer was captured, collect the latest
      // memory from each crew worker as a meaningful fallback.
      let crewMemoryFallback: string | undefined;
      if (workflow === 'multiagent' && !finalTaskResult) {
        try {
          const allTokens = (globalTokenTracker as any)?.getTokensForTask?.(taskId) || [];
          // Group by workerIndex, keep the latest memory per worker
          const latestByWorker = new Map<number, string>();
          for (const t of allTokens) {
            const resp = t?.response;
            if (!resp) continue;
            const parsed = typeof resp === 'string' ? JSON.parse(resp) : resp;
            const mem = parsed?.current_state?.memory;
            if (mem && typeof mem === 'string' && mem.length > 30) {
              const wIdx = t.workerIndex ?? 0;
              latestByWorker.set(wIdx, mem);
            }
          }
          if (latestByWorker.size > 0) {
            const parts = [...latestByWorker.values()];
            crewMemoryFallback = parts.join('\n\n').slice(0, 4000);
          }
        } catch {}
      }
      const result = finalTaskResult || crewMemoryFallback || capturedResponse || partialActionResult || undefined;
      if (result) {
        (globalThis as any).__evalPartialOutput = result;
      }

      // Fallback: if no usage was captured via events, read directly from globalTokenTracker
      if (!capturedUsage) {
        try {
          const tokens = (globalTokenTracker as any)?.getTokensForTask?.(taskId) || [];
          if (tokens.length > 0) {
            const totalInputTokens = tokens.reduce((s: number, t: any) => s + (t.inputTokens || 0), 0);
            const totalOutputTokens = tokens.reduce((s: number, t: any) => s + (t.outputTokens || 0), 0);
            let totalCost = 0;
            for (const t of tokens) {
              const c = Number(t.cost);
              if (isFinite(c) && c >= 0) totalCost += c;
            }
            capturedUsage = {
              totalInputTokens,
              totalOutputTokens,
              totalLatencyMs: Date.now() - startTime,
              totalCost,
              apiCallCount: tokens.length,
              provider: tokens[tokens.length - 1]?.provider || '',
              modelName: tokens[tokens.length - 1]?.modelName || '',
            };
          }
        } catch {}
      }

      const elapsedMs = Date.now() - startTime;
      if (capturedUsage) {
        capturedUsage.totalLatencyMs = capturedUsage.totalLatencyMs || elapsedMs;
      }

      // Append LLM response records for each role
      try {
        const allTokens = (globalTokenTracker as any)?.getTokensForTask?.(taskId) || [];
        for (const t of allTokens) {
          // Normalize role: navigator → crew (the multiagent role name)
          let role = (t.role || 'unknown').toLowerCase().replace(/-/g, '_');
          if (role === 'navigator') role = 'crew';
          // Only include the response, stripping duplicated fields
          let response = t.response;
          if (response && typeof response === 'object') {
            const { response: _dup, done: _done, search_queries: _sq, ...clean } = response;
            response = clean;
          }
          capturedTrace.push({
            action: role,
            status: 'ok',
            details: typeof response === 'string' ? response : JSON.stringify(response),
            timestamp: t.timestamp || 0,
            actor: role,
            workerId: t.workerIndex,
            taskId: t.taskId,
          });
        }
        // Sort entire trace by timestamp so all entries are interleaved chronologically
        capturedTrace.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      } catch {}

      if (terminalState === 'timeout') {
        // Kill the still-running workflow before returning so tabs don't accumulate
        try {
          await this.taskManager!.cancelAllForParentSession(taskId);
          logger.info('[API] Cancelled timed-out task', taskId);
        } catch (e) {
          logger.error('[API] Failed to cancel timed-out task:', e);
        }
        await this.closeTaskTabs(taskId);
        return {
          taskId,
          status: 'timeout',
          error: `Task did not complete within ${timeoutMs / 1000}s`,
          result,
          usage: capturedUsage,
          trace: capturedTrace.length > 0 ? capturedTrace : undefined,
        };
      }

      const finalStatus =
        terminalState === 'task.fail' ? 'error' : terminalState === 'task.cancel' ? 'cancelled' : 'completed';

      await this.closeTaskTabs(taskId);
      return {
        taskId,
        status: finalStatus as APIResult['status'],
        result,
        usage: capturedUsage,
        trace: capturedTrace.length > 0 ? capturedTrace : undefined,
      };
    } catch (e: any) {
      logger.error('Task execution failed:', e);
      const elapsedMs = Date.now() - startTime;
      if (capturedUsage) {
        capturedUsage.totalLatencyMs = capturedUsage.totalLatencyMs || elapsedMs;
      }
      await this.closeTaskTabs(taskId);
      return {
        taskId,
        status: 'error',
        error: e?.message || 'Task failed',
        usage: capturedUsage,
        trace: capturedTrace.length > 0 ? capturedTrace : undefined,
      };
    }
  }

  /** Get task status (result is only available from run() return value) */
  async getStatus(taskId: string): Promise<APIResult> {
    if (!this.taskManager) throw new Error('Not initialized');
    const task = this.taskManager.getTask(taskId);
    if (!task) return { taskId, status: 'error', error: 'Not found' };

    // Map 'pending' to 'running' for API consumers
    const status = task.status === 'pending' ? 'running' : task.status;

    return { taskId: task.id, status: status as APIResult['status'], error: task.error };
  }

  /** Cancel a task */
  async cancel(taskId: string): Promise<void> {
    if (!this.taskManager) throw new Error('Not initialized');
    await this.taskManager.cancelTask(taskId);
  }

  /** Wait for task completion */
  async waitForCompletion(taskId: string, timeoutMs = 300000): Promise<APIResult> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getStatus(taskId);
      if (['completed', 'error', 'cancelled', 'timeout'].includes(status.status)) return status;
      await new Promise(r => setTimeout(r, 1000));
    }
    return { taskId, status: 'timeout', error: 'Timeout' };
  }

  /** Close all tabs opened by a task (including subtask/crew tabs). */
  private async closeTaskTabs(taskId: string): Promise<void> {
    if (!this.taskManager) return;
    try {
      // Close the primary task's tab group
      await this.taskManager.closeTaskGroup(taskId);
      // Close tabs from any child tasks (multiagent crew workers)
      const allTasks = this.taskManager.getAllTasks();
      for (const t of allTasks) {
        if (String((t as any).parentSessionId || '') === String(taskId)) {
          await this.taskManager.closeTaskGroup(t.id);
        }
      }
    } catch (e) {
      logger.error('[API] Failed to close task tabs:', e);
    }
  }

  private resolveTimeoutMs(options: APIRunOptions): number {
    if (typeof options.timeoutMs === 'number' && isFinite(options.timeoutMs) && options.timeoutMs > 0) {
      return options.timeoutMs;
    }
    // Backward compatibility for callers that still send timeout in seconds.
    if (typeof options.timeout === 'number' && isFinite(options.timeout) && options.timeout > 0) {
      return Math.round(options.timeout * 1000);
    }
    return 300_000;
  }

  private createVirtualPort(onMessage?: (event: any) => void): chrome.runtime.Port {
    return {
      name: 'api-port',
      postMessage: onMessage || (() => {}),
      disconnect: () => {},
      onMessage: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
      onDisconnect: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
    } as unknown as chrome.runtime.Port;
  }
}

export const localAPI = new LocalAPI();
