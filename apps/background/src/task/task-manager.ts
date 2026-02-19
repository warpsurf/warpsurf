import { EventEmitter } from '../utils/event-emitter';
import { safePostMessage, startPageFlash, stopPageFlash } from '@extension/shared/lib/utils';
import { Executor } from '../executor/executor';
import { createSingleAgentExecutor } from './executor-factory';
import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { createChatModel } from '../workflows/models/factory';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  chatHistoryStore,
} from '@extension/storage';
import { getAllProvidersDecrypted } from '../crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Actors, ExecutionState, EventType } from '../workflows/shared/event/types';
import { TabMirrorService } from '../tabs/tab-mirror';
import { errorLog } from '../utils/error-log';
import { TaskQueue } from './task-queue';
import { TabGroupService } from './tab-group-service';
import { MirrorCoordinator } from './mirror-coordinator';
import { WorkerSessionManager } from './worker-session-manager';
import { tabExists } from '../utils';
import { trajectoryPersistence } from './trajectory-persistence';
import { globalTokenTracker } from '../utils/token-tracker';
import { sessionLogArchive } from '../utils/session-log-archive';
import { titleGenerator } from '../services/title-generator';

const DASHBOARD_RUNNING_KEY = 'agent_dashboard_running';
const DASHBOARD_COMPLETED_KEY = 'agent_dashboard_completed';
const DASHBOARD_MAX_COMPLETED = 200;

export interface Task {
  id: string;
  name: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  color: string;
  groupId?: number;
  groupColorName?: chrome.tabGroups.Color;
  executor?: Executor;
  tabId?: number;
  mirroringStarted?: boolean;
  parentSessionId?: string;
  workerIndex?: number;
  agentType?: 'chat' | 'search' | 'agent' | 'multiagent' | 'auto';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  logs: Array<{ timestamp: number; message: string; type: 'info' | 'action' | 'error' }>;
  onExecutorFinished?: () => void;
}

interface TaskManagerOptions {
  maxConcurrentTasks: number;
  dashboardPort?: chrome.runtime.Port;
}

export class TaskManager extends EventEmitter {
  private tasks = new Map<string, Task>();
  private dashboardPort?: chrome.runtime.Port;
  private sidePanelPort?: chrome.runtime.Port;
  private logger = createLogger('TaskManager');
  public tabMirrorService: TabMirrorService;

  private queue: TaskQueue;
  private tabGroups: TabGroupService;
  private mirrors: MirrorCoordinator;
  private workers: WorkerSessionManager;
  private eventBufferBySession = new Map<string, any[]>();
  private eventBufferMaxSize = 0;
  private streamBuffers = new Map<
    string,
    { sessionId: string; actor: string; content: string; timestamp: number; finalized?: boolean }
  >();
  private streamMessageKeys = new Set<string>();
  private lastStreamMessageBySession = new Map<string, { actor: string; timestamp: number }>();
  private pendingStreamSummaries = new Map<string, any>();

  /** Update extension badge to show running task count */
  private updateBadge(): void {
    const running = this.getRunningTasks().length;
    this.logger.info(`Updating badge: ${running} running tasks`);
    chrome.action.setBadgeText({ text: running > 0 ? String(running) : '' });
    chrome.action.setBadgeBackgroundColor({ color: running > 0 ? '#22c55e' : '#666' });
  }

  private isPrimarySession(task: Task): boolean {
    const sessionId = String(task.parentSessionId || task.id);
    return String(task.id) === sessionId;
  }

  private inferAgentType(task: Task, detail?: string): 'chat' | 'search' | 'agent' | 'multiagent' {
    if (task.agentType && task.agentType !== 'auto') return task.agentType;
    if (typeof task.workerIndex === 'number' && task.workerIndex > 0) return 'multiagent';
    const text = String(detail || '').toLowerCase();
    if (text.includes('web search')) return 'search';
    if (text.includes('simple question')) return 'chat';
    if (text.includes('browser automation')) return 'agent';
    if (task.name?.toLowerCase?.().includes('web agent')) return 'agent';
    return 'agent';
  }

  private async getSessionTitle(sessionId: string, prompt: string): Promise<string> {
    try {
      const session = await chatHistoryStore.getSession(sessionId);
      if (session?.title) return session.title;
    } catch {}
    const trimmed = String(prompt || '').trim();
    return trimmed ? trimmed.substring(0, 50) + (trimmed.length > 50 ? '...' : '') : 'New Chat';
  }

  private generateSmartTitle(sessionId: string, task: Task): void {
    titleGenerator
      .generateTitle(sessionId, task.prompt)
      .then(title => {
        if (title) {
          task.name = title;
          this.notifyDashboard('agent-title-update', { sessionId, title });
          this.sidePanelPort?.postMessage({ type: 'title-update', sessionId, title });
          this.tabMirrorService.notifyAgentManager('agent-title-update', { sessionId, title });
        }
      })
      .catch(() => {});
  }

  private persistDashboardRunning(task: Task, detail?: string): void {
    if (!this.isPrimarySession(task)) return;
    const sessionId = String(task.parentSessionId || task.id);
    const agentType = this.inferAgentType(task, detail);
    const taskDescription = `${agentType}: ${String(task.prompt || '').substring(0, 120)}`;
    (async () => {
      try {
        const result = await chrome.storage.local.get(DASHBOARD_RUNNING_KEY);
        const arr = Array.isArray(result[DASHBOARD_RUNNING_KEY]) ? result[DASHBOARD_RUNNING_KEY] : [];
        const existing = arr.find((a: any) => String(a.sessionId) === sessionId);
        const filtered = arr.filter((a: any) => String(a.sessionId) !== sessionId);

        // Preserve existing sessionTitle if it was already set (e.g., by title generator)
        const sessionTitle = existing?.sessionTitle || (await this.getSessionTitle(sessionId, task.prompt));

        filtered.push({
          sessionId,
          sessionTitle,
          taskDescription,
          startTime: existing?.startTime || task.startedAt || Date.now(),
          agentType,
          status: 'running',
          lastUpdate: Date.now(),
        });
        await chrome.storage.local.set({ [DASHBOARD_RUNNING_KEY]: filtered });
      } catch (e) {
        this.logger.error('[Dashboard] Failed to persist running agent:', e);
      }
    })();
  }

  private persistDashboardCompleted(task: Task, status: 'completed' | 'failed' | 'cancelled', detail?: string): void {
    if (!this.isPrimarySession(task)) return;
    const sessionId = String(task.parentSessionId || task.id);
    const agentType = this.inferAgentType(task, detail);
    const taskDescription = `${agentType}: ${String(task.prompt || '').substring(0, 120)}`;
    (async () => {
      try {
        const result = await chrome.storage.local.get([DASHBOARD_RUNNING_KEY, DASHBOARD_COMPLETED_KEY]);
        const running = Array.isArray(result[DASHBOARD_RUNNING_KEY]) ? result[DASHBOARD_RUNNING_KEY] : [];
        const completed = Array.isArray(result[DASHBOARD_COMPLETED_KEY]) ? result[DASHBOARD_COMPLETED_KEY] : [];
        const existing = running.find((a: any) => String(a.sessionId) === sessionId);
        const startTime = existing?.startTime || task.startedAt || Date.now();

        // Preserve existing sessionTitle if it was already set (e.g., by title generator)
        const sessionTitle = existing?.sessionTitle || (await this.getSessionTitle(sessionId, task.prompt));

        const newRunning = running.filter((a: any) => String(a.sessionId) !== sessionId);
        const completedEntry = {
          sessionId,
          sessionTitle,
          taskDescription,
          startTime,
          endTime: Date.now(),
          agentType,
          status,
        };
        const nextCompleted = [
          ...completed.filter((a: any) => String(a.sessionId) !== sessionId),
          completedEntry,
        ].slice(-DASHBOARD_MAX_COMPLETED);
        await chrome.storage.local.set({
          [DASHBOARD_RUNNING_KEY]: newRunning,
          [DASHBOARD_COMPLETED_KEY]: nextCompleted,
        });
      } catch (e) {
        this.logger.error('[Dashboard] Failed to persist completed agent:', e);
      }
    })();
  }

  constructor(options: TaskManagerOptions) {
    super();
    this.dashboardPort = options.dashboardPort;
    this.tabMirrorService = new TabMirrorService();

    this.queue = new TaskQueue(options.maxConcurrentTasks);
    this.tabGroups = new TabGroupService();
    this.mirrors = new MirrorCoordinator(this.tabMirrorService);
    this.workers = new WorkerSessionManager(() => this.tasks, this.mirrors, this.tabGroups);

    chrome.tabs.onCreated.addListener(async tab => {
      if (!tab?.id || typeof tab.openerTabId !== 'number') return;
      const parentTask = Array.from(this.tasks.values()).find(t => t.tabId === tab.openerTabId);
      if (parentTask) {
        await this.tabGroups.applyTabColor(tab.id, parentTask, this.tasks);
      }
    });
  }

  setEventBuffering(maxSize: number): void {
    this.eventBufferMaxSize = Math.max(0, Number(maxSize) || 0);
  }

  clearEventBuffer(sessionId?: string): void {
    if (!sessionId) {
      this.eventBufferBySession.clear();
      this.streamBuffers.clear();
      this.streamMessageKeys.clear();
      this.lastStreamMessageBySession.clear();
      this.pendingStreamSummaries.clear();
      return;
    }
    const sid = String(sessionId);
    this.eventBufferBySession.delete(sid);
    try {
      for (const key of this.streamBuffers.keys()) {
        if (key.startsWith(`${sid}:`)) this.streamBuffers.delete(key);
      }
    } catch {}
    try {
      for (const key of this.streamMessageKeys) {
        if (key.startsWith(`${sid}:`)) this.streamMessageKeys.delete(key);
      }
    } catch {}
    try {
      this.lastStreamMessageBySession.delete(sid);
    } catch {}
    try {
      this.pendingStreamSummaries.delete(sid);
    } catch {}
  }

  getBufferedEvents(sessionId: string, afterEventId?: string | null): any[] {
    const sid = String(sessionId || '');
    if (!sid) return [];
    const list = this.eventBufferBySession.get(sid) || [];
    if (!afterEventId) return [...list];
    const idx = list.findIndex(e => String(e?.eventId || e?.data?.eventId || '') === String(afterEventId));
    return idx >= 0 ? list.slice(idx + 1) : [...list];
  }

  setMaxConcurrentTasks(max: number): void {
    this.queue.setMaxConcurrent(max);
    this.processQueue();
  }

  async createTask(
    prompt: string,
    name?: string,
    skipQueue: boolean = false,
    explicitId?: string,
    parentSessionId?: string,
    workerIndex?: number,
  ): Promise<string> {
    const taskId = explicitId || `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const { name: taskName, worker_num } = name
      ? { name, worker_num: workerIndex || 0 }
      : this.tabGroups.getNextWebAgentName(this.tasks);

    const used = await this.tabGroups.getUsedColors(this.tasks);
    const chosen = this.tabGroups.chooseColor(used, worker_num);

    const task: Task = {
      id: taskId,
      name: taskName,
      prompt,
      status: 'pending',
      color: chosen.hex,
      groupColorName: chosen.name,
      parentSessionId: parentSessionId || explicitId || undefined,
      createdAt: Date.now(),
      logs: [],
    };

    this.tasks.set(taskId, task);

    if (!skipQueue) {
      this.queue.enqueue(taskId);
      this.notifyDashboard('agent-created', { id: taskId, name: task.name, task: prompt });
      this.emit('task-created', task);
      await this.processQueue();
    }

    return taskId;
  }

  reactivateTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'running';
    task.startedAt = Date.now();
    this.queue.markRunning(taskId);
    this.updateBadge();
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (task.status === 'running' && task.executor) {
      await task.executor.cancel();
      setTimeout(() => {
        (task.executor as any).clearExecutionEvents?.();
        delete (task.executor as any).__backgroundSubscribed;
        delete (task.executor as any).__taskManagerSubscribed;
      }, 500);
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();
    this.queue.markCompleted(taskId);
    this.queue.remove(taskId);
    this.persistDashboardCompleted(task, 'cancelled');

    this.mirrors.freezeSession(String(task.parentSessionId || task.id));
    this.notifyDashboard('agent-status-update', { agentId: taskId, status: 'cancelled' });
    this.emit('task-cancelled', task);
    this.updateBadge();

    await this.processQueue();
  }

  async closeTaskGroup(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    try {
      if (typeof task.groupId === 'number' && task.groupId >= 0) {
        const tabs = await chrome.tabs.query({ groupId: task.groupId, windowType: 'normal' });
        const tabIds = tabs.map(t => t.id).filter((id): id is number => typeof id === 'number');
        if (tabIds.length > 0) await chrome.tabs.remove(tabIds);

        for (const t of this.tasks.values()) {
          if (t.id !== taskId && t.groupId === task.groupId && typeof t.tabId === 'number') {
            await chrome.tabs.remove(t.tabId).catch(() => {});
          }
        }
      } else if (typeof task.tabId === 'number') {
        await chrome.tabs.remove(task.tabId);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        this.logger.error('Failed to close task group:', error);
      }
    }
  }

  private async processQueue(): Promise<void> {
    while (this.queue.hasCapacity() && this.queue.getQueueLength() > 0) {
      const taskId = this.queue.dequeue();
      if (!taskId) continue;

      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'pending') continue;

      await this.startTask(task);
    }
  }

  async startTask(task: Task, forceNewTab: boolean = false): Promise<void> {
    try {
      task.status = 'running';
      task.startedAt = Date.now();
      this.queue.markRunning(task.id);
      this.persistDashboardRunning(task);

      const browserContext = new BrowserContext({ forceNewTab: task.name?.includes('Web Agent') || forceNewTab });
      const executor = await this.createExecutor(task, browserContext);
      task.executor = executor;

      this.propagateGroupId(task, executor);
      await executor.initialize().catch(e => this.logger.error('Init failed', e));
      await this.handleInitTab(task, executor, browserContext);
      this.setupTaskEventHandlers(task, executor);

      this.notifyDashboard('agent-status-update', { agentId: task.id, status: 'running' });
      this.emit('task-started', task);
      this.updateBadge();

      await executor.execute();

      task.status = 'completed';
      task.completedAt = Date.now();
      this.queue.markCompleted(task.id);
      this.persistDashboardCompleted(task, 'completed');
      const sessionId = String(task.parentSessionId || task.id);

      // IMPORTANT: Get mirrors BEFORE freezing (freezing removes them from active list)
      let sessionMirrors: any[] = [];
      try {
        const allMirrors = this.mirrors.getAllMirrors();
        sessionMirrors = allMirrors.filter((m: any) => m.sessionId === sessionId);
      } catch {}

      this.mirrors.freezeSession(sessionId);

      // Mark trajectory as completed with captured mirrors
      try {
        let finalPreview = sessionMirrors[0];
        if (!finalPreview) {
          const cached = this.tabMirrorService.getCachedScreenshot(sessionId);
          if (cached?.screenshot) {
            finalPreview = {
              sessionId,
              tabId: 0,
              url: cached.url || '',
              title: cached.title || '',
              screenshot: cached.screenshot,
              lastUpdated: (cached as any).timestamp,
            } as any;
          }
        }
        trajectoryPersistence.markCompleted(
          sessionId,
          finalPreview,
          sessionMirrors.length > 1 ? sessionMirrors : undefined,
        );
      } catch {}

      this.notifyDashboard('agent-status-update', { agentId: task.id, status: 'completed' });
      this.emit('task-completed', task, {});
      this.updateBadge();
    } catch (error) {
      task.status = 'error';
      task.completedAt = Date.now();
      task.error = error instanceof Error ? error.message : String(error);
      this.queue.markCompleted(task.id);
      this.persistDashboardCompleted(task, 'failed');
      const errorSessionId = String(task.parentSessionId || task.id);
      this.mirrors.freezeSession(errorSessionId);

      // Mark trajectory as completed with error for regular tasks
      try {
        trajectoryPersistence.markCompleted(errorSessionId);
      } catch {}

      this.addTaskLog(task.id, `Error: ${task.error}`, 'error');
      this.notifyDashboard('agent-status-update', { agentId: task.id, status: 'error' });
      this.emit('task-error', task, error);
      this.updateBadge();

      try {
        errorLog.add({
          sessionId: String(task.parentSessionId || task.id),
          taskId: task.id,
          workerId: task.workerIndex,
          source: 'worker_failure',
          message: task.error || 'Task error',
        });
      } catch {}
    }

    await this.processQueue();
  }

  private async createExecutor(task: Task, browserContext: BrowserContext): Promise<Executor> {
    const providers = await getAllProvidersDecrypted();
    if (Object.keys(providers).length === 0) {
      throw new Error('Please configure API keys in the settings first');
    }

    const agentModels = await agentModelStore.getAllAgentModels();
    const navigatorModel = agentModels[AgentNameEnum.AgentNavigator];
    if (!navigatorModel) {
      throw new Error('Please choose a model for the navigator in the settings first');
    }

    const navigatorLLM = createChatModel(providers[navigatorModel.provider], navigatorModel);

    let plannerLLM: BaseChatModel | null = null;
    const plannerModel = agentModels[AgentNameEnum.AgentPlanner];
    if (plannerModel) {
      plannerLLM = createChatModel(providers[plannerModel.provider], plannerModel);
    }

    let validatorLLM: BaseChatModel | null = null;
    const validatorModel = agentModels[AgentNameEnum.AgentValidator];
    if (validatorModel) {
      validatorLLM = createChatModel(providers[validatorModel.provider], validatorModel);
    }

    const firewall = await firewallStore.getFirewall();
    if (firewall.enabled) {
      browserContext.updateConfig({
        allowedUrls: firewall.allowList,
        deniedUrls: firewall.denyList,
      });
    }

    const settings = await generalSettingsStore.getSettings();
    this.tabMirrorService.setVisionEnabled(!!(settings.showTabPreviews ?? true));
    browserContext.updateConfig({
      minimumWaitPageLoadTime: settings.minWaitPageLoad / 1000.0,
      displayHighlights: settings.displayHighlights,
      viewportExpansion: settings.fullPageWindow ? -1 : 0,
    });

    return await createSingleAgentExecutor({
      prompt: task.prompt,
      sessionId: task.id,
    });
  }

  private async handleInitTab(task: Task, executor: Executor, browserContext: BrowserContext): Promise<void> {
    try {
      const createdTabId = browserContext.getAndClearNewTabCreated();
      if (typeof createdTabId !== 'number' || createdTabId <= 0) return;

      if (task.tabId && task.tabId !== createdTabId) {
        this.mirrors.stopMirroring(task.tabId);
      }

      task.tabId = createdTabId;
      await this.tabGroups.applyTabColor(createdTabId, task, this.tasks);

      const settings = await generalSettingsStore.getSettings();
      const visionEnabled = (settings.showTabPreviews ?? true) || settings.useVision;
      await this.mirrors.setupMirroring(task, createdTabId, executor, visionEnabled);

      this.emit('tab-created', {
        taskId: task.id,
        tabId: createdTabId,
        groupId: task.groupId,
        groupColorName: task.groupColorName,
        color: task.color,
      });
    } catch {}
  }

  private setupTaskEventHandlers(task: Task, executor: Executor): void {
    if ((executor as any).__taskManagerSubscribed) return;
    (executor as any).__taskManagerSubscribed = true;

    executor.subscribeExecutionEvents(async event => {
      if (event.state === ExecutionState.TASK_START) {
        this.prepareTokenTracking(event);
      }
      // Allow completion events through even if task status changed (race condition fix)
      const isCompletionEvent = [ExecutionState.TASK_OK, ExecutionState.TASK_FAIL, ExecutionState.TASK_CANCEL].includes(
        event.state,
      );

      if (event.state === ExecutionState.TASK_START && task.agentType === 'auto') {
        try {
          const detail = String(event.data?.details || '');
          task.agentType = this.inferAgentType(task, detail);
          this.persistDashboardRunning(task, detail);
        } catch {}
      }

      if (task.status !== 'running' && !isCompletionEvent) return;

      // CRITICAL: Update task status immediately when completion events arrive
      // This prevents a race condition where the agent manager sees stale status
      if (event.state === ExecutionState.TASK_OK) {
        task.status = 'completed';
        task.completedAt = Date.now();
      } else if (event.state === ExecutionState.TASK_FAIL) {
        task.status = 'error';
        task.completedAt = Date.now();
      } else if (event.state === ExecutionState.TASK_CANCEL) {
        task.status = 'cancelled';
        task.completedAt = Date.now();
      }

      if (event.state === ExecutionState.TAB_CREATED && event.data?.tabId) {
        await this.handleTabCreated(task, executor, event.data.tabId);
      }

      await this.handleFlashing(task, event);
      this.logTaskEvent(task, event);
      await this.forwardEventToPanel(task, event);
      this.handleTaskCompletion(task, event);
    });
  }

  private async handleTabCreated(task: Task, executor: Executor, tabId: number): Promise<void> {
    if (!(await tabExists(tabId))) return; // Tab closed before setup

    if (task.tabId && task.tabId !== tabId) {
      this.mirrors.stopMirroring(task.tabId);
    }
    task.tabId = tabId;

    await this.tabGroups.applyTabColor(tabId, task, this.tasks);

    const settings = await generalSettingsStore.getSettings();
    const visionEnabled = (settings.showTabPreviews ?? true) || settings.useVision;
    await this.mirrors.setupMirroring(task, tabId, executor, visionEnabled);
    // Ensure mirror has the updated color from applyTabColor
    this.tabMirrorService.updateMirrorColor(tabId, task.color);

    this.notifyDashboard('agent-status-update', { agentId: task.id, status: 'running', tabId });

    chrome.tabs.get(tabId, tab => {
      if (!chrome.runtime.lastError) {
        this.notifyDashboard('active-tab-update', {
          tabId,
          url: tab.url || '',
          title: tab.title || '',
        });
      }
    });

    this.emit('tab-created', {
      taskId: task.id,
      tabId,
      groupId: task.groupId,
      groupColorName: task.groupColorName,
      color: task.color,
    });
  }

  private async handleFlashing(task: Task, event: any): Promise<void> {
    const tId = event.data?.tabId || task.tabId;
    if (!tId) return;

    if (event.state === ExecutionState.TASK_PAUSE) {
      await startPageFlash(tId);
    }

    if (
      [
        ExecutionState.TASK_RESUME,
        ExecutionState.TASK_OK,
        ExecutionState.TASK_FAIL,
        ExecutionState.TASK_CANCEL,
      ].includes(event.state)
    ) {
      await stopPageFlash(tId);
    }
  }

  private logTaskEvent(task: Task, event: any): void {
    if (event.state === ExecutionState.ACT_START && event.data?.action) {
      this.addTaskLog(task.id, `Performing: ${event.data.action}`, 'action');
    }
    if (event.data?.message) {
      this.addTaskLog(task.id, event.data.message, 'info');
    }
  }

  private async forwardEventToPanel(task: Task, event: any): Promise<void> {
    const sessionId = task.parentSessionId || task.id;
    const hasWorkerIndex = typeof task.workerIndex === 'number' && task.workerIndex > 0;
    const incomingWorkerId = event?.data?.workerId;
    const workerFields =
      incomingWorkerId != null
        ? {}
        : hasWorkerIndex
          ? { workerId: task.workerIndex, ...(hasWorkerIndex ? { workerIndex: task.workerIndex } : {}) }
          : {};
    const enrichedData = {
      ...event.data,
      agentColor: task.color,
      agentName: task.name,
      parentSessionId: task.parentSessionId,
      sessionId,
      ...workerFields,
      // CRITICAL: Include taskId for panel to filter events by session
      // The panel uses taskId to determine if an event belongs to the current session
      taskId: sessionId,
    };

    const eventId = this.buildEventId(sessionId, event, enrichedData);
    if (eventId) (enrichedData as any).eventId = eventId;

    if (this.isTerminalEvent(event)) {
      const summary = this.buildTaskSummary(event);
      if (summary) {
        (enrichedData as any).summary = summary;
        (enrichedData as any).message = JSON.stringify({ type: 'job_summary', data: summary });
        try {
          void this.queueStreamSummary(sessionId, summary);
        } catch {}
      }
    }

    try {
      void this.handleStreamingPersistence(String(sessionId), event, enrichedData);
    } catch {}

    // Persist trajectory BEFORE forwarding (ensures background workflows are recorded)
    try {
      trajectoryPersistence.processEvent(sessionId, { ...event, data: enrichedData, eventId });
    } catch (e) {
      console.error('[TaskManager] Failed to persist trajectory:', e);
    }

    const outbound = {
      type: EventType.EXECUTION,
      actor: event.actor,
      state: event.state,
      data: enrichedData,
      timestamp: event.timestamp,
      eventId,
    };

    this.bufferEvent(sessionId, outbound);

    // Forward to panel
    if (!this.sidePanelPort) return;
    try {
      this.sidePanelPort.postMessage(outbound);
    } catch {}
  }

  private propagateGroupId(task: Task, executor: Executor): void {
    try {
      if (typeof task.groupId === 'number' && task.groupId >= 0) {
        const ctx = (executor as any).getBrowserContext?.();
        ctx?.setPreferredGroupId?.(task.groupId);
      }
    } catch {}
  }

  private addTaskLog(taskId: string, message: string, type: 'info' | 'action' | 'error' = 'info'): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.logs.push({ timestamp: Date.now(), message, type });
    this.notifyDashboard('agent-log', { agentId: taskId, message, type });
  }

  private notifyDashboard(type: string, data: any): void {
    try {
      this.dashboardPort?.postMessage({ type, data });
    } catch {
      this.dashboardPort = undefined;
    }
  }

  setDashboardPort(port: chrome.runtime.Port | undefined): void {
    this.dashboardPort = port;
    this.tabMirrorService.setDashboardPort(port);
  }

  setSidePanelPort(port: chrome.runtime.Port | undefined): void {
    this.sidePanelPort = port;
    this.mirrors.setSidePanelPort(port);
    this.workers.setSidePanelPort(port);
    this.tabGroups.setSidePanelPort(port);

    if (port) {
      const latestMirror = this.mirrors.getLatestMirror();
      if (latestMirror) {
        safePostMessage(port, { type: 'tab-mirror-update', data: latestMirror });
      }
    }
  }

  async createWorkerSession(
    initialPrompt: string,
    prettyName?: string,
    parentSessionId?: string,
    messageContext?: string,
    workerIndex?: number,
  ): Promise<string> {
    const taskId = await this.createTask(initialPrompt, prettyName, true, undefined, parentSessionId, workerIndex);
    const task = this.tasks.get(taskId)!;
    task.status = 'running';
    task.startedAt = Date.now();
    task.workerIndex = workerIndex;
    this.queue.markRunning(taskId);

    await this.workers.createSession(task, initialPrompt, {
      parentSessionId,
      messageContext,
      workerIndex,
    });

    this.notifyDashboard('agent-status-update', { agentId: task.id, status: 'running' });
    this.emit('task-started', task);
    return taskId;
  }

  async runWorkerSubtask(
    taskId: string,
    prompt: string,
    targetTabIds?: number[],
    subtaskId?: number,
  ): Promise<{ ok: boolean; error?: string; outputText?: string; tabIds?: number[] }> {
    return await this.workers.runSubtask(taskId, prompt, { targetTabIds, subtaskId });
  }

  async endWorkerSession(
    taskId: string,
    finalStatus: 'completed' | 'cancelled' | 'error' = 'completed',
  ): Promise<void> {
    await this.workers.endSession(taskId, finalStatus);

    const task = this.tasks.get(taskId);
    if (task) {
      this.queue.markCompleted(taskId);
      this.notifyDashboard('agent-status-update', { agentId: task.id, status: task.status });
      if (finalStatus === 'error') {
        this.emit('task-error', task, new Error('Worker session error'));
      } else {
        this.emit('task-completed', task, {});
      }
    }
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  async cancelAllForParentSession(parentSessionId: string): Promise<void> {
    const targets: string[] = [];
    for (const task of this.tasks.values()) {
      const isParent = String(task.parentSessionId || task.id) === String(parentSessionId);
      if (isParent || String(task.id) === String(parentSessionId)) {
        targets.push(task.id);
      }
    }
    for (const id of targets) {
      await this.cancelTask(id);
    }
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getTaskByTabId(tabId: number): Task | undefined {
    return Array.from(this.tasks.values()).find(t => t.tabId === tabId);
  }

  getRunningTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'running');
  }

  getPendingTasks(): Task[] {
    return this.queue
      .getPendingIds()
      .map(id => this.tasks.get(id)!)
      .filter(Boolean);
  }

  getAllMirrors(): any[] {
    return this.mirrors.getAllMirrors();
  }

  getActiveMirrors(): any[] {
    return this.mirrors.getActiveMirrors();
  }

  getLatestMirror(): any | null {
    return this.mirrors.getLatestMirror();
  }

  async stopAllMirrorsForSession(_sessionId: string): Promise<void> {
    const mirrors = this.mirrors.getAllMirrors();
    for (const m of mirrors) {
      if (typeof (m as any)?.tabId === 'number') {
        this.mirrors.stopMirroring((m as any).tabId);
      }
    }
  }

  getActiveTabInfo(): { tabId: number; url: string; title: string } | null {
    for (const task of this.tasks.values()) {
      if (task.status === 'running' && task.tabId) {
        return { tabId: task.tabId, url: '', title: task.name };
      }
    }
    return null;
  }

  async forwardInteraction(tabId: number, interaction: any): Promise<void> {
    return this.tabMirrorService.forwardInteraction(tabId, interaction);
  }

  async assignGroup(taskId: string, groupId: number, colorName?: chrome.tabGroups.Color): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    await this.tabGroups.assignGroup(task, groupId, colorName);
  }

  async pauseMirroring(tabId: number, ms: number = 3000): Promise<void> {
    const task = Array.from(this.tasks.values()).find(t => t.tabId === tabId);
    if (task) {
      await this.mirrors.pauseAndResume(tabId, task, ms);
    }
  }

  setSingleAgentExecutor(
    taskId: string,
    executor: Executor,
    tabId: number,
    forceNewGroup?: boolean,
    onExecutorFinished?: () => void,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.executor = executor;
    task.tabId = tabId;
    task.status = 'running';
    task.startedAt = Date.now();
    task.mirroringStarted = false;
    if (onExecutorFinished) task.onExecutorFinished = onExecutorFinished;
    if (forceNewGroup) task.groupId = undefined;

    this.persistDashboardRunning(task);

    this.propagateGroupId(task, executor);

    if (tabId > 0) {
      this.mirrors.stopMirroring(tabId);
      this.setupSingleAgentMirroring(task, executor, tabId);
    }

    this.setupSingleAgentEventHandlers(task, executor, tabId);
    this.notifyDashboard('agent-status-update', { agentId: task.id, status: 'running', tabId });
    this.emit('task-started', task);
    this.updateBadge();
  }

  private setupSingleAgentMirroring(task: Task, executor: Executor, tabId: number): void {
    this.tabMirrorService.registerScreenshotProvider(tabId, async () => {
      try {
        const data = await executor.captureCurrentPageScreenshot();
        return data ? `data:image/jpeg;base64,${data}` : undefined;
      } catch {
        return undefined;
      }
    });

    this.tabGroups
      .applyTabColor(tabId, task, this.tasks)
      .then(() => {
        try {
          this.tabMirrorService.startMirroring(
            tabId,
            task.id,
            task.color,
            task.parentSessionId || task.id,
            task.workerIndex,
          );
          // Ensure mirror has the updated color from applyTabColor
          this.tabMirrorService.updateMirrorColor(tabId, task.color);
          task.mirroringStarted = true;

          if (this.sidePanelPort) {
            setTimeout(() => {
              const mirrors = this.tabMirrorService.getCurrentMirrors();
              const mirrorData = mirrors.find((m: any) => m.tabId === tabId);
              if (mirrorData) {
                const sessionId = task.parentSessionId || task.id;
                this.sidePanelPort?.postMessage({
                  type: 'tab-mirror-update',
                  data: { ...mirrorData, sessionId },
                });
              }
            }, 500);
          }
        } catch {}
      })
      .catch(() => {});
  }

  private setupSingleAgentEventHandlers(task: Task, executor: Executor, tabId: number): void {
    if ((executor as any).__taskManagerSubscribed) return;
    (executor as any).__taskManagerSubscribed = true;

    executor.subscribeExecutionEvents(async event => {
      if (event.state === ExecutionState.TASK_START) {
        this.prepareTokenTracking(event);
      }
      if (event.state === ExecutionState.TAB_CREATED && event.data?.tabId) {
        await this.handleSingleAgentTabCreated(task, executor, event.data.tabId);
      }

      await this.handleFlashing(task, event);
      this.logTaskEvent(task, event);
      await this.forwardEventToPanel(task, event); // Added: persist trajectory events
      this.handleTaskCompletion(task, event);
    });
  }

  private async handleSingleAgentTabCreated(task: Task, executor: Executor, newTabId: number): Promise<void> {
    if (task.status !== 'running') return;
    if (!(await tabExists(newTabId))) return; // Tab closed before setup

    if (task.tabId && task.tabId !== newTabId) {
      this.mirrors.stopMirroring(task.tabId);
    }
    task.tabId = newTabId;

    await this.tabGroups.applyTabColor(newTabId, task, this.tasks);

    this.tabMirrorService.registerScreenshotProvider(newTabId, async () => {
      try {
        const data = await executor.captureTabScreenshot(newTabId);
        return data ? `data:image/jpeg;base64,${data}` : undefined;
      } catch {
        return undefined;
      }
    });

    this.tabMirrorService.startMirroring(
      newTabId,
      task.id,
      task.color,
      task.parentSessionId || task.id,
      task.workerIndex,
    );
    // Ensure mirror has the updated color from applyTabColor
    this.tabMirrorService.updateMirrorColor(newTabId, task.color);
    task.mirroringStarted = true;

    if (this.sidePanelPort) {
      setTimeout(async () => {
        if (!(await tabExists(newTabId))) return; // Tab closed
        const mirrors = this.tabMirrorService.getCurrentMirrors();
        const mirrorData = mirrors.find((m: any) => m.tabId === newTabId);
        if (mirrorData) {
          const sessionId = task.parentSessionId || task.id;
          this.sidePanelPort?.postMessage({ type: 'tab-mirror-update', data: { ...mirrorData, sessionId } });
        }
      }, 1000);
    }
  }

  private handleTaskCompletion(task: Task, event: any): void {
    if (![ExecutionState.TASK_OK, ExecutionState.TASK_FAIL, ExecutionState.TASK_CANCEL].includes(event.state)) {
      return;
    }

    task.status =
      event.state === ExecutionState.TASK_OK
        ? 'completed'
        : event.state === ExecutionState.TASK_CANCEL
          ? 'cancelled'
          : 'error';
    task.completedAt = Date.now();

    const sessionId = String(task.parentSessionId || task.id);

    // IMPORTANT: Get mirrors BEFORE freezing (freezing removes them from active list)
    let sessionMirrors: any[] = [];
    try {
      const allMirrors = this.mirrors.getAllMirrors();
      sessionMirrors = allMirrors.filter((m: any) => m.sessionId === sessionId);
    } catch {}

    this.mirrors.freezeSession(sessionId);

    // Mark trajectory as completed with captured mirrors
    try {
      trajectoryPersistence.markCompleted(
        sessionId,
        sessionMirrors[0],
        sessionMirrors.length > 1 ? sessionMirrors : undefined,
      );
    } catch {}

    // Generate smart title after task completes
    if (event.state === ExecutionState.TASK_OK && this.isPrimarySession(task)) {
      this.generateSmartTitle(sessionId, task);
    }

    this.notifyDashboard('agent-status-update', { agentId: task.id, status: task.status });
    this.updateBadge();
    try {
      task.executor?.cleanup?.();
    } catch {}
    try {
      task.onExecutorFinished?.();
    } catch {}
  }

  private prepareTokenTracking(event: any): void {
    try {
      const taskId: string | undefined = (event as any)?.data?.taskId;
      if (!taskId) return;
      try {
        const existing = (globalTokenTracker as any)?.getTokensForTask?.(String(taskId)) || [];
        if (existing.length > 0) {
          sessionLogArchive.append(String(taskId), existing);
        }
      } catch {}
      try {
        (globalTokenTracker as any)?.clearTokensForTask?.(String(taskId));
      } catch {}
      try {
        (globalTokenTracker as any)?.setCurrentTaskId?.(String(taskId));
      } catch {}
    } catch {}
  }

  private isTerminalEvent(event: any): boolean {
    const state = String(event?.state || '');
    return (
      state === ExecutionState.TASK_OK || state === ExecutionState.TASK_FAIL || state === ExecutionState.TASK_CANCEL
    );
  }

  private buildTaskSummary(event: any): any | null {
    try {
      const taskId: string | undefined = (event as any)?.data?.taskId;
      if (!taskId) return null;
      const usages = ((globalTokenTracker as any)?.getTokensForTask?.(taskId) || []).sort(
        (a: any, b: any) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0),
      );
      if (!Array.isArray(usages) || usages.length === 0) return null;
      try {
        sessionLogArchive.append(String(taskId), usages);
      } catch {}
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
      const apiCallCount = usages.length;
      const last = usages[usages.length - 1] || {};
      const provider = last.provider || 'Unknown';
      const modelName = last.modelName || 'unknown';
      let totalLatencyMs = 0;
      try {
        const completionTimes = usages
          .map((u: any) => Number(u?.timestamp || 0))
          .filter((n: number) => Number.isFinite(n) && n > 0);
        const startTimes = usages
          .map((u: any) => Number(u?.requestStartTime || u?.timestamp || 0))
          .filter((n: number) => Number.isFinite(n) && n > 0);
        if (startTimes.length > 0 && completionTimes.length > 0) {
          totalLatencyMs = Math.max(0, Math.max(...completionTimes) - Math.min(...startTimes));
        } else if (completionTimes.length >= 2) {
          completionTimes.sort((a, b) => a - b);
          totalLatencyMs = completionTimes[completionTimes.length - 1] - completionTimes[0];
        }
      } catch {}
      return {
        totalInputTokens,
        totalOutputTokens,
        totalLatencyMs,
        totalLatencySeconds: (totalLatencyMs / 1000).toFixed(2),
        totalCost,
        apiCallCount,
        provider,
        modelName,
      } as const;
    } catch {
      return null;
    }
  }

  private buildEventId(sessionId: string, event: any, data: any): string {
    const sid = String(sessionId || '');
    const actor = String(event?.actor || '');
    const state = String(event?.state || '');
    const timestamp = Number(event?.timestamp || 0);
    const streamId = String(data?.streamId || '');
    const step = String(data?.step ?? '');
    const workerId = String(data?.workerId ?? data?.workerIndex ?? '');
    const details = String(data?.details ?? data?.message ?? '');
    const raw = `${sid}|${actor}|${state}|${timestamp}|${streamId}|${step}|${workerId}|${details}`;
    let hash = 5381;
    for (let i = 0; i < raw.length; i += 1) {
      hash = (hash * 33) ^ raw.charCodeAt(i);
    }
    const hashed = (hash >>> 0).toString(36);
    return `${sid}:${timestamp}:${hashed}`;
  }

  private bufferEvent(sessionId: string, event: any): void {
    if (this.eventBufferMaxSize <= 0) return;
    const sid = String(sessionId || '');
    if (!sid) return;
    const list = this.eventBufferBySession.get(sid) || [];
    const eventId = String(event?.eventId || event?.data?.eventId || '');
    if (eventId && list.some(e => String(e?.eventId || e?.data?.eventId || '') === eventId)) {
      return;
    }
    list.push(event);
    if (list.length > this.eventBufferMaxSize) {
      list.splice(0, list.length - this.eventBufferMaxSize);
    }
    this.eventBufferBySession.set(sid, list);
  }

  private async persistStreamSummary(sessionId: string, summary: any): Promise<void> {
    try {
      const sid = String(sessionId);
      let messageId = '';
      const last = this.lastStreamMessageBySession.get(sid);
      if (last) {
        messageId = `${last.timestamp}-${last.actor}`;
      } else {
        try {
          const session = await chatHistoryStore.getSession(sid);
          const messages = session?.messages || [];
          const lastMsg =
            [...messages].reverse().find(m => m.actor === Actors.CHAT || m.actor === Actors.SEARCH) || undefined;
          if (lastMsg && (lastMsg.actor === Actors.CHAT || lastMsg.actor === Actors.SEARCH)) {
            messageId = `${lastMsg.timestamp}-${lastMsg.actor}`;
          }
        } catch {}
      }
      if (!messageId) return;
      const existing = await chatHistoryStore.loadRequestSummaries(sessionId).catch(() => ({}));
      if ((existing as any)?.[messageId]) return;
      const requestSummary = {
        inputTokens: Number(summary.totalInputTokens) || 0,
        outputTokens: Number(summary.totalOutputTokens) || 0,
        latency: summary.totalLatencySeconds?.toString?.() || '0.00',
        cost: Number(summary.totalCost) || 0,
        apiCalls: Number(summary.apiCallCount) || 0,
        modelName: summary.modelName,
        provider: summary.provider,
      };
      await chatHistoryStore.storeRequestSummaries(sessionId, { ...(existing || {}), [messageId]: requestSummary });
    } catch (e) {
      this.logger.error('[TaskManager] Failed to persist stream summary:', e);
    }
  }

  private async queueStreamSummary(sessionId: string, summary: any): Promise<void> {
    try {
      const sid = String(sessionId);
      if (!sid) return;
      const last = this.lastStreamMessageBySession.get(sid);
      if (!last) {
        this.pendingStreamSummaries.set(sid, summary);
        return;
      }
      await this.persistStreamSummary(sid, summary);
    } catch (e) {
      this.logger.error('[TaskManager] Failed to queue stream summary:', e);
    }
  }

  private async handleStreamingPersistence(sessionId: string, event: any, data: any): Promise<void> {
    try {
      if (event?.state !== ExecutionState.STEP_STREAMING) return;
      const actor = String(event?.actor || data?.actor || '');
      if (actor !== Actors.CHAT && actor !== Actors.SEARCH) return;
      const streamId = String(data?.streamId || '');
      if (!streamId) return;
      const key = `${sessionId}:${streamId}`;
      const chunk = String(data?.details ?? data?.message ?? '');
      const isFinal = data?.isFinal === true;
      const existing = this.streamBuffers.get(key) || {
        sessionId,
        actor,
        content: '',
        timestamp: Number(event?.timestamp || Date.now()),
        finalized: false,
      };
      const next = {
        ...existing,
        content: existing.content + (chunk || ''),
        timestamp: existing.timestamp || Number(event?.timestamp || Date.now()),
      };
      if (isFinal) {
        if (next.finalized) return;
        next.finalized = true;
        this.streamBuffers.delete(key);
        const trimmed = String(next.content || '').trim();
        if (!trimmed) return;
        const messageKey = `${sessionId}:${actor}:${trimmed}`;
        if (this.streamMessageKeys.has(messageKey)) return;
        let exists = false;
        try {
          const session = await chatHistoryStore.getSession(sessionId);
          exists = !!session?.messages?.some(
            m => String(m.actor || '') === actor && String(m.content || '').trim() === trimmed,
          );
        } catch {}
        if (!exists) {
          try {
            await chatHistoryStore.addMessage(sessionId, {
              actor,
              content: trimmed,
              timestamp: next.timestamp,
            } as any);
          } catch (e) {
            this.logger.error('[TaskManager] Failed to persist streamed message:', e);
          }
        }
        this.lastStreamMessageBySession.set(sessionId, { actor, timestamp: next.timestamp });
        try {
          const pending = this.pendingStreamSummaries.get(String(sessionId));
          if (pending) {
            this.pendingStreamSummaries.delete(String(sessionId));
            await this.persistStreamSummary(sessionId, pending);
          }
        } catch {}
        this.streamMessageKeys.add(messageKey);
        if (this.streamMessageKeys.size > 2000) {
          let removed = 0;
          for (const k of this.streamMessageKeys) {
            this.streamMessageKeys.delete(k);
            removed += 1;
            if (removed >= 500) break;
          }
        }
        return;
      }
      this.streamBuffers.set(key, next);
    } catch (e) {
      this.logger.error('[TaskManager] handleStreamingPersistence failed:', e);
    }
  }

  /**
   * Get the trajectory root ID for a session (for panel to use when restoring)
   */
  getTrajectoryRootId(sessionId: string): string | null {
    return trajectoryPersistence.getRootId(sessionId);
  }

  /**
   * Get the trajectory persistence service (for direct access if needed)
   */
  get trajectoryService() {
    return trajectoryPersistence;
  }
}
