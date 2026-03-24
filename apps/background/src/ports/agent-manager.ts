import { safePostMessage } from '@extension/shared/lib/utils';
import type { Task } from '../task/task-manager';
import { logPortMessage } from '../test/instrumentation';
import { handleNewTask, handleFollowUpTask } from '../executor/task-handlers';
import { warningsSettingsStore, chatHistoryStore, Actors } from '@extension/storage';

export type AgentManagerDeps = {
  taskManager: any;
  logger: { info: Function; error: Function };
  setAgentManagerPort: (p: chrome.runtime.Port | undefined) => void;
  runningWorkflowSessionIds: Set<string>;
  workflowsBySession: Map<string, any>;
  getCurrentExecutor: () => any | null;
  setCurrentExecutor: (e: any | null) => void;
};

interface AgentData {
  sessionId: string;
  sessionTitle: string;
  taskDescription: string;
  startTime: number;
  endTime?: number;
  agentType: string;
  status: string;
  preview?: {
    tabId?: number;
    url?: string;
    title?: string;
    screenshot?: string;
    lastUpdated?: number;
  };
  workers?: Array<{
    workerId: string;
    workerIndex: number;
    color: string;
    tabId?: number;
    url?: string;
    title?: string;
    screenshot?: string;
  }>;
  metrics?: {
    totalCost?: number;
    totalLatencyMs?: number;
  };
}

function taskToAgentData(task: Task, mirrors: any[]): AgentData {
  const taskSessionId = task.parentSessionId || task.id;
  const isRunning = ['running', 'paused'].includes(task.status) || (task as any).isPaused;

  // Only use mirrors for running tasks - completed tasks should use cached screenshots
  // This prevents running agent's live preview from appearing in completed agents
  let mirror: any = undefined;
  if (isRunning) {
    // For running tasks, find mirrors that explicitly match this session
    // Use sessionId matching (most reliable), fall back to agentId matching
    const taskMirrors = mirrors.filter(m => (m.sessionId && m.sessionId === taskSessionId) || m.agentId === task.id);
    mirror =
      taskMirrors.length > 0
        ? taskMirrors.reduce((latest, current) =>
            (current.lastUpdated || 0) > (latest.lastUpdated || 0) ? current : latest,
          )
        : undefined;
  }

  // Map task status to agent status
  let status: string = task.status;
  // Check if task needs human input (paused state)
  if (task.status === 'running' && (task as any).isPaused) {
    status = 'needs_input';
  }
  // Ensure cancelled/completed tasks are reflected properly
  if (task.status === 'cancelled' || task.status === 'completed' || task.status === 'error') {
    status = task.status;
  }

  const promptTitle = task.prompt ? task.prompt.substring(0, 60) + (task.prompt.length > 60 ? '...' : '') : 'New Task';

  return {
    sessionId: taskSessionId,
    sessionTitle: promptTitle,
    taskDescription: task.prompt,
    startTime: task.startedAt || task.createdAt,
    endTime: task.completedAt,
    agentType: detectAgentType(task),
    status,
    preview: mirror
      ? {
          tabId: mirror.tabId,
          url: mirror.url,
          title: mirror.title,
          screenshot: mirror.screenshot,
          lastUpdated: mirror.lastUpdated,
        }
      : undefined,
    metrics: (task as any).metrics,
  };
}

function detectAgentType(task: Task): string {
  // Check if this is part of a multi-agent workflow
  if (task.workerIndex !== undefined && task.workerIndex >= 0) {
    return 'multiagent';
  }
  // Default to agent for now; could enhance with actual workflow type tracking
  return 'agent';
}

function groupBySession(tasks: Task[], mirrors: any[]): AgentData[] {
  const sessionMap = new Map<string, { tasks: Task[]; mirrors: any[] }>();

  for (const task of tasks) {
    const sessionId = task.parentSessionId || task.id;
    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, { tasks: [], mirrors: [] });
    }
    sessionMap.get(sessionId)!.tasks.push(task);
  }

  // Group mirrors by session - ONLY use explicit sessionId to prevent cross-contamination
  // Do NOT fall back to agentId as that could match mirrors to wrong sessions
  for (const mirror of mirrors) {
    // Only group mirrors that have an explicit sessionId set
    if (mirror.sessionId && sessionMap.has(mirror.sessionId)) {
      sessionMap.get(mirror.sessionId)!.mirrors.push(mirror);
    }
  }

  const result: AgentData[] = [];

  for (const [sessionId, { tasks, mirrors: sessionMirrors }] of sessionMap) {
    // Check if any task in this session is running
    const hasRunningTask = tasks.some(t => ['running', 'paused'].includes(t.status) || (t as any).isPaused);

    // If multiple workers, it's a multi-agent task
    if (tasks.length > 1 || tasks.some(t => t.workerIndex !== undefined)) {
      const primary = tasks.find(t => t.workerIndex == null) || tasks[0];

      // Only include worker previews if the session has running tasks
      const workers = tasks
        .filter(t => t.workerIndex !== undefined || tasks.length > 1)
        .map(t => {
          let m: any = undefined;
          // Only assign live mirrors to running workers
          const isWorkerRunning = ['running', 'paused'].includes(t.status) || (t as any).isPaused;
          if (isWorkerRunning && hasRunningTask) {
            // Find mirrors for this worker using agentId (task.id)
            const workerMirrors = sessionMirrors.filter((mirror: any) => mirror.agentId === t.id);
            m =
              workerMirrors.length > 0
                ? workerMirrors.reduce((latest: any, current: any) =>
                    (current.lastUpdated || 0) > (latest.lastUpdated || 0) ? current : latest,
                  )
                : undefined;
          }
          return {
            workerId: t.id,
            workerIndex: t.workerIndex ?? 0,
            color: t.color,
            tabId: m?.tabId,
            url: m?.url,
            title: m?.title,
            screenshot: m?.screenshot,
          };
        });

      // Derive overall session status: individual worker cancellations (e.g. from
      // plan modifications) don't mean the workflow itself was cancelled.
      let sessionStatus: string = primary.status;
      if (!hasRunningTask) {
        if (tasks.some(t => t.status === 'completed')) sessionStatus = 'completed';
        else if (tasks.some(t => t.status === 'error')) sessionStatus = 'failed';
      }

      const multiPromptTitle = primary.prompt
        ? primary.prompt.substring(0, 60) + (primary.prompt.length > 60 ? '...' : '')
        : 'New Task';

      result.push({
        sessionId,
        sessionTitle: multiPromptTitle,
        taskDescription: primary.prompt,
        startTime: primary.startedAt || primary.createdAt,
        endTime: primary.completedAt,
        agentType: 'multiagent',
        status: sessionStatus,
        workers,
        metrics: (primary as any).metrics,
      });
    } else {
      // Single agent
      const task = tasks[0];
      result.push(taskToAgentData(task, sessionMirrors));
    }
  }

  return result;
}

export function attachAgentManagerPortHandlers(port: chrome.runtime.Port, deps: AgentManagerDeps): void {
  const { taskManager, logger, setAgentManagerPort } = deps;

  setAgentManagerPort(port);
  taskManager.tabMirrorService.setAgentManagerPort(port);

  // Send initial data
  const sendAgentData = () => {
    try {
      const tasks = taskManager.getAllTasks();
      const mirrors = taskManager.getAllMirrors();
      const agents = groupBySession(tasks, mirrors);

      // Add cached screenshots for completed agents that don't have live preview
      for (const agent of agents) {
        if (!agent.preview?.screenshot) {
          const cached = taskManager.tabMirrorService.getCachedScreenshot(agent.sessionId);
          if (cached) {
            agent.preview = {
              screenshot: cached.screenshot,
              url: cached.url,
              title: cached.title,
            };
          }
        }
        // Add cached per-worker screenshots for completed multiagent agents
        if (agent.workers) {
          for (const worker of agent.workers) {
            if (!worker.screenshot) {
              const cached = taskManager.tabMirrorService.getCachedScreenshot(worker.workerId);
              if (cached) {
                worker.screenshot = cached.screenshot;
                if (!worker.url) worker.url = cached.url;
                if (!worker.title) worker.title = cached.title;
              }
            }
          }
        }
      }

      // Also include data from storage for completed agents
      chrome.storage.local.get(['agent_dashboard_running', 'agent_dashboard_completed'], result => {
        const storedRunning = (result.agent_dashboard_running || []) as any[];
        const storedCompleted = (result.agent_dashboard_completed || []) as any[];

        logger.info('[AgentManager] sendAgentData storage state', {
          liveTaskCount: agents.length,
          storedRunningCount: storedRunning.length,
          storedCompletedCount: storedCompleted.length,
        });

        // Build a map of stored titles by sessionId for quick lookup
        const storedTitles = new Map<string, string>();
        for (const stored of [...storedRunning, ...storedCompleted]) {
          if (stored.sessionTitle) {
            storedTitles.set(stored.sessionId, stored.sessionTitle);
          }
        }

        // Update live agents with stored titles (preserves generated titles)
        for (const agent of agents) {
          const storedTitle = storedTitles.get(agent.sessionId);
          if (storedTitle) {
            agent.sessionTitle = storedTitle;
          }
        }

        // Merge stored data with live data
        const seenSessionIds = new Set(agents.map(a => a.sessionId));

        let addedFromStorage = 0;
        for (const stored of [...storedRunning, ...storedCompleted]) {
          if (!seenSessionIds.has(stored.sessionId)) {
            seenSessionIds.add(stored.sessionId); // Prevent duplicates from running+completed
            // Check for cached screenshot for this stored agent
            const cached = taskManager.tabMirrorService.getCachedScreenshot(stored.sessionId);
            agents.push({
              sessionId: stored.sessionId,
              sessionTitle: stored.sessionTitle || stored.taskDescription,
              taskDescription: stored.taskDescription,
              startTime: stored.startTime,
              endTime: stored.endTime,
              agentType: stored.agentType || 'agent',
              status: stored.status,
              preview: cached
                ? {
                    screenshot: cached.screenshot,
                    url: cached.url,
                    title: cached.title,
                  }
                : undefined,
              metrics: {
                totalCost: stored.totalCost || stored.cost,
                totalLatencyMs: stored.totalLatencyMs || stored.latencyMs,
              },
            });
            addedFromStorage++;
          }
        }

        logger.info('[AgentManager] sendAgentData final', {
          totalAgents: agents.length,
          addedFromStorage,
          agentsSummary: agents.map(a => ({
            sessionId: a.sessionId.substring(0, 15),
            status: a.status,
            endTime: a.endTime,
          })),
        });

        safePostMessage(port, { type: 'agents-data', data: { agents } });
      });
    } catch (e) {
      logger.error('[AgentManager] Failed to send agent data:', e);
    }
  };

  // Send initial data
  sendAgentData();

  port.onMessage.addListener(async (message: any) => {
    const msgType = String(message?.type || '');
    logPortMessage('agent-manager', msgType, 'call', { input: message });
    try {
      logger.info('[AgentManager] Incoming message:', msgType);

      switch (msgType) {
        case 'get-agents': {
          sendAgentData();
          break;
        }

        case 'start-new-task':
        case 'start-task-inline': {
          const { task, agentType, contextTabIds, attachments } = message;
          if (!task || typeof task !== 'string') {
            safePostMessage(port, { type: 'error', error: 'Missing task' });
            return;
          }

          // Check first-run disclaimer
          try {
            const w = await warningsSettingsStore.getWarnings();
            if (!w.hasAcceptedFirstRun) {
              safePostMessage(port, {
                type: 'error',
                error: 'Please accept the liability disclaimer in the extension to continue.',
              });
              return;
            }
          } catch {
            safePostMessage(port, {
              type: 'error',
              error: 'Please accept the liability disclaimer in the extension to continue.',
            });
            return;
          }

          // Use client-provided sessionId (mirrors side panel where sessionId is
          // generated client-side before dispatch). Fall back to generating one
          // for backward compat with start-new-task.
          const sessionId = message.sessionId || `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

          // Persist user message so both agent manager and side panel can load it
          chatHistoryStore
            .addMessage(sessionId, {
              actor: Actors.USER,
              content: task,
              timestamp: Date.now(),
            } as any)
            .catch(() => {});

          // Subscribe this port to receive live events for the new task
          taskManager.subscribePortToSession(`agent-manager:${sessionId}`, port, sessionId);

          // Confirm session started BEFORE awaiting handleNewTask (which awaits
          // the full executor run). The client needs the sessionId immediately so
          // event handlers can match incoming events to the current session.
          safePostMessage(port, { type: 'task-started-inline', sessionId });

          // Get active tab for context
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const tabId = activeTab?.id || -1;

          // Start the task using the same handler as side panel
          await handleNewTask(
            {
              type: 'new_task',
              task,
              taskId: sessionId,
              tabId,
              agentType: agentType || 'auto',
              contextTabIds: contextTabIds || [],
              attachments: attachments || [],
            },
            {
              taskManager,
              logger,
              getCurrentPort: () => port,
              getCurrentExecutor: deps.getCurrentExecutor,
              setCurrentExecutor: deps.setCurrentExecutor,
            },
          );
          break;
        }

        case 'open-sidepanel-to-session': {
          const { sessionId } = message;
          if (!sessionId) {
            safePostMessage(port, { type: 'error', error: 'Missing sessionId' });
            return;
          }

          // Store target session for sidepanel to navigate to
          await chrome.storage.local.set({
            pending_sidepanel_session: sessionId,
            pending_sidepanel_timestamp: Date.now(),
          });

          // Open sidepanel
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab?.windowId) {
            await chrome.sidePanel.open({ windowId: activeTab.windowId });
          }

          safePostMessage(port, { type: 'sidepanel-opened', sessionId });
          break;
        }

        case 'prewarm-session': {
          // Pre-warm: ensure trajectory data is persisted before sidepanel opens
          const { sessionId } = message;
          if (!sessionId) break;

          try {
            const trajectoryService = (taskManager as any).trajectoryService;
            if (trajectoryService?.persistNow) {
              await trajectoryService.persistNow(sessionId);
            }
            // Also cache the rootId for faster lookup
            const rootId = trajectoryService?.getRootId?.(sessionId);
            if (rootId) {
              trajectoryService?.rootIdCache?.set(sessionId, rootId);
            }
          } catch (e) {
            logger.error('[AgentManager] Prewarm failed:', e);
          }
          break;
        }

        case 'subscribe-to-session': {
          const { sessionId, lastEventId } = message;
          if (!sessionId) {
            safePostMessage(port, { type: 'error', error: 'Missing sessionId' });
            break;
          }
          logger.info(`[AgentManager] Subscribing to session ${sessionId}`);

          // 1. Send current trajectory state from memory (includes events not yet persisted)
          let trajectoryState: any = null;
          try {
            trajectoryState = taskManager.trajectoryService?.getTrajectoryState?.(sessionId) || null;
            if (trajectoryState) {
              safePostMessage(port, {
                type: 'trajectory_state',
                sessionId,
                data: {
                  rootId: trajectoryState.rootId,
                  traceItems: trajectoryState.traceItems,
                  workerItems: trajectoryState.workerItems,
                  isCompleted: trajectoryState.isCompleted,
                  finalPreview: trajectoryState.finalPreview,
                  finalPreviewBatch: trajectoryState.finalPreviewBatch,
                },
              });
            }
          } catch (e) {
            logger.error('[AgentManager] Failed to send trajectory_state:', e);
          }

          // 2. Send buffered events for this session (skip if completed)
          const isCompleted = !!trajectoryState?.isCompleted;
          try {
            const sessionEvents = !isCompleted
              ? taskManager.getBufferedEvents?.(String(sessionId), lastEventId) || []
              : [];
            if (sessionEvents.length > 0) {
              safePostMessage(port, {
                type: 'buffered_session_events',
                sessionId,
                events: sessionEvents,
              });
            }
          } catch {}

          // 3. Send current mirrors for this session
          try {
            const allMirrors = taskManager.getAllMirrors?.() || [];
            const sessionMirrors = allMirrors.filter((m: any) => {
              const mirrorSessionId = m?.sessionId;
              return mirrorSessionId && String(mirrorSessionId) === String(sessionId);
            });
            if (sessionMirrors.length > 0) {
              safePostMessage(port, { type: 'tab-mirror-batch', data: sessionMirrors });
            }
          } catch {}

          // 4. Determine session state
          let agentType: string | null = null;
          try {
            const task = taskManager.getTask?.(String(sessionId));
            agentType = task?.agentType || (deps.getCurrentExecutor() as any)?.manualAgentType || null;
            if (deps.runningWorkflowSessionIds.has(String(sessionId))) agentType = 'multiagent';
          } catch {}

          const isRunning =
            deps.runningWorkflowSessionIds.has(String(sessionId)) ||
            String((deps.getCurrentExecutor() as any)?.context?.taskId || '') === String(sessionId) ||
            String(taskManager.getTask?.(String(sessionId))?.status || '') === 'running';

          let workflowGraph = null;
          try {
            const wf = deps.workflowsBySession.get(String(sessionId));
            if (wf) workflowGraph = wf.getCurrentGraph?.() || null;
          } catch {}

          // 5. Register port as subscriber for live events
          taskManager.subscribePortToSession(`agent-manager:${sessionId}`, port, String(sessionId));

          safePostMessage(port, { type: 'session_subscribed', sessionId, isRunning, agentType, workflowGraph });
          break;
        }

        case 'unsubscribe-from-session': {
          const { sessionId } = message;
          if (sessionId) {
            taskManager.unsubscribeFromSession(`agent-manager:${sessionId}`);
          }
          break;
        }

        case 'follow-up-inline': {
          const { sessionId, task: followUpText, agentType, contextTabIds, attachments } = message;
          if (!followUpText || !sessionId) {
            safePostMessage(port, { type: 'error', error: 'Missing task or sessionId' });
            break;
          }

          // Persist follow-up user message
          chatHistoryStore
            .addMessage(sessionId, {
              actor: Actors.USER,
              content: followUpText,
              timestamp: Date.now(),
            } as any)
            .catch(() => {});

          await handleFollowUpTask(
            {
              type: 'follow_up_task',
              task: followUpText,
              taskId: sessionId,
              agentType,
              contextTabIds,
              attachments,
            },
            {
              taskManager,
              logger,
              getCurrentPort: () => port,
              getCurrentExecutor: deps.getCurrentExecutor,
              setCurrentExecutor: deps.setCurrentExecutor,
            },
          );
          break;
        }

        case 'speech_to_text': {
          if (!message.audio) {
            safePostMessage(port, { type: 'speech_to_text_error', error: 'No audio data received' });
            return;
          }
          try {
            const { SpeechToTextService } = await import('../services/speech-to-text');
            const service = await SpeechToTextService.create();
            let audio = String(message.audio);
            if (audio.startsWith('data:')) audio = audio.split(',')[1];
            const text = await service.transcribe(audio, 'audio/webm');
            safePostMessage(port, { type: 'speech_to_text_result', text });
          } catch (e) {
            safePostMessage(port, {
              type: 'speech_to_text_error',
              error: e instanceof Error ? e.message : 'Transcription failed',
            });
          }
          break;
        }

        default:
          break;
      }
    } catch (error) {
      logger.error('[AgentManager] Error handling message:', error);
      safePostMessage(port, { type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  port.onDisconnect.addListener(() => {
    logger.info('[AgentManager] Disconnected');
    taskManager.eventBus.unsubscribePort(port);
    setAgentManagerPort(undefined);
    taskManager.tabMirrorService.setAgentManagerPort(undefined);
  });
}
