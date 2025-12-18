import { agentModelStore, generalSettingsStore, AgentNameEnum } from '@extension/storage';
import { safePostMessage } from '@extension/shared/lib/utils';
import { createChatModel } from '../workflows/models/factory';
import { Executor } from '../executor/executor';
import BrowserContext from '../browser/context';
import { subscribeToExecutorEvents } from '../workflows/shared/subscribe-to-executor-events';
import { setPreviewVisibility, sendTabMirror, sendAllMirrorsForCleanup } from '../tabs/handlers';
import { getAllProvidersDecrypted } from '../crypto';

type BaseChatModel = any;

export type DashboardDeps = {
  taskManager: any;
  logger: { info: Function; error: Function; debug?: Function };
  getCurrentPort: () => chrome.runtime.Port | null; // side-panel port
  setDashboardPort: (p: chrome.runtime.Port | undefined) => void;
};

export function attachDashboardPortHandlers(port: chrome.runtime.Port, deps: DashboardDeps): void {
  const { taskManager, logger, getCurrentPort, setDashboardPort } = deps;

  setDashboardPort(port);

  port.onMessage.addListener(async (message: any) => {
    try {
      const msgType = String(((message as any)?.type ?? (message as any)?.messageType) || '');
      logger.info('[Dashboard] Incoming message type:', msgType);
      switch (msgType) {
        case 'new_task': {
          try {
            const query: string = String(message.task || '').trim();
            const sessionId: string = String(message.taskId || '');
            const tabIdRaw: any = message.tabId;
            const tabId: number = typeof tabIdRaw === 'number' ? tabIdRaw : -1;
            const manualAgentType: string | undefined = message.agentType ? String(message.agentType) : undefined;
            if (!query || !sessionId) {
              return port.postMessage({ type: 'error', error: 'Missing task or taskId' });
            }

            // Ensure a Task exists but do not auto-queue/start it
            await taskManager.createTask(query, undefined, true, sessionId, undefined);

            const providers = await getAllProvidersDecrypted();
            const agentModels = await agentModelStore.getAllAgentModels();
            const navigatorCfg = agentModels[AgentNameEnum.Navigator];
            if (!navigatorCfg) {
              return port.postMessage({ type: 'error', error: 'Please choose a model for the navigator in the settings first' });
            }
            const navigatorLLM: BaseChatModel = createChatModel(providers[navigatorCfg.provider], navigatorCfg);

            const plannerCfg = agentModels[AgentNameEnum.Planner] || null;
            const validatorCfg = agentModels[AgentNameEnum.Validator] || null;
            const plannerLLM: BaseChatModel | null = plannerCfg ? createChatModel(providers[plannerCfg.provider], plannerCfg) : null;
            const validatorLLM: BaseChatModel | null = validatorCfg ? createChatModel(providers[validatorCfg.provider], validatorCfg) : null;

            // Apply general settings; disable full planning by default for single-agent modes
            const generalSettings = await generalSettingsStore.getSettings();
            const effectiveSettings: any = { ...generalSettings };
            try { (effectiveSettings as any).useFullPlanningPipeline = false; } catch {}

            // Build single-agent executor bound to this session
            const browserCtx = new BrowserContext({});
            const executor = new Executor(query, sessionId, browserCtx, navigatorLLM, {
              plannerLLM: plannerLLM ?? navigatorLLM,
              validatorLLM: validatorLLM ?? navigatorLLM,
              agentOptions: {
                maxSteps: generalSettings.maxSteps,
                maxFailures: generalSettings.maxFailures,
                maxActionsPerStep: generalSettings.maxActionsPerStep,
                useVision: generalSettings.useVision,
                useVisionForPlanner: true,
                planningInterval: generalSettings.planningInterval,
              },
              generalSettings: effectiveSettings,
              agentType: manualAgentType,
            });

            // Register with TaskManager for mirroring/tab grouping, then forward execution events to panel
            try { taskManager.tabMirrorService.setVisionEnabled(!!(generalSettings.showTabPreviews ?? true)); } catch {}
            try { taskManager.setSingleAgentExecutor(sessionId, executor as any, tabId > 0 ? tabId : 0); } catch {}
            delete (executor as any).__backgroundSubscribed;
            try { await subscribeToExecutorEvents(executor, getCurrentPort(), taskManager, logger); } catch {}

            // Initialize and run asynchronously
            (async () => {
              try {
                await executor.initialize();
                await executor.execute();
              } catch (e) {
                safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Task failed' });}
            })();
            return;
          } catch (e) {
            return port.postMessage({ type: 'error', error: e instanceof Error ? e.message : 'Failed to start task' });
          }
        }

        case 'follow_up_task': {
          try {
            const query: string = String(message.task || '').trim();
            const sessionId: string = String(message.taskId || '');
            const manualAgentType: string | undefined = message.agentType ? String(message.agentType) : undefined;
            if (!query || !sessionId) {
              return port.postMessage({ type: 'error', error: 'Missing task or taskId' });
            }

            const task = taskManager.getTask(sessionId);
            if (task && task.executor) {
              try { (task.executor as any).addFollowUpTask(query, manualAgentType); } catch {}
              try { (task.executor as any).clearExecutionEvents?.(); } catch {}
              try { await subscribeToExecutorEvents(task.executor as any, getCurrentPort(), taskManager, logger); } catch {}
              // CRITICAL FIX: Reactivate task in TaskManager so STOP button works on follow-ups
              try { taskManager.reactivateTask(sessionId); } catch {}
              ;(async () => { try { await (task.executor as any).execute(); } catch (e) { safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Follow-up failed' });} })();
              return;
            }
            // If no existing executor, fall back to new_task flow
            port.postMessage({ type: 'panel_log', message: '[Compat] follow_up_task -> new_task (no existing executor)' });
            const newMsg = { ...message, type: 'new_task' };
            try { (port as any).onMessage.dispatch?.(newMsg); } catch {}
            return;
          } catch (e) {
            return port.postMessage({ type: 'error', error: e instanceof Error ? e.message : 'Failed to send follow-up' });
          }
        }

        case 'cancel_task': {
          try {
            const idRaw: string = String((message.sessionId || message.taskId || '') as string);
            const id = idRaw.trim();
            if (!id) {
              return port.postMessage({ type: 'error', error: 'Missing taskId/sessionId' });
            }
            
            // First, check if there's a pending estimation for this session and cancel it
            try {
              const { cancelEstimation } = await import('../executor/task-handlers');
              cancelEstimation(id);
              logger.info(`[Estimation] Cancelled estimation for session ${id} via cancel_task (dashboard)`);
              
              // Send immediate cancellation feedback to frontend
              const { Actors, ExecutionState } = await import('../workflows/shared/event/types');
              port.postMessage({
                type: 'execution',
                actor: Actors.ESTIMATOR,
                state: ExecutionState.ESTIMATION_CANCELLED,
                data: {
                  taskId: id,
                  step: 0,
                  maxSteps: 0,
                  details: 'Workflow cancelled by user',
                },
                timestamp: Date.now()
              });
            } catch (e) {
              // Estimation might not exist, continue with task cancellation
            }
            
            await taskManager.cancelTask(id);
            try { await (taskManager as any).cancelAllForParentSession?.(id); } catch {}
            return port.postMessage({ type: 'success' });
          } catch (e) {
            return port.postMessage({ type: 'error', error: e instanceof Error ? e.message : 'Failed to cancel task' });
          }
        }
        case 'preview_visibility': {
          try {
            const { sessionId, visible } = message;
            if (!sessionId || typeof visible !== 'boolean') {
              return port.postMessage({ type: 'error', error: 'Invalid preview_visibility payload' });
            }
            setPreviewVisibility(taskManager as any, String(sessionId), !!visible);
            return port.postMessage({ type: 'success' });
          } catch (e) {
            return port.postMessage({ type: 'error', error: e instanceof Error ? e.message : 'Failed to set visibility' });
          }
        }
        case 'get-agents-status': {
          const tasks = taskManager.getAllTasks();
          const agents = tasks.map((task: any) => ({
            id: task.id,
            name: task.name,
            color: task.color,
            tabId: task.tabId,
            status: task.status,
            task: task.prompt,
            startTime: task.startedAt,
            endTime: task.completedAt,
            parentSessionId: task.parentSessionId,
            logs: task.logs,
          }));
          const mirrors = taskManager.getAllMirrors();
          port.postMessage({ type: 'agents-status', data: { agents, mirrors } });
          break;
        }
        case 'create-agent': {
          const { task } = (message as any).data || {};
          if (!task) {
            port.postMessage({ type: 'error', error: 'No task provided' });
            return;
          }
          const taskId = await taskManager.createTask(task);
          logger.info('Created new task:', taskId);
          break;
        }
        case 'stop-agent': {
          const { agentId } = (message as any).data || {};
          if (!agentId) {
            port.postMessage({ type: 'error', error: 'No agent ID provided' });
            return;
          }
          await taskManager.cancelTask(agentId);
          logger.info('Cancelled task:', agentId);
          break;
        }
        case 'get-tab-mirror': {
          sendTabMirror(taskManager as any, port);
          break;
        }
        case 'get-all-mirrors-for-cleanup': {
          try { await sendAllMirrorsForCleanup(taskManager as any, port); } catch (e) { return port.postMessage({ type: 'tab-mirror-batch-for-cleanup', error: e instanceof Error ? e.message : 'Failed to get mirrors for cleanup' }); }
          break;
        }
        default:
          break;
      }
    } catch (error) {
      logger.error('Error handling dashboard message:', error);
      port.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  port.onDisconnect.addListener(() => {
    deps.logger.info('Dashboard disconnected');
    setDashboardPort(undefined);
  });
}


