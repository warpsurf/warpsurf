import { safePostMessage } from '@extension/shared/lib/utils';

export function setPreviewVisibility(taskManager: any, sessionId: string, visible: boolean): void {
  const task = taskManager.getTask(String(sessionId));
  if (!task || typeof (task as any).tabId !== 'number') return;
  const tabId = (task as any).tabId as number;
  if (visible) (taskManager as any).tabMirrorService?.resumeMirroring(tabId);
  else (taskManager as any).tabMirrorService?.suspendMirroring(tabId);
}

export function sendTabMirror(taskManager: any, port: chrome.runtime.Port): void {
  const active: any[] = typeof taskManager.getActiveMirrors === 'function' ? taskManager.getActiveMirrors() : [];
  if (Array.isArray(active) && active.length > 0) {
    if (active.length === 1) {
      safePostMessage(port, { type: 'tab-mirror-update', data: active[0] });
    } else {
      safePostMessage(port, { type: 'tab-mirror-batch', data: active });
    }
    return;
  }
  const latest = taskManager.getLatestMirror();
  if (latest) {
    safePostMessage(port, { type: 'tab-mirror-update', data: latest });
  }
}

export async function sendAllMirrorsForCleanup(taskManager: any, port: chrome.runtime.Port): Promise<void> {
  const allTasks = taskManager.getAllTasks();
  const taskById = new Map<string, any>(allTasks.map((t: any) => [String((t as any).id), t]));

  const mirrors = taskManager.getAllMirrors();
  if (Array.isArray(mirrors) && mirrors.length > 0) {
    const enriched = mirrors.map((m: any) => {
      const t = taskById.get(String(m?.agentId));
      const groupId = t && typeof (t as any).groupId === 'number' ? (t as any).groupId : undefined;
      const sessionId = t ? ((t as any).parentSessionId || (t as any).id) : undefined;
      return { ...m, groupId, sessionId };
    });
    safePostMessage(port, { type: 'tab-mirror-batch-for-cleanup', data: enriched });
    return;
  }

  const results: Array<{ agentId: string; color: string; title?: string; groupId?: number; sessionId?: string }> = [];
  for (const t of allTasks) {
    const id = String((t as any).id);
    const hasGroup = typeof (t as any).groupId === 'number' && (t as any).groupId >= 0;
    const groupId = hasGroup ? ((t as any).groupId as number) : undefined;
    let include = false;
    if (hasGroup) {
      const tabs = await chrome.tabs.query({ groupId: groupId as number });
      include = Array.isArray(tabs) && tabs.length > 0;
    } else if (typeof (t as any).tabId === 'number') {
      const tab = await chrome.tabs.get((t as any).tabId).catch(() => null as any);
      include = !!(tab && tab.id);
    }
    if (include) {
      results.push({
        agentId: id,
        color: (t as any).color,
        title: (t as any).name,
        groupId,
        sessionId: (t as any).parentSessionId || id,
      });
    }
  }
  safePostMessage(port, { type: 'tab-mirror-batch-for-cleanup', data: results });
}
