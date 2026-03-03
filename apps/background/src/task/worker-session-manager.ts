import { createLogger } from '../log';
import type { Task } from './task-manager';
import type { Executor } from '../executor/executor';
import type { MirrorCoordinator } from './mirror-coordinator';
import type { TabGroupService } from './tab-group-service';
import { createWorkerExecutor } from './executor-factory';
import { generalSettingsStore, AgentNameEnum } from '@extension/storage';
import { SailorPrompt } from '@src/workflows/multiagent/roles/sailor-prompt';
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

  constructor(
    private getTasks: () => Map<string, Task>,
    private mirrors: MirrorCoordinator,
    private tabGroups: TabGroupService,
  ) {}

  setForwardEventHandler(handler: (task: Task, event: any) => Promise<void>): void {
    this.onForwardEvent = handler;
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
    const workerPrompt = new SailorPrompt(settings.maxActionsPerStep);
    const executor = await createWorkerExecutor({
      prompt: initialPrompt,
      sessionId: task.id,
      workerModelPrefers: AgentNameEnum.MultiagentWorker,
    });

    try {
      (executor as any).updateOptions?.({
        agentType: 'agent',
        messageContext: options.messageContext,
        retainTokenLogs: true,
        systemMessageOverride: workerPrompt.getSystemMessage(),
      });
    } catch {}

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
    this.mirrors.freezeSession(String(task.parentSessionId || task.id));
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

  private async adoptTargetTabs(executor: Executor, targetTabIds?: number[]): Promise<void> {
    if (!Array.isArray(targetTabIds) || targetTabIds.length === 0) return;

    const ctx = (executor as any).getBrowserContext?.();
    if (!ctx) {
      this.logger.warn('[adoptTargetTabs] No browser context available — cannot adopt tabs');
      return;
    }

    // Register all target tabs as owned first
    for (const tid of targetTabIds) {
      const id = Number(tid);
      try {
        ctx.registerOwnedTab(id);
      } catch (e) {
        this.logger.warn(`[adoptTargetTabs] Failed to register tab ${id} as owned:`, e);
      }
    }

    // Try switching to the first valid target tab
    for (const tid of targetTabIds) {
      const id = Number(tid);
      try {
        const tab = await chrome.tabs.get(id).catch(() => null);
        if (!tab) {
          this.logger.warn(`[adoptTargetTabs] Tab ${id} no longer exists, skipping`);
          continue;
        }
        await ctx.switchTab(id);
        this.logger.info(`[adoptTargetTabs] Successfully switched to dependency tab ${id} (url=${tab.url})`);
        return;
      } catch (e) {
        this.logger.warn(`[adoptTargetTabs] Failed to switch to tab ${id}:`, e);
      }
    }
    this.logger.warn('[adoptTargetTabs] Could not switch to any dependency tab — worker will use default tab');
  }

  private setupEventHandlers(task: Task, settings: any): void {
    if ((task.executor as any).__taskManagerSubscribed) return;
    (task.executor as any).__taskManagerSubscribed = true;

    task.executor!.subscribeExecutionEvents(async event => {
      if (event.state === ExecutionState.TAB_CREATED && event.data?.tabId) {
        const tabId = Number(event.data.tabId);
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
