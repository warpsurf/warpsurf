import { canInjectScripts, injectBuildDomTree } from '../utils/injection';
import { safePostMessage, safeStorageRemove } from '@extension/shared/lib/utils';

type Deps = {
  logger: { info: Function; error: Function };
  browserContext: { cleanup: () => Promise<void>; removeAttachedPage: (tabId: number) => void };
  getCurrentExecutor: () => any | null;
  getCurrentPort: () => chrome.runtime.Port | null;
};

export function attachRuntimeListeners(deps: Deps): void {
  const { logger, browserContext, getCurrentExecutor, getCurrentPort } = deps;

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
        const executor = getCurrentExecutor() as any;
        executor?.cancel?.();
        await browserContext.cleanup();
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        logger.error('Debugger detach handler error:', error);
      }
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
