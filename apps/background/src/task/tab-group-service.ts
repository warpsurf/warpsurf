import { createLogger } from '../log';
import type { Task } from './task-manager';
import { ExecutionState, Actors, EventType } from '../workflows/shared/event/types';

/**
 * Set to `true` once the Chrome bug that renders an empty grey box
 * for tab-group titles is fixed upstream.
 */
export const ENABLE_TAB_GROUP_TITLES = false;

const TAB_GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as unknown as Array<chrome.tabGroups.Color>;

const TAB_GROUP_COLOR_HEX: Record<string, string> = {
  grey: '#9CA3AF',
  blue: '#60A5FA',
  red: '#F87171',
  yellow: '#FBBF24',
  green: '#34D399',
  pink: '#F472B6',
  purple: '#A78BFA',
  cyan: '#22D3EE',
  orange: '#FB923C',
};

export class TabGroupService {
  private logger = createLogger('TabGroupService');
  private sidePanelPort?: chrome.runtime.Port;

  setSidePanelPort(port?: chrome.runtime.Port): void {
    this.sidePanelPort = port;
  }

  async createGroupForWorker(task: Task, tasks: Map<string, Task>): Promise<void> {
    try {
      const used = await this.getUsedColors(tasks);
      const workerIdx = task.workerIndex ?? this.inferWorkerIndex(tasks);
      const chosen = this.chooseColor(used, workerIdx);
      task.groupColorName = chosen.name;
      task.color = chosen.hex;
      task.name = `Crew ${workerIdx + 1}`;
    } catch (e) {
      this.logger.error('Failed to pre-configure worker group:', e);
    }
  }

  async assignTabToWorkerGroup(tabId: number, task: Task, tasks: Map<string, Task>): Promise<void> {
    try {
      const currentTab = await chrome.tabs.get(tabId).catch(() => null);
      if (!currentTab?.windowId) return;

      const win = await chrome.windows.get(currentTab.windowId).catch(() => null);
      if (!win || win.type !== 'normal') return;

      const groupId = await chrome.tabs.group({ tabIds: [tabId] });
      task.groupId = groupId;

      await this.propagateGroupToContext(task, groupId);
      await this.updateGroupProperties(groupId, task, tasks);
      this.notifyGroupUpdate(task, tabId, groupId);
    } catch (e) {
      this.logger.warn('Tab grouping skipped (non-normal window or unavailable):', (e as any)?.message || e);
    }
  }

  async applyTabColor(tabId: number, task: Task, tasks: Map<string, Task>): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const groupId = await this.getOrCreateGroup(tabId, task, tasks);
        if (groupId === undefined) return;

        task.groupId = groupId;
        await this.propagateGroupToContext(task, groupId);
        await this.updateGroupProperties(groupId, task, tasks);
        this.notifyGroupUpdate(task, tabId, groupId);
        return;
      } catch (e: any) {
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 150));
          continue;
        }
        this.logger.error('Tab grouping failed after 3 attempts:', e);
      }
    }
  }

  async assignGroup(task: Task, groupId: number, colorName?: chrome.tabGroups.Color): Promise<void> {
    task.groupId = groupId;
    if (colorName) {
      task.groupColorName = colorName;
      task.color = TAB_GROUP_COLOR_HEX[colorName as string] || task.color;
    }

    await this.propagateGroupToContext(task, groupId);

    if (typeof task.tabId === 'number') {
      try {
        await chrome.tabs.group({ tabIds: [task.tabId], groupId });
        this.logger.info(`Moved tab ${task.tabId} to group ${groupId}`);
      } catch (e) {
        this.logger.error(`Failed to assign tab to group`, e);
      }
    }
  }

  computeGroupTitle(task: Task, tasks: Map<string, Task>): string {
    const index = task.workerIndex ?? this.inferWorkerIndex(tasks);
    return `Crew ${index + 1}`;
  }

  getNextCrewName(tasks: Map<string, Task>): { name: string; worker_num: number } {
    const num = this.inferWorkerIndex(tasks);
    return { name: `Crew ${num + 1}`, worker_num: num };
  }

  async getUsedColors(tasks: Map<string, Task>): Promise<Set<chrome.tabGroups.Color>> {
    const used = new Set<chrome.tabGroups.Color>();

    try {
      const groups = await chrome.tabGroups.query({});
      groups.forEach(g => {
        const title = (g.title || '').toLowerCase();
        const isOurs = ENABLE_TAB_GROUP_TITLES ? title.startsWith('crew') : !title;
        if (isOurs && g.color) {
          used.add(g.color as chrome.tabGroups.Color);
        }
      });
    } catch {}

    tasks.forEach(t => {
      if (t.status === 'running' && t.groupColorName) used.add(t.groupColorName);
    });

    return used;
  }

  chooseColor(used: Set<chrome.tabGroups.Color>, workerNum: number): { name: chrome.tabGroups.Color; hex: string } {
    const available = TAB_GROUP_COLORS.filter(c => !used.has(c));
    const pool = available.length > 0 ? available : TAB_GROUP_COLORS;
    const name = pool[workerNum % pool.length];
    return { name, hex: TAB_GROUP_COLOR_HEX[name] };
  }

  private async getOrCreateGroup(tabId: number, task: Task, tasks: Map<string, Task>): Promise<number | undefined> {
    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    if (!currentTab?.windowId) return undefined;

    const win = await chrome.windows.get(currentTab.windowId).catch(() => null);
    if (!win || win.type !== 'normal') return undefined;

    if (!task.name?.includes('Crew')) return undefined;

    if (typeof task.groupId === 'number' && task.groupId >= 0) {
      try {
        await chrome.tabGroups.get(task.groupId);
        await chrome.tabs.group({ tabIds: [tabId], groupId: task.groupId });
        return task.groupId;
      } catch {}
    }

    const existingGroupId = (currentTab as any)?.groupId;
    if (typeof existingGroupId === 'number' && existingGroupId >= 0) {
      return existingGroupId;
    }

    return await chrome.tabs.group({ tabIds: [tabId] });
  }

  private async propagateGroupToContext(task: Task, groupId: number): Promise<void> {
    try {
      const ctx = task.executor && (task.executor as any).getBrowserContext?.();
      ctx?.setPreferredGroupId?.(groupId);
    } catch {}
  }

  private async updateGroupProperties(groupId: number, task: Task, tasks: Map<string, Task>): Promise<void> {
    let colorName = task.groupColorName;
    if (!colorName) {
      const used = await this.getUsedColors(tasks);
      const workerIdx = task.workerIndex ?? this.inferWorkerIndex(tasks);
      const chosen = this.chooseColor(used, workerIdx);
      colorName = chosen.name;
      task.groupColorName = colorName as chrome.tabGroups.Color;
      task.color = chosen.hex;
    }

    const title = this.computeGroupTitle(task, tasks);
    task.name = title;

    const updatedGroup = await chrome.tabGroups.update(groupId, {
      color: colorName as chrome.tabGroups.Color,
      ...(ENABLE_TAB_GROUP_TITLES && { title }),
    });

    const finalColorName = (updatedGroup?.color || colorName) as unknown as string;
    task.groupColorName = finalColorName as unknown as chrome.tabGroups.Color;
    task.color = TAB_GROUP_COLOR_HEX[finalColorName] || task.color;
  }

  private notifyGroupUpdate(task: Task, tabId: number, groupId: number): void {
    try {
      this.sidePanelPort?.postMessage({
        type: EventType.EXECUTION,
        actor: Actors.SYSTEM,
        state: ExecutionState.TAB_GROUP_UPDATED,
        data: {
          taskId: task.id,
          tabId,
          groupId,
          groupColorName: task.groupColorName,
          color: task.color,
          title: task.name,
          step: 0,
          maxSteps: 1,
          details: `Updated tab group ${groupId}`,
        },
        timestamp: Date.now(),
      });
    } catch {}
  }

  /** Returns the next available 0-based worker index by examining existing tasks. */
  private inferWorkerIndex(tasks: Map<string, Task>): number {
    let maxIndex = -1;
    tasks.forEach(t => {
      if (typeof t.workerIndex === 'number' && t.workerIndex > maxIndex) {
        maxIndex = t.workerIndex;
      }
    });
    if (maxIndex >= 0) return maxIndex + 1;

    // Fallback: parse display names (1-based "Crew N") and convert back
    tasks.forEach(t => {
      const match = /^Crew\s+(\d+)/i.exec(t.name);
      if (match) {
        const idx = parseInt(match[1], 10) - 1;
        if (!isNaN(idx) && idx > maxIndex) maxIndex = idx;
      }
    });
    return maxIndex + 1;
  }
}
