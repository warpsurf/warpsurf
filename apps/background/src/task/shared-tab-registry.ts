import { createLogger } from '../log';
import { tabExists } from '@src/utils';
import type { SubtaskId } from '@src/workflows/multiagent/multiagent-types';
import type { SubtaskStatus } from '@src/workflows/multiagent/workflow-events';

const logger = createLogger('SharedTabRegistry');

interface TabEntry {
  tabId: number;
  creatorSubtaskId: SubtaskId;
  lastSubtaskId: SubtaskId;
  lastCrewId: number;
  currentHolderCrewId: number | null;
}

export type DependencyResolver = (subtaskId: SubtaskId) => Set<SubtaskId>;
export type StatusResolver = (subtaskId: SubtaskId) => SubtaskStatus | undefined;

/**
 * Workflow-level registry enabling gated cross-crew tab access.
 *
 * A crew may access another crew's tab only when:
 * 1. The requesting subtask depends (directly or transitively) on the tab's last user.
 * 2. That last-user subtask has completed.
 * 3. No other crew is currently holding the tab.
 */
export class SharedTabRegistry {
  private tabs = new Map<number, TabEntry>();
  private resolveDeps: DependencyResolver;
  private resolveStatus: StatusResolver;

  constructor(depResolver: DependencyResolver, statusResolver: StatusResolver) {
    this.resolveDeps = depResolver;
    this.resolveStatus = statusResolver;
  }

  register(tabId: number, subtaskId: SubtaskId, crewId: number): void {
    this.tabs.set(tabId, {
      tabId,
      creatorSubtaskId: subtaskId,
      lastSubtaskId: subtaskId,
      lastCrewId: crewId,
      currentHolderCrewId: crewId,
    });
  }

  /** Mark crew as active holder of a tab (e.g. after a successful switch). */
  markHolder(tabId: number, crewId: number): void {
    const entry = this.tabs.get(tabId);
    if (entry) entry.currentHolderCrewId = crewId;
  }

  /** Release all tabs held by a crew (on subtask completion or cancellation). */
  releaseCrewTabs(crewId: number, subtaskId: SubtaskId): void {
    for (const entry of this.tabs.values()) {
      if (entry.currentHolderCrewId === crewId) {
        entry.currentHolderCrewId = null;
        entry.lastSubtaskId = subtaskId;
        entry.lastCrewId = crewId;
      }
    }
  }

  /**
   * Check whether a crew may access a tab it does not own.
   * Returns true only when all three gating conditions are met.
   */
  async canAccess(tabId: number, requestingSubtaskId: SubtaskId, requestingCrewId: number): Promise<boolean> {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;

    // Condition 1: requesting subtask depends (transitively) on the tab's last user
    const deps = this.resolveDeps(requestingSubtaskId);
    if (!deps.has(entry.lastSubtaskId)) {
      logger.debug(`canAccess denied: subtask #${requestingSubtaskId} does not depend on #${entry.lastSubtaskId}`);
      return false;
    }

    // Condition 2: the subtask that last used this tab has completed
    const status = this.resolveStatus(entry.lastSubtaskId);
    if (status !== 'completed') {
      logger.debug(`canAccess denied: subtask #${entry.lastSubtaskId} status is ${status}`);
      return false;
    }

    // Condition 3: no other crew is currently holding this tab
    if (entry.currentHolderCrewId !== null && entry.currentHolderCrewId !== requestingCrewId) {
      logger.debug(`canAccess denied: tab ${tabId} held by crew ${entry.currentHolderCrewId}`);
      return false;
    }

    // Verify tab still exists in the browser
    if (!(await tabExists(tabId))) {
      logger.debug(`canAccess denied: tab ${tabId} no longer exists`);
      this.tabs.delete(tabId);
      return false;
    }

    return true;
  }

  /** Remove all entries (workflow teardown). */
  clear(): void {
    this.tabs.clear();
  }
}
