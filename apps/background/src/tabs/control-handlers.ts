import { safePostMessage, safeTabUpdate, safeTabHighlight, startPageFlash, stopPageFlash } from '@extension/shared/lib/utils';

export async function focusTab(tabId: number, port: chrome.runtime.Port, logger: any) {
  try {
    if (!tabId) {
      logger.error('[SidePanel] No tab ID provided to focus_tab');
      safePostMessage(port, { type: 'error', error: 'No tab ID provided' });
      return;
    }

    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
      logger.info(`[SidePanel] Found tab ${tabId}: ${tab.url}`);
    } catch (err) {
      logger.error(`[SidePanel] Tab ${tabId} does not exist:`, err);
      const allTabs = await chrome.tabs.query({});
      const agentTabs = allTabs.filter(
        t =>
          t.url &&
          (t.url.includes('google.com') ||
            t.url.includes('bing.com') ||
            t.url.includes('search') ||
            t.title?.toLowerCase().includes('warpsurf')),
      );
      if (agentTabs.length === 1) tab = agentTabs[0];
      else if (agentTabs.length > 1) tab = agentTabs[agentTabs.length - 1];
      else throw new Error(`Tab ${tabId} not found and no agent tabs available`);
    }

    const actualTabId = tab.id!;
    await safeTabUpdate(actualTabId, { active: true });
    if (typeof tab.index === 'number' && tab.windowId) {
      await safeTabHighlight({ windowId: tab.windowId, tabs: tab.index });
    }
    safePostMessage(port, { type: 'success', tabId: actualTabId });
  } catch (e) {
    logger.error(`[SidePanel] Error in focus_tab for tab ${tabId}:`, e);
    safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to focus tab' });
  }
}

export async function takeControl(tabId: number, executor: any, logger: any) {
  if (!tabId) throw new Error('No tab ID provided');
  if (executor) {
    await executor.pause();
    logger.info('Executor paused for user control');
  }
  await chrome.tabs.update(tabId, { active: true });
  await startPageFlash(tabId);
}

export async function handBackControl(
  tabId: number | undefined,
  instructions: string | undefined,
  executor: any,
  logger: any,
) {
  if (!executor) throw new Error('No task to resume');
  if (tabId) {
    await stopPageFlash(tabId);
  }
  if (typeof instructions === 'string' && instructions.trim().length > 0) {
    executor.addFollowUpTask(instructions);
  }
  await executor.resume();
  logger.info('Executor resumed after hand back');
}
