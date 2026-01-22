/**
 * Killswitch Module - Emergency stop for all extension activity
 *
 * This module provides a global kill mechanism that terminates:
 * - All running workflows (multi-agent orchestrators)
 * - All running tasks (single-agent executors)
 * - All pending tasks in queue
 * - All active tab mirroring
 * - Current executor
 */

import { safePostMessage } from '@extension/shared/lib/utils';
import type { MultiAgentWorkflow } from '../workflows/multiagent/multiagent-workflow';

export interface KillswitchDeps {
  port: chrome.runtime.Port;
  logger: { info: Function; error: Function };
  taskManager: any;
  workflowsBySession: Map<string, MultiAgentWorkflow>;
  runningWorkflowSessionIds: Set<string>;
  getCurrentExecutor: () => any | null;
  setCurrentExecutor: (e: any | null) => void;
  setCurrentWorkflow: (wf: any | null) => void;
  eventBuffer?: any[];
  agentManagerPort?: chrome.runtime.Port | null;
}

export interface KillswitchResult {
  success: boolean;
  killedWorkflows: number;
  killedTasks: number;
  killedMirrors: number;
  error?: string;
}

/**
 * Execute the killswitch - terminates ALL extension activity
 */
export async function handleKillAll(deps: KillswitchDeps): Promise<void> {
  const {
    port,
    logger,
    taskManager,
    workflowsBySession,
    runningWorkflowSessionIds,
    getCurrentExecutor,
    setCurrentExecutor,
    setCurrentWorkflow,
  } = deps;

  try {
    logger.info('[KILLSWITCH] Received kill_all command - initiating emergency stop');

    let killedWorkflows = 0;
    let killedTasks = 0;
    let killedMirrors = 0;

    // 1. Cancel ALL multi-agent workflows
    const workflowSessions = Array.from(workflowsBySession.keys());
    for (const sessionId of workflowSessions) {
      try {
        const wf = workflowsBySession.get(sessionId);
        if (wf) {
          await wf.cancelAll();
          workflowsBySession.delete(sessionId);
          runningWorkflowSessionIds.delete(sessionId);
          killedWorkflows++;
        }
      } catch (e) {
        logger.error(`[KILLSWITCH] Failed to cancel workflow ${sessionId}:`, e);
      }
    }

    // 2. Cancel current single-agent executor
    const currentExec = getCurrentExecutor();
    if (currentExec) {
      try {
        await currentExec.cancel();
        setCurrentExecutor(null);
        killedTasks++;
      } catch (e) {
        logger.error('[KILLSWITCH] Failed to cancel current executor:', e);
      }
    }

    // 3. Kill all tasks via TaskManager
    const taskResult = await killAllTasks(taskManager, logger);
    killedTasks += taskResult.killedTasks;
    killedMirrors += taskResult.killedMirrors;

    // 4. Clear running workflow tracking
    runningWorkflowSessionIds.clear();
    setCurrentWorkflow(null);

    // 5. Clear event buffer
    if (deps.eventBuffer) {
      deps.eventBuffer.length = 0;
    }

    // 6. Clear dashboard running list
    try {
      await chrome.storage.local.set({ agent_dashboard_running: [] });
      logger.info('[KILLSWITCH] Cleared dashboard running list');
    } catch (e) {
      logger.error('[KILLSWITCH] Failed to clear dashboard running list:', e);
    }

    // 7. Freeze all remaining mirrors
    try {
      taskManager.tabMirrorService?.freezeAllMirrors?.();
    } catch {}

    // 8. Notify Agent Manager to refresh (if connected)
    if (deps.agentManagerPort) {
      try {
        safePostMessage(deps.agentManagerPort, { type: 'refresh-required' });
      } catch {}
    }

    logger.info(
      `[KILLSWITCH] Complete. Killed: ${killedWorkflows} workflows, ${killedTasks} tasks, ${killedMirrors} mirrors`,
    );

    safePostMessage(port, {
      type: 'kill_all_complete',
      data: {
        success: true,
        killedWorkflows,
        killedTasks,
        killedMirrors,
        message: 'All extension activity has been terminated',
      },
    });
  } catch (e) {
    logger.error('[KILLSWITCH] Global kill failed:', e);
    safePostMessage(port, {
      type: 'kill_all_complete',
      data: {
        success: false,
        killedWorkflows: 0,
        killedTasks: 0,
        killedMirrors: 0,
        error: e instanceof Error ? e.message : 'Killswitch failed',
      },
    });
  }
}

/**
 * Kill all tasks in the TaskManager
 */
async function killAllTasks(
  taskManager: any,
  logger: { info: Function; error: Function },
): Promise<{ killedTasks: number; killedMirrors: number }> {
  let killedTasks = 0;
  let killedMirrors = 0;

  try {
    // Cancel all running and pending tasks
    // Note: cancelTask() already sets task.status='cancelled' and task.completedAt
    const allTasks = taskManager.getAllTasks?.() || [];
    for (const task of allTasks) {
      if (task && (task.status === 'running' || task.status === 'pending')) {
        try {
          await taskManager.cancelTask(task.id);
          killedTasks++;
        } catch (e) {
          // If cancelTask fails, manually mark as cancelled for UI consistency
          task.status = 'cancelled';
          task.completedAt = Date.now();
          logger.error(`[KILLSWITCH] Failed to cancel task ${task.id}:`, e);
          killedTasks++; // Still count it as killed
        }
      }
    }

    // Stop all active mirroring
    try {
      const mirrors = taskManager.getAllMirrors?.() || [];
      for (const m of mirrors) {
        if (typeof m?.tabId === 'number') {
          try {
            taskManager.tabMirrorService?.stopMirroring?.(m.tabId);
            killedMirrors++;
          } catch {}
        }
      }
    } catch (e) {
      logger.error('[KILLSWITCH] Failed to stop mirrors:', e);
    }
  } catch (e) {
    logger.error('[KILLSWITCH] killAllTasks failed:', e);
  }

  return { killedTasks, killedMirrors };
}
