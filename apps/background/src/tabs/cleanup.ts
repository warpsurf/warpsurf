export async function closeTaskTabs(taskManager: any, taskId: string) {
  await taskManager.tabMirrorService?.freezeMirrorsForSession?.(String(taskId));
  await taskManager.closeTaskGroup(taskId);
  setTimeout(() => {
    taskManager.tabMirrorService?.freezeMirrorsForSession?.(String(taskId));
  }, 500);
}

export async function closeTaskGroup(groupId: number) {
  const tabs = await chrome.tabs.query({ groupId });
  const tabIds = tabs.map(t => t.id).filter((id): id is number => typeof id === 'number');
  if (tabIds.length > 0) await chrome.tabs.remove(tabIds);
}

export async function closeAllTabsForSession(taskManager: any, sessionId: string) {
  const tasks = taskManager.getAllTasks();
  const scoped = tasks.filter((t: any) => String((t as any).parentSessionId || '') === String(sessionId));
  for (const t of scoped) {
    try {
      if (typeof (t as any).groupId === 'number') {
        const tabs = await chrome.tabs.query({ groupId: (t as any).groupId });
        const tabIds = tabs.map((tt: any) => tt.id).filter((id: any): id is number => typeof id === 'number');
        if (tabIds.length > 0) await chrome.tabs.remove(tabIds);
      } else if (typeof (t as any).tabId === 'number') {
        await chrome.tabs.remove((t as any).tabId);
      }
    } catch {
      // Tab may already be closed
    }
  }
}
