import { createLogger } from '../log';
import type { TabMirrorService } from '../tabs/tab-mirror';
import type { Task } from './task-manager';
import type { Executor } from '../executor/executor';

export class MirrorCoordinator {
  private sidePanelPort?: chrome.runtime.Port;

  constructor(private tabMirrorService: TabMirrorService) {}

  setSidePanelPort(port?: chrome.runtime.Port): void {
    this.sidePanelPort = port;
    this.tabMirrorService.setDashboardPort(port);
  }

  async setupMirroring(task: Task, tabId: number, executor: Executor, showTabPreviews = true): Promise<void> {
    if (task.tabId && task.tabId !== tabId) {
      this.tabMirrorService.stopMirroring(task.tabId);
    }
    task.tabId = tabId;

    if (!showTabPreviews) return;

    this.registerScreenshotProvider(tabId, executor, task);
    try {
      this.tabMirrorService.reserveDebuggerForPuppeteer(tabId, true);
    } catch {}

    const sessionId = task.parentSessionId || task.id;
    this.tabMirrorService.startMirroring(tabId, task.id, task.color, sessionId, task.workerIndex);
    this.tabMirrorService.updateMirrorColor(tabId, task.color);
    this.sendInitialMirrorUpdate(tabId, sessionId);
  }

  updateMirrorColor(tabId: number, color: string): void {
    this.tabMirrorService.updateMirrorColor(tabId, color);
  }

  stopMirroring(tabId?: number): void {
    if (typeof tabId === 'number') {
      this.tabMirrorService.stopMirroring(tabId);
    }
  }

  freezeSession(sessionId: string): void {
    try {
      (this.tabMirrorService as any).freezeMirrorsForSession?.(String(sessionId));
    } catch {}
  }

  freezeTab(tabId?: number): void {
    if (typeof tabId === 'number') {
      try {
        (this.tabMirrorService as any).freezeMirroring?.(tabId);
      } catch {}
    }
  }

  async pauseAndResume(tabId: number, task: Task, delayMs: number = 3000): Promise<void> {
    this.tabMirrorService.stopMirroring(tabId);
    setTimeout(
      () => {
        if (task.status === 'running') {
          this.tabMirrorService.startMirroring(
            tabId,
            task.id,
            task.color,
            task.parentSessionId || task.id,
            task.workerIndex,
          );
        }
      },
      Math.max(0, delayMs),
    );
  }

  getAllMirrors(): any[] {
    return this.tabMirrorService.getCurrentMirrors();
  }

  getActiveMirrors(): any[] {
    try {
      return (this.tabMirrorService as any).getActiveMirrors?.() || [];
    } catch {
      return [];
    }
  }

  getLatestMirror(): any | null {
    return this.tabMirrorService.getLatestMirror();
  }

  private registerScreenshotProvider(tabId: number, executor: Executor, task?: Task): void {
    this.tabMirrorService.registerScreenshotProvider(tabId, async () => {
      if (task && task.status !== 'running') return undefined;
      try {
        const data = await executor.captureTabScreenshot(tabId);
        return data ? `data:image/jpeg;base64,${data}` : undefined;
      } catch {
        return undefined;
      }
    });
  }

  private sendInitialMirrorUpdate(tabId: number, sessionId: string): void {
    if (!this.sidePanelPort) return;

    setTimeout(() => {
      try {
        // Skip if this tab is no longer the active one for its session
        if (!this.tabMirrorService.isActiveTabForSession(tabId, sessionId)) return;

        const mirrors =
          (this.tabMirrorService as any).getActiveMirrors?.() || this.tabMirrorService.getCurrentMirrors();
        const mirrorData = mirrors.find((m: any) => m.tabId === tabId);

        if (mirrorData) {
          this.sidePanelPort?.postMessage({
            type: 'tab-mirror-update',
            data: { ...mirrorData, sessionId },
          });

          const batch = mirrors.map((m: any) => ({ ...m, sessionId }));
          this.sidePanelPort?.postMessage({ type: 'tab-mirror-batch', data: batch });
        }
      } catch {}
    }, 800);
  }
}
