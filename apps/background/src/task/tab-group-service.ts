import { createLogger } from '../log';
import type { Task } from './task-manager';
import { ExecutionState, Actors, EventType } from '../workflows/shared/event/types';

const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as unknown as Array<chrome.tabGroups.Color>;

const TAB_GROUP_COLOR_HEX: Record<string, string> = {
  grey: '#9CA3AF', blue: '#60A5FA', red: '#F87171', yellow: '#FBBF24',
  green: '#34D399', pink: '#F472B6', purple: '#A78BFA', cyan: '#22D3EE', orange: '#FB923C',
};

export class TabGroupService {
  private logger = createLogger('TabGroupService');
  private sidePanelPort?: chrome.runtime.Port;

  setSidePanelPort(port?: chrome.runtime.Port): void {
    this.sidePanelPort = port;
  }

  async applyTabColor(tabId: number, task: Task, tasks: Map<string, Task>): Promise<void> {
    await new Promise(r => setTimeout(r, 200));

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
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
        this.logger.error('Tab grouping failed after 3 attempts:', e);
        throw new Error(`Tab grouping failed: ${e?.message || 'Unknown error'}`);
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
    let index = task.workerIndex;
    
    if (!index) {
      const match = (task.name || '').match(/Web Agent\s+(\d+)/i);
      if (match) index = parseInt(match[1], 10);
    }
    
    if (!index) {
      index = this.getNextWorkerNum(tasks);
    }
    
    return `Web Agent ${index}`;
  }

  getNextWebAgentName(tasks: Map<string, Task>): { name: string; worker_num: number } {
    const num = this.getNextWorkerNum(tasks);
    return { name: `Web Agent ${num}`, worker_num: num };
  }

  async getUsedColors(tasks: Map<string, Task>): Promise<Set<chrome.tabGroups.Color>> {
    const used = new Set<chrome.tabGroups.Color>();
    
    try {
      const groups = await chrome.tabGroups.query({});
      groups.forEach(g => {
        if ((g.title || '').toLowerCase().startsWith('web agent') && g.color) {
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

    // Window type validation removed - side panel only works in normal windows,
    // so we're guaranteed to be in a valid window for tab grouping

    if (!task.name?.includes('Web Agent')) return undefined;
    
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
      const workerNum = task.workerIndex || this.getNextWorkerNum(tasks);
      const chosen = this.chooseColor(used, workerNum);
      colorName = chosen.name;
      task.groupColorName = colorName as chrome.tabGroups.Color;
      task.color = chosen.hex;
    }
    
    const title = this.computeGroupTitle(task, tasks);
    task.name = title;
    
    const updatedGroup = await chrome.tabGroups.update(groupId, { 
      color: colorName as chrome.tabGroups.Color, 
      title 
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

  private getNextWorkerNum(tasks: Map<string, Task>): number {
    let max = 0;
    tasks.forEach(t => {
      const match = /^web agent\s+(\d+)/i.exec(t.name);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return max + 1;
  }
}

