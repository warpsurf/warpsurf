import { createLogger } from '../log';
import { safePostMessage, safeClearInterval, safeDebuggerDetach, isDebuggerAttached } from '@extension/shared/lib/utils';
import { tabExists } from '../utils';

const logger = createLogger('TabMirrorService');

export interface TabMirrorData {
  tabId: number;
  agentId: string;
  color: string;
  sessionId?: string;
  workerIndex?: number;
  url: string;
  title: string;
  screenshot?: string;
  viewport?: { width: number; height: number };
  lastUpdated?: number;
}

export class TabMirrorService {
  private mirrorIntervals: Map<number, NodeJS.Timeout> = new Map();
  private dashboardPort?: chrome.runtime.Port;
  private currentMirrors: Map<number, TabMirrorData> = new Map();
  private screenshotProviders: Map<number, () => Promise<string | undefined>> = new Map();
  private suspendedTabs: Set<number> = new Set();
  private reservedByPuppeteer: Set<number> = new Set();
  private visionEnabled = true;
  private sessionToTabs: Map<string, Set<number>> = new Map();
  private tabWorkerIndex: Map<number, number> = new Map();
  private tabColor: Map<number, string> = new Map();

  constructor() {
    chrome.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
  }

  setDashboardPort(port: chrome.runtime.Port | undefined) {
    this.dashboardPort = port;
    if (port && this.currentMirrors.size > 0) {
      const allMirrors = Array.from(this.currentMirrors.values()).filter(m => this.mirrorIntervals.has(m.tabId));
      if (allMirrors.length > 1) {
        safePostMessage(port, { type: 'tab-mirror-batch', data: allMirrors });
      }
      const latest = this.getLatestMirror();
      if (latest) {
        safePostMessage(port, { type: 'tab-mirror-update', data: latest });
      }
    }
  }

  setVisionEnabled(enabled: boolean) {
    this.visionEnabled = !!enabled;
  }

  registerScreenshotProvider(tabId: number, provider: () => Promise<string | undefined>) {
    this.screenshotProviders.set(tabId, provider);
  }

  unregisterScreenshotProvider(tabId: number) {
    this.screenshotProviders.delete(tabId);
  }

  async startMirroring(tabId: number, agentId: string, color: string, sessionId?: string, workerIndex?: number) {
    const tab = await tabExists(tabId);
    if (!tab) {
      logger.debug(`startMirroring: Tab ${tabId} doesn't exist, skipping setup`);
      return;
    }
    
    const prev = this.mirrorIntervals.get(tabId);
    if (prev) {
      safeClearInterval(prev);
      this.mirrorIntervals.delete(tabId);
    }
    this.suspendedTabs.delete(tabId);
    this.tabColor.set(tabId, color);
    if (typeof workerIndex === 'number') this.tabWorkerIndex.set(tabId, workerIndex);
    if (sessionId) {
      let set = this.sessionToTabs.get(sessionId);
      if (!set) {
        set = new Set();
        this.sessionToTabs.set(sessionId, set);
      }
      set.add(tabId);
    }
    await this.captureAndSendTabData(tabId, agentId, color, sessionId, true);
    
    // Check if tab still exists after initial capture (captureAndSendTabData may have cleaned up)
    if (!this.currentMirrors.has(tabId)) {
      logger.debug(`startMirroring: Tab ${tabId} was cleaned up during initial capture, not starting interval`);
      return;
    }
    
    const interval = setInterval(async () => {
      try {
        if (!this.mirrorIntervals.has(tabId)) {
          clearInterval(interval);
          return;
        }
        if (this.suspendedTabs.has(tabId)) return;
        // Use stored color to pick up updates from updateMirrorColor
        const currentColor = this.tabColor.get(tabId) || color;
        await this.captureAndSendTabData(tabId, agentId, currentColor, sessionId);
      } catch (e) {
        logger.error(`Error in screenshot interval for tab ${tabId}:`, e);
      }
    }, 333);
    this.mirrorIntervals.set(tabId, interval);
  }

  stopMirroring(tabId: number) {
    const had = this.mirrorIntervals.has(tabId);
    if (had) {
      safeClearInterval(this.mirrorIntervals.get(tabId)!);
      this.mirrorIntervals.delete(tabId);
    }
    this.currentMirrors.delete(tabId);
    this.unregisterScreenshotProvider(tabId);
    this.suspendedTabs.delete(tabId);
    this.reservedByPuppeteer.delete(tabId);
    this.tabWorkerIndex.delete(tabId);
    this.tabColor.delete(tabId);
    for (const [, set] of this.sessionToTabs) set.delete(tabId);
    if (this.dashboardPort) {
      safePostMessage(this.dashboardPort, { type: 'tab-mirror-update', data: null });
      safePostMessage(this.dashboardPort, { type: 'tab-mirror-batch', data: this.getCurrentMirrors() });
    }
  }

  updateMirrorColor(tabId: number, color: string): void {
    this.tabColor.set(tabId, color);
    const mirror = this.currentMirrors.get(tabId);
    if (!mirror) return;
    mirror.color = color;
    if (this.dashboardPort) {
      const active = this.getActiveMirrors();
      if (active.length === 1) {
        safePostMessage(this.dashboardPort, { type: 'tab-mirror-update', data: mirror });
      } else {
        safePostMessage(this.dashboardPort, { type: 'tab-mirror-batch', data: active });
      }
    }
  }

  freezeMirroring(tabId: number) {
    const had = this.mirrorIntervals.has(tabId);
    if (had) {
      safeClearInterval(this.mirrorIntervals.get(tabId)!);
      this.mirrorIntervals.delete(tabId);
    }
    this.unregisterScreenshotProvider(tabId);
    this.suspendedTabs.delete(tabId);
    this.reservedByPuppeteer.delete(tabId);
    this.tabWorkerIndex.delete(tabId);
    this.tabColor.delete(tabId);
  }

  suspendMirroring(tabId: number) {
    if (!this.mirrorIntervals.has(tabId)) return;
    this.suspendedTabs.add(tabId);
  }

  resumeMirroring(tabId: number) {
    if (!this.mirrorIntervals.has(tabId)) return;
    this.suspendedTabs.delete(tabId);
  }

  reserveDebuggerForPuppeteer(tabId: number, reserve = true) {
    if (reserve) this.reservedByPuppeteer.add(tabId);
    else this.reservedByPuppeteer.delete(tabId);
  }

  stopAllMirroring() {
    for (const [, i] of this.mirrorIntervals) clearInterval(i);
    this.mirrorIntervals.clear();
    this.currentMirrors.clear();
    this.tabWorkerIndex.clear();
    this.tabColor.clear();
    safePostMessage(this.dashboardPort, { type: 'tab-mirror-batch', data: [] });
  }

  stopMirrorsForSession(sessionId: string) {
    const set = this.sessionToTabs.get(sessionId);
    if (!set || set.size === 0) return;
    for (const tabId of Array.from(set)) {
      this.stopMirroring(tabId);
    }
    this.sessionToTabs.delete(sessionId);
  }

  freezeMirrorsForSession(sessionId: string) {
    const set = this.sessionToTabs.get(sessionId);
    if (!set || set.size === 0) return;
    for (const tabId of Array.from(set)) {
      this.freezeMirroring(tabId);
    }
  }

  getCurrentMirrors(): TabMirrorData[] {
    return Array.from(this.currentMirrors.values());
  }

  getActiveMirrors(): TabMirrorData[] {
    return Array.from(this.currentMirrors.values()).filter(m => this.mirrorIntervals.has(m.tabId));
  }

  getLatestMirror(): TabMirrorData | null {
    const arr = this.getCurrentMirrors();
    let latest: TabMirrorData | null = null;
    for (const m of arr) {
      if (!latest || (m.lastUpdated || 0) > (latest.lastUpdated || 0)) latest = m;
    }
    return latest;
  }

  private async captureAndSendTabData(tabId: number, agentId: string, color: string, sessionId?: string, force = false) {
    try {
      if (!force && !this.mirrorIntervals.has(tabId)) return;
      
      // Safely check if the tab still exists before any operations
      const tab = await tabExists(tabId);
      if (!tab) {
        // Tab no longer exists - clean up mirroring for this tab
        logger.debug(`Tab ${tabId} no longer exists, stopping mirroring`);
        this.stopMirroring(tabId);
        return;
      }
      
      let screenshot: string | undefined;
      const provider = this.screenshotProviders.get(tabId);
      if (provider && this.visionEnabled) {
        try {
          const provided = await provider();
          if (provided && typeof provided === 'string') {
            screenshot = provided.startsWith('data:') ? provided : `data:image/jpeg;base64,${provided}`;
          }
        } catch (err: any) {
          // Screenshot capture failed - check if it's a tab-not-found error
          const msg = String(err?.message || '');
          if (msg.includes('No tab with') || msg.includes('Invalid tab') || msg.includes('Cannot access')) {
            logger.debug(`Tab ${tabId} inaccessible during screenshot, stopping mirroring`);
            this.stopMirroring(tabId);
            return;
          }
          // Other screenshot errors are non-fatal, continue without screenshot
        }
      }
      let viewport = undefined as { width: number; height: number } | undefined;
      if (tab.width && tab.height) viewport = { width: tab.width, height: tab.height };
      const mirrorData: TabMirrorData = {
        tabId,
        agentId,
        color,
        sessionId,
        workerIndex: this.tabWorkerIndex.get(tabId),
        url: tab.url || '',
        title: tab.title || '',
        screenshot,
        viewport,
        lastUpdated: Date.now(),
      };
      this.currentMirrors.set(tabId, mirrorData);
      if (this.dashboardPort) {
        const active = this.getActiveMirrors();
        if (active.length === 1) {
          safePostMessage(this.dashboardPort, { type: 'tab-mirror-update', data: mirrorData });
        } else {
          safePostMessage(this.dashboardPort, { type: 'tab-mirror-batch', data: active });
        }
      }
    } catch (e: any) {
      // Catch-all for any remaining errors - check if tab-related
      const msg = String(e?.message || '');
      if (msg.includes('No tab with') || msg.includes('Invalid tab')) {
        logger.debug(`Tab ${tabId} error in captureAndSendTabData, stopping mirroring`);
        this.stopMirroring(tabId);
        return;
      }
      logger.error(`Failed to capture tab data for tab ${tabId}:`, e);
    }
  }

  private async handleTabUpdate(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
    if (this.mirrorIntervals.has(tabId)) {
      const current = this.currentMirrors.get(tabId);
      if (current) {
        let shouldUpdate = false;
        if (changeInfo.url && current.url !== changeInfo.url) {
          current.url = changeInfo.url;
          shouldUpdate = true;
        }
        if (changeInfo.title && current.title !== changeInfo.title) {
          current.title = changeInfo.title;
          shouldUpdate = true;
        }
        if (changeInfo.status === 'complete') shouldUpdate = true;
        if (shouldUpdate) {
          // captureAndSendTabData will handle tab-not-found gracefully
          await this.captureAndSendTabData(tabId, current.agentId, current.color, current.sessionId, true);
        }
      }
    }
  }

  /**
   * Cleanup all mirrors associated with tabs that no longer exist.
   * Called periodically to prevent stale state accumulation.
   */
  async cleanupStaleMirrors(): Promise<void> {
    const tabIds = Array.from(this.mirrorIntervals.keys());
    for (const tabId of tabIds) {
      const tab = await tabExists(tabId);
      if (!tab) {
        logger.debug(`Cleaning up stale mirror for tab ${tabId}`);
        this.stopMirroring(tabId);
      }
    }
  }

  private handleTabRemoved(tabId: number) {
    this.stopMirroring(tabId);
    this.currentMirrors.delete(tabId);
  }

  async forwardInteraction(tabId: number, interaction: any): Promise<void> {
    try {
      if (this.reservedByPuppeteer.has(tabId)) return;
      
      // Verify tab exists before attempting debugger operations
      const tab = await tabExists(tabId);
      if (!tab) {
        logger.debug(`Tab ${tabId} no longer exists, skipping interaction forward`);
        return;
      }
      
      const debuggeeId = { tabId } as chrome.debugger.Debuggee;
      const wasAlreadyAttached = await isDebuggerAttached(debuggeeId);
      if (!wasAlreadyAttached) {
        try {
          await chrome.debugger.attach(debuggeeId, '1.3');
        } catch {
          return;
        }
      }
      switch (interaction.type) {
        case 'click':
          await chrome.debugger.sendCommand(debuggeeId, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: interaction.x,
            y: interaction.y,
            button: 'left',
            clickCount: 1,
          });
          await chrome.debugger.sendCommand(debuggeeId, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: interaction.x,
            y: interaction.y,
            button: 'left',
            clickCount: 1,
          });
          break;
        case 'mousemove':
          await chrome.debugger.sendCommand(debuggeeId, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: interaction.x,
            y: interaction.y,
          });
          break;
        case 'keydown':
          await chrome.debugger.sendCommand(debuggeeId, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: interaction.key,
            code: interaction.code,
            text: interaction.text,
            modifiers: interaction.modifiers || 0,
          });
          if (interaction.text) {
            await chrome.debugger.sendCommand(debuggeeId, 'Input.dispatchKeyEvent', {
              type: 'char',
              text: interaction.text,
              modifiers: interaction.modifiers || 0,
            });
          }
          await chrome.debugger.sendCommand(debuggeeId, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: interaction.key,
            code: interaction.code,
            modifiers: interaction.modifiers || 0,
          });
          break;
        case 'scroll':
          await chrome.debugger.sendCommand(debuggeeId, 'Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: interaction.x,
            y: interaction.y,
            deltaX: interaction.deltaX || 0,
            deltaY: interaction.deltaY || 0,
          });
          break;
      }
      if (!wasAlreadyAttached) {
        await safeDebuggerDetach(debuggeeId);
      }
    } catch (error) {
      await safeDebuggerDetach({ tabId } as chrome.debugger.Debuggee);
    }
  }
}
