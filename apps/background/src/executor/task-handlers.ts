import BrowserContext from '../browser/context';
import { setupExecutor } from './setup-executor';
import { subscribeToExecutorEvents } from '../workflows/shared/subscribe-to-executor-events';
import { decideUseCurrentTab } from '@src/workflows/specialized/triage-tab-choice';
import { estimationService } from '../workflows/specialized/estimator/service';
import { Actors, ExecutionState } from '../workflows/shared/event/types';
import { generalSettingsStore, agentModelStore, AgentNameEnum } from '@extension/storage';
import { globalTokenTracker } from '../utils/token-tracker';
// Triage resolution happens via Auto; no direct provider/model imports needed here

type Deps = {
  taskManager: any;
  logger: any;
  currentPort: chrome.runtime.Port | null;
  getCurrentExecutor: () => any | null;
  setCurrentExecutor: (e: any | null) => void;
};

// Map for pending estimation approvals
const estimationApprovals = new Map<string, Promise<boolean>>();
const estimationResolvers = new Map<string, (approved: boolean) => void>();
// Store recalculated estimation when user approves with a different model
const estimationDataForApproval = new Map<string, any>();

/**
 * Run workflow estimation flow if enabled.
 * Returns true if task should proceed, false if cancelled.
 */
async function runEstimationIfEnabled(
  task: string,
  sessionId: string,
  port: chrome.runtime.Port | null,
  logger: any,
): Promise<boolean> {
  const settings = await generalSettingsStore.getSettings();
  if (!settings.enableWorkflowEstimation) return true;

  logger.info('[Estimation] Starting workflow estimation...');

  // Emit estimation start event
  try {
    port?.postMessage({
      type: 'execution',
      actor: Actors.ESTIMATOR,
      state: ExecutionState.STEP_START,
      data: { taskId: sessionId, step: 0, maxSteps: 0, details: 'Estimating workflow cost and time...' },
      timestamp: Date.now(),
    });
  } catch {}

  // Set up approval promise with timeout
  const approvalPromise = new Promise<boolean>(resolve => {
    estimationResolvers.set(sessionId, resolve);
    setTimeout(
      () => {
        if (estimationResolvers.has(sessionId)) {
          estimationResolvers.delete(sessionId);
          estimationApprovals.delete(sessionId);
          resolve(false);
          logger.info('[Estimation] Approval timeout');
        }
      },
      5 * 60 * 1000,
    );
  });
  estimationApprovals.set(sessionId, approvalPromise);

  // Run estimation
  await estimationService.initialize();
  let navigatorModelName: string | undefined;
  try {
    const agentModels = await agentModelStore.getAllAgentModels();
    navigatorModelName = agentModels[AgentNameEnum.Navigator]?.modelName;
  } catch {}

  const estimation = await estimationService.estimateTask(task, navigatorModelName, sessionId);

  // Check if cancelled during estimation
  if (!estimationResolvers.has(sessionId)) {
    logger.info('[Estimation] Cancelled during estimation');
    estimationApprovals.delete(sessionId);
    try {
      port?.postMessage({
        type: 'execution',
        actor: Actors.ESTIMATOR,
        state: ExecutionState.ESTIMATION_CANCELLED,
        data: { taskId: sessionId, step: 0, maxSteps: 0, details: 'Workflow cancelled by user' },
        timestamp: Date.now(),
      });
    } catch {}
    return false;
  }

  logger.info(
    `[Estimation] Complete: ${estimation.steps.length} steps, ~${Math.round(estimation.summary.total_agent_duration_s)}s`,
  );

  // Emit result
  try {
    port?.postMessage({
      type: 'execution',
      actor: Actors.ESTIMATOR,
      state: ExecutionState.ESTIMATION_PENDING,
      data: {
        taskId: sessionId,
        step: 0,
        maxSteps: 0,
        details: 'Workflow estimation ready',
        message: JSON.stringify(estimation),
      },
      timestamp: Date.now(),
    });
  } catch {}

  const approved = await approvalPromise;
  estimationApprovals.delete(sessionId);
  estimationResolvers.delete(sessionId);

  if (!approved) {
    logger.info('[Estimation] Cancelled by user');
    try {
      port?.postMessage({
        type: 'execution',
        actor: Actors.ESTIMATOR,
        state: ExecutionState.ESTIMATION_CANCELLED,
        data: { taskId: sessionId, step: 0, maxSteps: 0, details: 'Workflow cancelled by user' },
        timestamp: Date.now(),
      });
    } catch {}
    return false;
  }

  logger.info('[Estimation] Approved');
  try {
    const approvedEstimation = estimationDataForApproval.get(sessionId);
    estimationDataForApproval.delete(sessionId);
    port?.postMessage({
      type: 'execution',
      actor: Actors.ESTIMATOR,
      state: ExecutionState.ESTIMATION_APPROVED,
      data: { taskId: sessionId, step: 0, maxSteps: 0, details: '', estimation: approvedEstimation },
      timestamp: Date.now(),
    });
  } catch {}

  return true;
}

export async function handleNewTask(message: any, deps: Deps) {
  const { taskManager, currentPort, setCurrentExecutor } = deps;
  const task: string = String(message.task || '').trim();
  const sessionId: string = String(message.taskId || '');
  const agentType: string | undefined = message.agentType ? String(message.agentType) : undefined;
  let tabId: number = typeof message.tabId === 'number' ? message.tabId : -1;
  // Extract context tab IDs from the message
  const contextTabIds: number[] = Array.isArray(message.contextTabIds)
    ? message.contextTabIds.filter((id: any) => typeof id === 'number' && id > 0)
    : [];
  if (!task || !sessionId) {
    return currentPort?.postMessage({ type: 'error', error: 'Missing task or taskId' });
  }

  // If agentType is 'auto', triage first and then map to manual agent type
  let effectiveAgentType: string | undefined = agentType;
  try {
    const at = String(agentType || '').toLowerCase();
    if (at === 'auto') {
      // Emit triage start event to UI
      try {
        currentPort?.postMessage({
          type: 'execution',
          actor: 'auto',
          state: 'step.start',
          data: {
            taskId: sessionId,
            step: 0,
            maxSteps: 100,
            details: 'Analyzing request...',
          },
          timestamp: Date.now(),
        });
      } catch {}

      const { AutoWorkflow } = await import('@src/workflows/auto');
      const svc = new (AutoWorkflow as any)();
      try {
        await (svc as any).initialize?.();
      } catch {}

      // Set taskId/role BEFORE calling triage so API calls are logged under this session
      const prevTaskId = globalTokenTracker.getCurrentTaskId();
      const prevRole = globalTokenTracker.getCurrentRole();
      try {
        globalTokenTracker.setCurrentTaskId(sessionId);
        globalTokenTracker.setCurrentRole('auto');

        const triageResult = await (svc as any).triageRequest?.(task, sessionId, contextTabIds);
        const action = String(triageResult?.action || '').toLowerCase();
        if (action === 'chat') effectiveAgentType = 'chat';
        else if (action === 'search') effectiveAgentType = 'search';
        else effectiveAgentType = 'agent';

        // Emit triage completion event to UI
        try {
          currentPort?.postMessage({
            type: 'execution',
            actor: 'auto',
            state: 'step.ok',
            data: {
              taskId: sessionId,
              step: 0,
              maxSteps: 100,
              details: `Request categorized as: ${action}`,
            },
            timestamp: Date.now(),
          });
        } catch {}
      } catch {
        effectiveAgentType = 'agent';
      } finally {
        globalTokenTracker.setCurrentTaskId(prevTaskId);
        globalTokenTracker.setCurrentRole(prevRole);
      }
    }
  } catch {}

  // Determine mode using effective agent type
  const agentTypeNorm = String(effectiveAgentType || '').toLowerCase();
  const isWebAgent = agentTypeNorm === 'agent';

  // Ensure TaskManager knows about the session (but do not queue)
  const taskName = isWebAgent ? 'Web Agent' : undefined;
  try {
    await taskManager.createTask(task, taskName, true, sessionId, sessionId);
  } catch {}

  // Workflow estimation (only for web agent tasks)
  if (isWebAgent) {
    try {
      const shouldProceed = await runEstimationIfEnabled(task, sessionId, currentPort, deps.logger);
      if (!shouldProceed) return;
    } catch (error) {
      deps.logger.error('[Estimation] Failed:', error);
      try {
        currentPort?.postMessage({
          type: 'execution',
          actor: Actors.ESTIMATOR,
          state: ExecutionState.STEP_FAIL,
          data: {
            taskId: sessionId,
            step: 0,
            maxSteps: 0,
            details: `Estimation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
          timestamp: Date.now(),
        });
      } catch {}
    }
  }

  const browserContext = new BrowserContext({ forceNewTab: true });

  // Register context tabs with the browser context and create visual indicator
  const hasContextTabs = contextTabIds.length > 0;
  if (hasContextTabs) {
    browserContext.setContextTabs(contextTabIds);
    deps.logger.info(`[handleNewTask] Set ${contextTabIds.length} context tabs for session ${sessionId}`);

    // Create a tab group for context tabs immediately with appropriate styling
    try {
      const groupId = await chrome.tabs.group({ tabIds: contextTabIds });
      // For Agent workflows: blue "Web Agent" group; for Chat/Search: grey "Reference" group
      const groupTitle = isWebAgent ? 'Web Agent' : 'Reference';
      const groupColor = isWebAgent ? 'blue' : 'grey';
      await chrome.tabGroups.update(groupId, { title: groupTitle, color: groupColor });
      if (isWebAgent) {
        // Set preferred group directly (don't call setPreferredGroupId to avoid redundant move)
        (browserContext as any)._preferredGroupId = groupId;
      }
      deps.logger.info(
        `[handleNewTask] Created tab group ${groupId} (${groupTitle}) for ${contextTabIds.length} context tabs`,
      );
    } catch (e) {
      deps.logger.error('[handleNewTask] Failed to create tab group for context tabs:', e);
    }
  }

  // For Agent path without context tabs, optionally override tabId based on lightweight triage
  // Skip this when context tabs are provided since we already set the current tab
  const hasAgentContextTabs = isWebAgent && hasContextTabs;
  if (isWebAgent && !hasAgentContextTabs) {
    try {
      const useCurrent = await decideUseCurrentTab(task);
      if (!useCurrent) {
        // Signal to not mirror current tab; rely on TAB_CREATED after first navigation
        tabId = 0;
      } else if (tabId > 0) {
        // Bind the worker context to the current tab so getCurrentPage() can attach immediately
        try {
          browserContext.updateCurrentTabId(tabId);
        } catch {}
      }
    } catch {}
  }

  const executor = await setupExecutor(sessionId, task, browserContext, effectiveAgentType, contextTabIds);

  setCurrentExecutor(executor);

  // Bind to TaskManager for mirroring/grouping ONLY for single_agent
  // For chat/search/triage, register without tab control to avoid grouping/preview
  // When context tabs are provided, use the first context tab for mirroring (agent starts there)
  try {
    if (isWebAgent) {
      const tabIdForManager = hasContextTabs ? contextTabIds[0] : tabId > 0 ? tabId : 0;
      taskManager.setSingleAgentExecutor(sessionId, executor, tabIdForManager);
    } else {
      taskManager.setSingleAgentExecutor(sessionId, executor, -1);
    }
  } catch {}

  // Forward events to side panel; clear executor reference on completion
  try {
    await subscribeToExecutorEvents(executor, currentPort, taskManager, deps.logger, () => setCurrentExecutor(null));
  } catch {}

  // Execute
  try {
    await executor.execute();
  } catch (e: any) {
    try {
      currentPort?.postMessage({ type: 'error', error: e?.message || 'Task failed' });
    } catch {}
  }
}

export async function handleFollowUpTask(message: any, deps: Deps) {
  const { currentPort, getCurrentExecutor, setCurrentExecutor, taskManager, logger } = deps;
  const task: string = String(message.task || '').trim();
  const sessionId: string = String(message.taskId || '');
  let agentType: string | undefined = message.agentType ? String(message.agentType) : undefined;
  // Extract context tab IDs from the message
  const contextTabIds: number[] = Array.isArray(message.contextTabIds)
    ? message.contextTabIds.filter((id: any) => typeof id === 'number' && id > 0)
    : [];
  if (!task || !sessionId) {
    return currentPort?.postMessage({ type: 'error', error: 'Missing task or taskId' });
  }

  // If follow-up is 'auto', triage first to determine agent type
  try {
    const at = String(agentType || '').toLowerCase();
    if (at === 'auto') {
      // Emit triage start event to UI
      try {
        currentPort?.postMessage({
          type: 'execution',
          actor: 'auto',
          state: 'step.start',
          data: {
            taskId: sessionId,
            step: 0,
            maxSteps: 100,
            details: 'Analyzing request...',
          },
          timestamp: Date.now(),
        });
      } catch {}

      const { AutoWorkflow } = await import('@src/workflows/auto');
      const svc = new (AutoWorkflow as any)();
      try {
        await (svc as any).initialize?.();
      } catch {}

      // Set taskId/role BEFORE calling triage so API calls are logged under this session
      const prevTaskId = globalTokenTracker.getCurrentTaskId();
      const prevRole = globalTokenTracker.getCurrentRole();
      try {
        globalTokenTracker.setCurrentTaskId(sessionId);
        globalTokenTracker.setCurrentRole('auto');

        const triageResult = await (svc as any).triageRequest?.(task, sessionId, contextTabIds);
        const action = String(triageResult?.action || '').toLowerCase();
        if (action === 'chat') {
          agentType = 'chat';
        } else if (action === 'search') {
          agentType = 'search';
        } else if (action === 'agent') {
          agentType = 'agent';
        }

        // Emit triage completion event to UI
        try {
          currentPort?.postMessage({
            type: 'execution',
            actor: 'auto',
            state: 'step.ok',
            data: {
              taskId: sessionId,
              step: 0,
              maxSteps: 100,
              details: `Request categorized as: ${action}`,
            },
            timestamp: Date.now(),
          });
        } catch {}
      } catch {
        // Keep original agentType on error
      } finally {
        globalTokenTracker.setCurrentTaskId(prevTaskId);
        globalTokenTracker.setCurrentRole(prevRole);
      }
    }
  } catch {}

  const existing = getCurrentExecutor();

  // CRITICAL FIX: Check if existing executor belongs to a DIFFERENT session
  // This happens when user loads a different chat history and sends a follow-up.
  // The executor's taskId won't match the new session, causing events to be filtered out.
  // In this case, we must create a new executor for the correct session.
  const existingTaskId = existing?.getTaskId?.() || (existing as any)?.context?.taskId;
  if (existing && existingTaskId && String(existingTaskId) !== String(sessionId)) {
    logger.info(
      `[handleFollowUpTask] Executor belongs to different session (${existingTaskId} vs ${sessionId}), creating new executor`,
    );
    return handleNewTask(message, deps);
  }

  // Check if we should use existing browser-use executor for follow-up
  // Use the executor if: 1) executor exists, 2) new request is single_agent, 3) executor HAS EVER run browser-use
  // This preserves browser context even if user temporarily switched to chat/search
  const hasRunBrowserUse = existing ? (existing as any).getHasRunBrowserUse?.() : false;

  if (existing && agentType === 'agent' && hasRunBrowserUse) {
    // Browser-use follow-up: reuse existing browser context (preserves tabs and task history)
    logger.info('[handleFollowUpTask] Reusing existing executor for browser-use');

    // Register any new context tabs with the browser context and add to existing group
    if (contextTabIds.length > 0) {
      const browserContext = existing.getBrowserContext?.() || (existing as any).context?.browserContext;
      if (browserContext) {
        browserContext.setContextTabs(contextTabIds);
        logger.info(`[handleFollowUpTask] Set ${contextTabIds.length} context tabs for follow-up`);

        // Also update executor context for prompt injection
        existing.setContextTabIds?.(contextTabIds);

        // Add context tabs to the existing group if one exists
        try {
          const existingTask = (taskManager as any).getTask?.(sessionId);
          if (existingTask?.groupId) {
            await chrome.tabs.group({ tabIds: contextTabIds, groupId: existingTask.groupId });
            logger.info(
              `[handleFollowUpTask] Added ${contextTabIds.length} context tabs to existing group ${existingTask.groupId}`,
            );
          } else {
            // No existing group, create one
            const groupId = await chrome.tabs.group({ tabIds: contextTabIds });
            await chrome.tabGroups.update(groupId, { title: 'Web Agent', color: 'blue' });
            // Set preferred group directly to avoid redundant moveContextTabsToGroup call
            (browserContext as any)._preferredGroupId = groupId;
            logger.info(`[handleFollowUpTask] Created new tab group ${groupId} for context tabs`);
          }
        } catch (e) {
          logger.error('[handleFollowUpTask] Failed to group context tabs:', e);
        }
      }
    }

    // Run estimation for follow-up agent tasks if enabled
    try {
      const shouldProceed = await runEstimationIfEnabled(task, sessionId, currentPort, logger);
      if (!shouldProceed) return;
    } catch (error) {
      logger.error('[Estimation] Failed for follow-up:', error);
      try {
        currentPort?.postMessage({
          type: 'execution',
          actor: Actors.ESTIMATOR,
          state: ExecutionState.STEP_FAIL,
          data: {
            taskId: sessionId,
            step: 0,
            maxSteps: 0,
            details: `Estimation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
          timestamp: Date.now(),
        });
      } catch {}
    }

    // Re-enable mirroring for agent workflow
    try {
      const task = (taskManager as any).getTask?.(sessionId);
      if (task) {
        (task as any).workflowType = 'agent';
        delete (task as any).mirroringDisabled;
        (task as any).mirroringStarted = false;

        // Get current tab from executor's browser context (more reliable than task.tabId)
        const browserContext = existing.getBrowserContext?.() || (existing as any).context?.browserContext;
        const currentTabId = (browserContext as any)?._currentTabId || task.tabId;

        // Restart mirroring on the current tab
        if (currentTabId && currentTabId > 0) {
          const captureTabId = currentTabId;
          (taskManager as any).tabMirrorService?.registerScreenshotProvider?.(captureTabId, async () => {
            try {
              const data =
                (await existing.captureTabScreenshot?.(captureTabId)) ||
                (await existing.captureCurrentPageScreenshot?.());
              return data ? `data:image/jpeg;base64,${data}` : undefined;
            } catch {
              return undefined;
            }
          });
          (taskManager as any).tabMirrorService?.startMirroring?.(
            captureTabId,
            task.id,
            task.color,
            task.parentSessionId || task.id,
            task.workerIndex,
          );
          task.mirroringStarted = true;
          task.tabId = captureTabId;
        }
      }
    } catch {}

    try {
      await existing.addBrowserUseFollowUpTask(task);
    } catch {}

    // Reset executor state from previous cancellation
    try {
      const ctx = (existing as any).context;
      if (ctx) {
        ctx.stopped = false;
        ctx.paused = false;
      }
    } catch {}

    // Re-subscribe execution events after prior cancel may have cleared them
    try {
      (existing as any).clearExecutionEvents?.();
    } catch {}
    delete (existing as any).__backgroundSubscribed;
    try {
      await subscribeToExecutorEvents(existing, currentPort, taskManager, logger, () => setCurrentExecutor(null));
    } catch {}

    // Re-bind executor to TaskManager so TAB_CREATED triggers mirroring for new tabs
    try {
      (taskManager as any).setSingleAgentExecutor?.(sessionId, existing, -1);
    } catch {}

    // CRITICAL FIX: Reactivate task in TaskManager so STOP button works on follow-ups
    try {
      taskManager.reactivateTask(sessionId);
    } catch {}
    try {
      await existing.execute();
    } catch (e: any) {
      try {
        currentPort?.postMessage({ type: 'error', error: e?.message || 'Follow-up failed' });
      } catch {}
    }
    return;
  }

  // Handle chat/search with existing executor
  if (existing && agentType !== 'agent') {
    // CRITICAL: Stop tab mirroring completely when switching from agent to chat/search
    // Mirroring should ONLY happen for browser-use workflows
    try {
      logger.info(`[handleFollowUpTask] Switching to ${agentType}, stopping all mirroring for session ${sessionId}`);
      // Freeze to prevent any new updates
      (taskManager as any).tabMirrorService?.freezeMirrorsForSession?.(sessionId);
      // Also stop any active mirroring for this session
      const task = (taskManager as any).getTask?.(sessionId);
      if (task?.tabId) {
        (taskManager as any).tabMirrorService?.stopMirroring?.(task.tabId);
      }
      // Mark the task as chat/search type to prevent mirroring restart
      if (task) {
        (task as any).workflowType = agentType; // Store workflow type
        (task as any).mirroringDisabled = true; // Explicitly disable mirroring
      }
    } catch (e) {
      logger.warn('[handleFollowUpTask] Failed to stop mirroring:', e);
    }

    try {
      existing.addFollowUpTask(task, agentType);
    } catch {}

    // CRITICAL: Reset executor state from previous cancellation
    try {
      const ctx = (existing as any).context;
      if (ctx) {
        ctx.stopped = false;
        ctx.paused = false;
        logger.info('[handleFollowUpTask] Reset executor stopped/paused state for chat/search');
      }
    } catch (e) {
      logger.info('[handleFollowUpTask] Failed to reset executor state:', e);
    }

    // Ensure execution events are subscribed after a prior cancel may have cleared them
    try {
      (existing as any).clearExecutionEvents?.();
    } catch {}
    delete (existing as any).__backgroundSubscribed;
    try {
      await subscribeToExecutorEvents(existing, currentPort, taskManager, logger, () => setCurrentExecutor(null));
    } catch {}
    // Restore reactivateTask - needed for stop button to work!
    // But mirroring is already stopped and marked disabled above
    try {
      taskManager.reactivateTask(sessionId);
    } catch {}
    try {
      await existing.execute();
    } catch (e: any) {
      try {
        currentPort?.postMessage({ type: 'error', error: e?.message || 'Follow-up failed' });
      } catch {}
    }
    return;
  }

  // Fallback: First browser-use in session OR switching agent types - create new executor
  return handleNewTask(message, deps);
}

/**
 * Approve a pending estimation
 * Called from the port message handler when user clicks "Start Task"
 * @param sessionId - The session ID
 * @param estimation - Optional recalculated estimation from the frontend (with latency adjustments)
 */
export function approveEstimation(sessionId: string, estimation?: any): void {
  const resolver = estimationResolvers.get(sessionId);
  if (resolver) {
    // Store estimation for retrieval when sending ESTIMATION_APPROVED event
    if (estimation) {
      estimationDataForApproval.set(sessionId, estimation);
    }
    resolver(true);
  }
}

/**
 * Cancel a pending estimation
 * Called from the port message handler when user clicks "Cancel" or "Stop"
 */
export function cancelEstimation(sessionId: string): void {
  const resolver = estimationResolvers.get(sessionId);
  if (resolver) {
    // Delete the resolver first so the check after estimation completes will catch it
    estimationResolvers.delete(sessionId);
    estimationApprovals.delete(sessionId);
    // Then resolve to false
    resolver(false);
  }
}
