import { createLogger } from '../log';
import type { Task } from './task-manager';
import type { Executor } from '../executor/executor';
import type { MirrorCoordinator } from './mirror-coordinator';
import type { TabGroupService } from './tab-group-service';
import type { SharedTabRegistry } from './shared-tab-registry';
import { createWorkerExecutor } from './executor-factory';
import { generalSettingsStore, AgentNameEnum } from '@extension/storage';
import { CrewPrompt } from '@src/workflows/multiagent/roles/crew-prompt';
import { ExecutionState } from '../workflows/shared/event/types';
import { globalTokenTracker } from '../utils/token-tracker';

interface WorkerSession {
  executor: Executor;
  started: boolean;
}

interface CaptureWindow {
  active: boolean;
  tabIds: Set<number>;
  messages: string[];
  doneTexts: string[];
  lastActionWasDone?: boolean;
}

export class WorkerSessionManager {
  private logger = createLogger('WorkerSessionManager');
  private sessions = new Map<string, WorkerSession>();
  private captures = new Map<string, CaptureWindow>();
  private onForwardEvent?: (task: Task, event: any) => Promise<void>;
  private tabRegistry?: SharedTabRegistry;
  private activeSubtaskBySession = new Map<string, number>();

  constructor(
    private getTasks: () => Map<string, Task>,
    private mirrors: MirrorCoordinator,
    private tabGroups: TabGroupService,
  ) {}

  setForwardEventHandler(handler: (task: Task, event: any) => Promise<void>): void {
    this.onForwardEvent = handler;
  }

  setSharedTabRegistry(registry: SharedTabRegistry): void {
    this.tabRegistry = registry;
    // Retroactively register tabs from warm-started sessions that were
    // already running before the registry existed.
    for (const [taskId, subtaskId] of this.activeSubtaskBySession) {
      const task = this.getTasks().get(taskId);
      if (!task || typeof task.workerIndex !== 'number') continue;
      const ctx = (task.executor as any)?.getBrowserContext?.();
      const owned: ReadonlySet<number> | undefined = ctx?.getOwnedTabIds?.();
      if (owned) {
        for (const tabId of owned) {
          registry.register(tabId, subtaskId, task.workerIndex);
        }
      }
    }
  }

  async createSession(
    task: Task,
    initialPrompt: string,
    options: {
      parentSessionId?: string;
      messageContext?: string;
      workerIndex?: number;
    },
  ): Promise<void> {
    const settings = await generalSettingsStore.getSettings();
    const workerPrompt = new CrewPrompt(
      settings.maxActionsPerStep,
      settings.preferredRegion,
      settings.useVision,
      settings.enableCoordinateClick ?? false,
      settings.defaultSearchEngine,
    );
    const executor = await createWorkerExecutor({
      prompt: initialPrompt,
      sessionId: task.id,
      workerModelPrefers: AgentNameEnum.MultiagentWorker,
      systemMessageOverride: workerPrompt.getSystemMessage(),
      messageContext: options.messageContext,
    });

    if (options.workerIndex != null) {
      (executor as any).__workerIndex = options.workerIndex;
    }

    task.executor = executor;

    await this.tabGroups.createGroupForWorker(task, this.getTasks());
    this.propagateGroupId(task);

    this.setupTokenTracking(task.id, options.workerIndex, options.parentSessionId);

    try {
      await executor.initialize();
    } catch (e) {
      this.logger.error('Worker init failed', e);
    }

    this.setupEventHandlers(task, settings);
    await this.handleInitTab(task, executor, settings);

    this.sessions.set(task.id, { executor, started: false });
  }

  async runSubtask(
    taskId: string,
    prompt: string,
    options: {
      targetTabIds?: number[];
      subtaskId?: number;
    },
  ): Promise<{ ok: boolean; error?: string; outputText?: string; tabIds?: number[] }> {
    const task = this.getTasks().get(taskId);
    if (!task?.executor) return { ok: false, error: 'Session not found' };

    const session = this.sessions.get(taskId);
    if (!session) return { ok: false, error: 'Session missing' };

    if (typeof options.subtaskId === 'number') {
      this.activeSubtaskBySession.set(taskId, options.subtaskId);
    }

    this.bindTabRegistryToContext(task);

    try {
      this.startCapture(taskId);
      this.setupSubtaskTracking(taskId, options.subtaskId);
      await this.adoptTargetTabs(task.executor, options.targetTabIds);
      task.executor.addFollowUpTask(prompt, 'agent');
      session.started = true;
      await task.executor.execute();
      return this.extractOutput(taskId, task);
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    } finally {
      await this.releaseSubtaskTabs(taskId, task);
    }
  }

  async endSession(taskId: string, finalStatus: 'completed' | 'cancelled' | 'error'): Promise<void> {
    const task = this.getTasks().get(taskId);
    if (!task) return;

    if (finalStatus === 'cancelled' && task.executor) {
      try {
        await task.executor.cancel();
      } catch {}
    }

    // Cleanup executor (detaches debugger) for all final statuses
    try {
      await (task.executor as any)?.cleanup?.();
    } catch {}

    this.sessions.delete(taskId);
    task.status = finalStatus;
    task.completedAt = Date.now();

    try {
      task.executor && (task.executor as any).clearExecutionEvents?.();
    } catch {}

    this.endCapture(taskId);
    this.mirrors.freezeTab(task.tabId);
    this.mirrors.freezeSession(String(task.id));
  }

  private setupTokenTracking(taskId: string, workerIndex?: number, parentSessionId?: string): void {
    try {
      (globalTokenTracker as any)?.setCurrentTaskId?.(taskId);
      (globalTokenTracker as any)?.setCurrentRole?.('worker');
    } catch {}

    if (workerIndex !== undefined && globalTokenTracker) {
      try {
        if (typeof (globalTokenTracker as any).registerWorkerSession === 'function') {
          (globalTokenTracker as any).registerWorkerSession(taskId, workerIndex);
        }
        if (parentSessionId && typeof (globalTokenTracker as any).linkWorkerToParentSession === 'function') {
          (globalTokenTracker as any).linkWorkerToParentSession(taskId, String(parentSessionId));
        }
      } catch {}
    }
  }

  private setupSubtaskTracking(taskId: string, subtaskId?: number): void {
    try {
      (globalTokenTracker as any)?.setCurrentTaskId?.(taskId);
      (globalTokenTracker as any)?.setCurrentRole?.('worker');
      (globalTokenTracker as any)?.setCurrentSubtaskId?.(typeof subtaskId === 'number' ? subtaskId : null);
    } catch {}
  }

  /**
   * Best-effort adoption of dependency tabs. Tabs are NOT pre-registered as owned;
   * the SharedTabRegistry gate (canAccess) must pass first. If the tab is held by
   * another crew or unavailable, we skip immediately — never block or force-detach.
   */
  private async adoptTargetTabs(executor: Executor, targetTabIds?: number[]): Promise<void> {
    if (!Array.isArray(targetTabIds) || targetTabIds.length === 0) return;

    const ctx = (executor as any).getBrowserContext?.();
    if (!ctx) return;

    for (let i = targetTabIds.length - 1; i >= 0; i--) {
      const id = Number(targetTabIds[i]);
      try {
        const tab = await chrome.tabs.get(id).catch(() => null);
        if (!tab) continue;
        await ctx.switchTab(id);
        this.logger.info(`[adoptTargetTabs] Switched to dependency tab ${id} (url=${tab.url})`);
        return;
      } catch {
        this.logger.info(`[adoptTargetTabs] Tab ${id} unavailable, skipping`);
      }
    }
    this.logger.info('[adoptTargetTabs] No dependency tabs available — worker will use own tab');
  }

  private setupEventHandlers(task: Task, settings: any): void {
    if ((task.executor as any).__taskManagerSubscribed) return;
    (task.executor as any).__taskManagerSubscribed = true;

    task.executor!.subscribeExecutionEvents(async event => {
      if (event.state === ExecutionState.TAB_CREATED && event.data?.tabId) {
        const tabId = Number(event.data.tabId);
        this.registerTabInRegistry(task, tabId);
        const visionEnabled = (settings.showTabPreviews ?? true) || !!settings.useVision;
        if (typeof task.groupId !== 'number' || task.groupId < 0) {
          await this.tabGroups.assignTabToWorkerGroup(tabId, task, this.getTasks());
        } else {
          await this.tabGroups.applyTabColor(tabId, task, this.getTasks());
        }
        await this.mirrors.setupMirroring(task, tabId, task.executor!, visionEnabled);
      }

      if (task.status === 'running') {
        this.captureEvent(task.id, event);
      }

      // Don't forward TASK_START boilerplate from worker executors — crew
      // deployment is handled by multiagent workflow progress events.
      if (event.state === ExecutionState.TASK_START) return;

      try {
        await this.onForwardEvent?.(task, event);
      } catch {}
    });
  }

  private async handleInitTab(task: Task, executor: Executor, settings: any): Promise<void> {
    try {
      const ctx = (executor as any)?.getBrowserContext?.();
      const createdTabId = ctx?.getAndClearNewTabCreated?.();
      if (typeof createdTabId === 'number' && createdTabId > 0) {
        const visionEnabled = (settings.showTabPreviews ?? true) || !!settings.useVision;
        await this.tabGroups.applyTabColor(createdTabId, task, this.getTasks());
        await this.mirrors.setupMirroring(task, createdTabId, executor, visionEnabled);
      }
    } catch {}
  }

  private propagateGroupId(task: Task): void {
    try {
      if (typeof task.groupId === 'number' && task.groupId >= 0) {
        const ctx = (task.executor as any)?.getBrowserContext?.();
        ctx?.setPreferredGroupId?.(task.groupId);
      }
    } catch {}
  }

  private bindTabRegistryToContext(task: Task): void {
    if (!this.tabRegistry) return;
    const ctx = (task.executor as any)?.getBrowserContext?.();
    if (!ctx?.setTabRegistryCallbacks) return;

    const registry = this.tabRegistry;
    const subtaskId = this.activeSubtaskBySession.get(task.id);
    const crewId = task.workerIndex ?? -1;
    if (subtaskId == null || crewId < 0) return;

    ctx.setTabRegistryCallbacks(
      (tabId: number) => registry.canAccess(tabId, subtaskId, crewId),
      (tabId: number) => registry.markHolder(tabId, crewId),
    );
  }

  private async releaseSubtaskTabs(taskId: string, task: Task): Promise<void> {
    const subtaskId = this.activeSubtaskBySession.get(taskId);
    const crewId = task.workerIndex;
    if (this.tabRegistry && typeof subtaskId === 'number' && typeof crewId === 'number') {
      this.tabRegistry.releaseCrewTabs(crewId, subtaskId);
    }
    this.activeSubtaskBySession.delete(taskId);
    const ctx = (task.executor as any)?.getBrowserContext?.();
    try {
      await ctx?.releaseAllDebuggers?.();
    } catch {}
    try {
      ctx?.setTabRegistryCallbacks?.(undefined, undefined);
    } catch {}
  }

  private registerTabInRegistry(task: Task, tabId: number): void {
    if (!this.tabRegistry) return;
    const subtaskId = this.activeSubtaskBySession.get(task.id);
    const crewId = task.workerIndex;
    if (typeof subtaskId === 'number' && typeof crewId === 'number') {
      this.tabRegistry.register(tabId, subtaskId, crewId);
    }
  }

  private startCapture(taskId: string): void {
    this.captures.set(taskId, {
      active: true,
      tabIds: new Set(),
      messages: [],
      doneTexts: [],
      lastActionWasDone: false,
    });
  }

  private endCapture(taskId: string): void {
    const cap = this.captures.get(taskId);
    if (cap) cap.active = false;
    this.captures.delete(taskId);
  }

  private captureEvent(taskId: string, event: any): void {
    const cap = this.captures.get(taskId);
    if (!cap || !cap.active) return;

    if (event.state === ExecutionState.TAB_CREATED && event.data?.tabId) {
      cap.tabIds.add(Number(event.data.tabId));
    }

    // Capture done action text directly from action results
    if (event.state === ExecutionState.STEP_OK || event.state === ExecutionState.TASK_OK) {
      this.captureDoneFromActionResults(taskId, cap);
    }

    let msg = '';
    if (event.state === ExecutionState.ACT_START && event.data?.action) {
      msg = `Action: ${event.data.action}`;
      cap.lastActionWasDone = /^(done)$/i.test(String(event.data.action));
    } else if (event.data?.message) {
      msg = event.data.message.toString();
    } else if (event.data?.details) {
      msg = event.data.details.toString();
    } else if ((event.data as any)?.content) {
      msg = (event.data as any).content.toString();
    }

    if (msg) {
      cap.messages.push(msg);
      this.captureCleanDone(cap, msg);
    }
  }

  private captureDoneFromActionResults(taskId: string, cap: CaptureWindow): void {
    try {
      const task = this.getTasks().get(taskId);
      const actionResults = (task?.executor as any)?.context?.actionResults || [];
      for (const r of actionResults) {
        if (r?.isDone && r?.extractedContent) {
          const text = String(r.extractedContent).trim();
          if (text && !cap.doneTexts.includes(text)) {
            cap.doneTexts.push(text);
          }
        }
      }
    } catch {}
  }

  private captureCleanDone(cap: CaptureWindow, message: string): void {
    if (!cap.lastActionWasDone) return;

    const txt = message.trim();
    const lower = txt.toLowerCase();
    const isNoise =
      lower === 'task completed successfully' ||
      lower.startsWith('task failed') ||
      lower === 'navigation done' ||
      lower === 'navigating...' ||
      /^action:\s*/i.test(txt);

    if (txt && !isNoise) {
      cap.doneTexts.push(txt);
      cap.lastActionWasDone = false;
    }
  }

  private extractOutput(taskId: string, task: Task): { ok: boolean; outputText?: string; tabIds?: number[] } {
    const cap = this.captures.get(taskId);
    if (!cap) {
      return { ok: true, outputText: '', tabIds: [] };
    }

    // Final attempt to capture done text from action results
    this.captureDoneFromActionResults(taskId, cap);

    // Priority: done action text > JSON > filtered messages > fallback
    let output = '';
    if (cap.doneTexts.length > 0) {
      output = cap.doneTexts[cap.doneTexts.length - 1];
    } else if (cap.messages.length > 0) {
      output =
        this.tryExtractJson(cap.messages) || this.tryExtractDone(cap.messages) || this.getFallbackOutput(cap.messages);
    }

    const tabIds = Array.from(cap.tabIds);
    if (tabIds.length === 0 && typeof task.tabId === 'number') {
      tabIds.push(task.tabId);
    }

    cap.active = false;
    return { ok: true, outputText: output, tabIds };
  }

  private tryExtractJson(messages: string[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i].trim();
      const fence = m.match(/```json\s*([\s\S]*?)```/i);
      if (fence?.[1]) {
        try {
          JSON.parse(fence[1]);
          return fence[1];
        } catch {}
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i].trim();
      if ((m.startsWith('{') && m.endsWith('}')) || (m.startsWith('[') && m.endsWith(']'))) {
        try {
          const j = JSON.parse(m);
          if (j?.type === 'job_summary') continue;
          return m;
        } catch {}
      }
    }

    return null;
  }

  private tryExtractDone(messages: string[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i].trim();
      if (!m) continue;

      try {
        const j = JSON.parse(m);
        if (j?.type === 'job_summary') continue;
      } catch {}

      const lower = m.toLowerCase();
      const isGeneric =
        lower === 'task completed successfully' ||
        lower.startsWith('task failed') ||
        lower === 'navigation done' ||
        lower === 'navigating...' ||
        /^completed subtask\s+\d+$/i.test(m) ||
        /^starting subtask\s+\d+:/i.test(m) ||
        /^worker\s+\d+\s+ready$/i.test(m) ||
        /^\d+\s+workers executing plan/i.test(m) ||
        /^action:\s*/i.test(m);

      if (!isGeneric) return m;
    }
    return null;
  }

  private getFallbackOutput(messages: string[]): string {
    const nonSummaries = messages.filter(m => {
      try {
        const j = JSON.parse(m);
        return !(j?.type === 'job_summary');
      } catch {
        return true;
      }
    });
    return (nonSummaries[nonSummaries.length - 1] || messages[messages.length - 1] || '').toString();
  }
}
