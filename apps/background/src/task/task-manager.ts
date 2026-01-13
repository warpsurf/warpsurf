import { EventEmitter } from '../utils/event-emitter';
import { safePostMessage, startPageFlash, stopPageFlash } from '@extension/shared/lib/utils';
import { Executor } from '../executor/executor';
import { createSingleAgentExecutor } from './executor-factory';
import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { createChatModel } from '../workflows/models/factory';
import { agentModelStore, AgentNameEnum, firewallStore, generalSettingsStore } from '@extension/storage';
import { getAllProvidersDecrypted } from '../crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ExecutionState, EventType } from '../workflows/shared/event/types';
import { TabMirrorService } from '../tabs/tab-mirror';
import { errorLog } from '../utils/error-log';
import { TaskQueue } from './task-queue';
import { TabGroupService } from './tab-group-service';
import { MirrorCoordinator } from './mirror-coordinator';
import { WorkerSessionManager } from './worker-session-manager';
import { tabExists } from '../utils';

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
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  logs: Array<{ timestamp: number; message: string; type: 'info' | 'action' | 'error' }>;
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

  /** Update extension badge to show running task count */
  private updateBadge(): void {
    const running = this.getRunningTasks().length;
    this.logger.info(`Updating badge: ${running} running tasks`);
    chrome.action.setBadgeText({ text: running > 0 ? String(running) : '' });
    chrome.action.setBadgeBackgroundColor({ color: running > 0 ? '#22c55e' : '#666' });
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
      this.mirrors.freezeSession(String(task.parentSessionId || task.id));
      this.notifyDashboard('agent-status-update', { agentId: task.id, status: 'completed' });
      this.emit('task-completed', task, {});
      this.updateBadge();
    } catch (error) {
      task.status = 'error';
      task.completedAt = Date.now();
      task.error = error instanceof Error ? error.message : String(error);
      this.queue.markCompleted(task.id);
      this.mirrors.freezeSession(String(task.parentSessionId || task.id));
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
    const navigatorModel = agentModels[AgentNameEnum.Navigator];
    if (!navigatorModel) {
      throw new Error('Please choose a model for the navigator in the settings first');
    }

    const navigatorLLM = createChatModel(providers[navigatorModel.provider], navigatorModel);

    let plannerLLM: BaseChatModel | null = null;
    const plannerModel = agentModels[AgentNameEnum.Planner];
    if (plannerModel) {
      plannerLLM = createChatModel(providers[plannerModel.provider], plannerModel);
    }

    let validatorLLM: BaseChatModel | null = null;
    const validatorModel = agentModels[AgentNameEnum.Validator];
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
      if (task.status !== 'running') return;

      if (event.state === ExecutionState.TAB_CREATED && event.data?.tabId) {
        await this.handleTabCreated(task, executor, event.data.tabId);
      }

      await this.handleFlashing(task, event);
      this.logTaskEvent(task, event);
      this.forwardEventToPanel(task, event);
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

  private forwardEventToPanel(task: Task, event: any): void {
    try {
      if (!this.sidePanelPort) return;

      this.sidePanelPort.postMessage({
        type: EventType.EXECUTION,
        actor: event.actor,
        state: event.state,
        data: {
          ...event.data,
          agentColor: task.color,
          agentName: task.name,
          workerId: task.id,
          parentSessionId: task.parentSessionId,
          sessionId: task.parentSessionId || task.id,
        },
        timestamp: event.timestamp,
      });
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

  setSingleAgentExecutor(taskId: string, executor: Executor, tabId: number, forceNewGroup?: boolean): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.executor = executor;
    task.tabId = tabId;
    task.status = 'running';
    task.startedAt = Date.now();
    task.mirroringStarted = false;
    if (forceNewGroup) task.groupId = undefined;

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
      if (event.state === ExecutionState.TAB_CREATED && event.data?.tabId) {
        await this.handleSingleAgentTabCreated(task, executor, event.data.tabId);
      }

      await this.handleFlashing(task, event);
      this.logTaskEvent(task, event);
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

    this.mirrors.freezeSession(String(task.parentSessionId || task.id));
    this.notifyDashboard('agent-status-update', { agentId: task.id, status: task.status });
    this.updateBadge();
  }
}
