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

const logger = createLogger('LocalAPI');

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
    const { provider, modelName, apiKey, baseUrl, parameters, thinkingLevel } = options.config;
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

    // 5. Execute task and capture response + usage + trace from events
    let capturedResponse = '';
    let lastActionResult = ''; // For agent workflows, capture last successful action
    let capturedUsage: APIUsage | undefined;
    const capturedTrace: APITraceEntry[] = [];

    // Expose partial results to globalThis for timeout scenarios (eval harness can read these)
    (globalThis as any).__evalPartialTrace = capturedTrace;
    (globalThis as any).__evalPartialUsage = null;
    (globalThis as any).__evalPartialOutput = '';

    const virtualPort = this.createVirtualPort((event: any) => {
      // Debug: log all terminal events to see what we're receiving
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
      }

      // Capture stream chunks to build the response (chat/search workflows)
      if (event?.state === 'step.streaming' && event?.data?.message) {
        capturedResponse += event.data.message;
        (globalThis as any).__evalPartialOutput = capturedResponse;
      }
      // Capture action events for trajectory (agent workflows)
      if (event?.state?.startsWith('act.')) {
        const status = event.state === 'act.start' ? 'start' : event.state === 'act.ok' ? 'ok' : 'fail';
        const details = event?.data?.details || event?.data?.message || '';
        capturedTrace.push({
          action: event?.data?.action || details,
          status,
          details,
          timestamp: event?.timestamp || Date.now(),
        });
        // For agent workflows, prioritize "Cached findings" as the result (contains the actual output)
        if (status === 'ok' && details) {
          if (details.startsWith('Cached findings:')) {
            // This is the meaningful output from cache actions
            lastActionResult = details;
            (globalThis as any).__evalPartialOutput = details;
          } else if (!lastActionResult || !lastActionResult.startsWith('Cached findings:')) {
            // Only update if we don't have a cached finding yet
            lastActionResult = details;
            (globalThis as any).__evalPartialOutput = details;
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
          totalCost: s.totalCost || 0,
          apiCallCount: s.apiCallCount || 0,
          provider: s.provider || '',
          modelName: s.modelName || '',
        };
        (globalThis as any).__evalPartialUsage = capturedUsage;
      }
    });

    try {
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
            // Subscribe to executor events so we capture actions, usage, and trace
            if (e) {
              subscribeToExecutorEvents(e, () => virtualPort, this.taskManager, {
                warning: (...args: any[]) => logger.info('[API-SW]', ...args),
                debug: (...args: any[]) => logger.debug('[API-SW]', ...args),
              });
            }
          },
        },
      );

      // Use stream response for chat/search, or last action result for agent workflows
      const result = capturedResponse || lastActionResult || undefined;

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

      return {
        taskId,
        status: 'completed',
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
      if (['completed', 'error', 'cancelled'].includes(status.status)) return status;
      await new Promise(r => setTimeout(r, 1000));
    }
    return { taskId, status: 'error', error: 'Timeout' };
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
