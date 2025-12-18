import type { Executor } from '../executor/executor';
import type { TabMirrorService } from './tab-mirror';

type LoggerLike = { info?: Function; debug?: Function; error?: Function } | undefined;

interface MirrorArgs {
  logger?: LoggerLike;
  tabMirrorService: TabMirrorService;
  sidePanelPort?: chrome.runtime.Port;
  executor: Executor;
  generalSettings: any;
  task: any;
  tabId: number;
}

export async function startMirroringInit(args: MirrorArgs): Promise<void> {
  const { logger, tabMirrorService, sidePanelPort, executor, generalSettings, task, tabId } = args;
  // Stop any existing mirror and bind this tab to the task
  try {
    if (task.tabId && task.tabId !== tabId) {
      try { tabMirrorService.stopMirroring(task.tabId); } catch {}
    }
  } catch {}
  task.tabId = tabId;
  try { logger?.info?.(`Starting tab mirroring (init) for tab ${tabId}`); } catch {}
  // Ensure side panel port is set for mirror updates
  try { if (sidePanelPort) tabMirrorService.setDashboardPort(sidePanelPort); } catch {}
  // Register screenshot provider and start mirroring
  if ((generalSettings.showTabPreviews ?? true) || generalSettings.useVision) {
    tabMirrorService.registerScreenshotProvider(tabId, async () => {
      try {
        const data = await executor.captureTabScreenshot(tabId);
        return data ? `data:image/jpeg;base64,${data}` : undefined;
      } catch (e) {
        try { logger?.error?.('Provider capture failed (init):', e); } catch {}
        return undefined;
      }
    });
    try { tabMirrorService.reserveDebuggerForPuppeteer(tabId, true); } catch {}
  }
  tabMirrorService.startMirroring(tabId, task.id, task.color, task.parentSessionId || task.id, task.workerIndex);
  // Send initial mirror update so UI immediately shows a preview tile
  if (sidePanelPort) {
    setTimeout(() => {
      try {
        const mirrors: Array<any> = (tabMirrorService as any).getActiveMirrors?.() || (tabMirrorService as any).getCurrentMirrors?.() || [];
        const mirrorData = mirrors.find((m: any) => m.tabId === tabId);
        if (mirrorData) {
          const sessionId = task.parentSessionId || task.id;
          sidePanelPort?.postMessage({ type: 'tab-mirror-update', data: { ...mirrorData, sessionId } });
          const batch = mirrors.map((m: any) => ({ ...m, sessionId }));
          sidePanelPort?.postMessage({ type: 'tab-mirror-batch', data: batch });
        }
      } catch {}
    }, 800);
  }
}

export async function startMirroringOnTabCreated(args: MirrorArgs): Promise<void> {
  const { logger, tabMirrorService, sidePanelPort, executor, generalSettings, task, tabId } = args;
  // Register provider that captures the agent tab via Puppeteer even when inactive
  if ((generalSettings.showTabPreviews ?? true) || generalSettings.useVision) {
    tabMirrorService.registerScreenshotProvider(tabId, async () => {
      try {
        const data = await executor.captureTabScreenshot(tabId);
        if (data) {
          try { logger?.info?.(`Screenshot captured for tab ${tabId}, size: ${data.length}`); } catch {}
          return `data:image/jpeg;base64,${data}`;
        }
        try { logger?.info?.(`No screenshot data returned for tab ${tabId}`); } catch {}
        return undefined;
      } catch (e) {
        try { logger?.error?.('Provider capture failed:', e); } catch {}
        return undefined;
      }
    });
    try { tabMirrorService.reserveDebuggerForPuppeteer(tabId, true); } catch {}
  }
  try { logger?.info?.(`Starting tab mirroring for tab ${tabId}`); } catch {}
  tabMirrorService.startMirroring(tabId, task.id, task.color, task.parentSessionId || task.id, task.workerIndex);
  if (sidePanelPort) {
    setTimeout(() => {
      const mirrors: Array<any> = (tabMirrorService as any).getActiveMirrors?.() || (tabMirrorService as any).getCurrentMirrors?.() || [];
      const mirrorData = mirrors.find((m: any) => m.tabId === tabId);
      if (mirrorData) {
        try {
          const sessionId = task.parentSessionId || task.id;
          sidePanelPort?.postMessage({ type: 'tab-mirror-update', data: { ...mirrorData, sessionId } });
          const batch = mirrors.map((m: any) => ({ ...m, sessionId }));
          sidePanelPort?.postMessage({ type: 'tab-mirror-batch', data: batch });
        } catch {}
      }
    }, 1000);
  }
}


