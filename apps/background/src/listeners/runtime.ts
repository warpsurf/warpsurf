import { canInjectScripts, injectBuildDomTree } from '../utils/injection';
import { safePostMessage, safeStorageRemove } from '@extension/shared/lib/utils';
import type { MultiAgentWorkflow } from '../workflows/multiagent/multiagent-workflow';

type Deps = {
  logger: { info: Function; error: Function };
  browserContext: { cleanup: () => Promise<void>; removeAttachedPage: (tabId: number) => void };
  getCurrentExecutor: () => any | null;
  setCurrentExecutor: (e: any | null) => void;
  setCurrentWorkflow: (wf: any | null) => void;
  getCurrentPort: () => chrome.runtime.Port | null;
  taskManager: any;
  workflowsBySession: Map<string, MultiAgentWorkflow>;
  runningWorkflowSessionIds: Set<string>;
};

export function attachRuntimeListeners(deps: Deps): void {
  const {
    logger,
    browserContext,
    getCurrentExecutor,
    setCurrentExecutor,
    setCurrentWorkflow,
    getCurrentPort,
    taskManager,
    workflowsBySession,
    runningWorkflowSessionIds,
  } = deps;

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
      if (tabId && changeInfo.status === 'complete' && canInjectScripts(tab.url)) {
        await injectBuildDomTree(tabId, tab.url as string);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        logger.error('Failed to inject buildDomTree:', error);
      }
    }
  });

  chrome.debugger.onDetach.addListener(async (_source, reason) => {
    try {
      if (reason === 'canceled_by_user') {
        logger.info('[DEBUGGER_CANCEL] User cancelled debugger banner — triggering killswitch');
        const { handleKillAll } = await import('../killswitch/handler');
        const agentManagerPort = taskManager?.tabMirrorService?.getAgentManagerPort?.();
        const port = getCurrentPort();
        await handleKillAll({
          port: port as chrome.runtime.Port,
          logger,
          taskManager,
          workflowsBySession,
          runningWorkflowSessionIds,
          getCurrentExecutor,
          setCurrentExecutor,
          setCurrentWorkflow,
          agentManagerPort,
        });
      }
    } catch (error) {
      // Fallback: if killswitch fails, still try to cancel executor and cleanup
      logger.error('[DEBUGGER_CANCEL] Killswitch failed, attempting fallback cleanup:', error);
      try {
        const executor = getCurrentExecutor() as any;
        executor?.cancel?.();
      } catch {}
      try {
        await browserContext.cleanup();
      } catch {}
    }
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    browserContext.removeAttachedPage(tabId);
  });

  chrome.runtime.onInstalled.addListener(async details => {
    try {
      if (details.reason === 'install') {
        await chrome.runtime.openOptionsPage();
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        logger.error('Failed to open options page:', error);
      }
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const delta = (changes as any)?.pending_shortcut;
    if (!delta || !delta.newValue) return;
    const pending = delta.newValue;
    if (!pending || !pending.text) return;
    const port = getCurrentPort();
    if (port && port.name === 'side-panel-connection') {
      safePostMessage(port, { type: 'shortcut', data: { text: String(pending.text || '') } });
      safeStorageRemove('pending_shortcut');
    }
  });
}
