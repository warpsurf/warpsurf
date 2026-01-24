/**
 * TrajectoryPersistenceService - Background service for persisting workflow trajectory data
 *
 * This service ensures trajectory data is recorded for ALL running workflows,
 * regardless of which session the side panel is currently viewing.
 *
 * Key responsibilities:
 * 1. Track trajectory per session (not dependent on panel state)
 * 2. Persist to chatHistoryStore as events occur
 * 3. Build aggregate message metadata for UI display
 */

import { chatHistoryStore, Actors } from '@extension/storage';
import { createLogger } from '../log';

const logger = createLogger('TrajectoryPersistence');

export interface TraceItem {
  actor: string;
  content: string;
  timestamp: number;
  pageUrl?: string;
  pageTitle?: string;
  [key: string]: any;
}

export interface SessionTrajectory {
  rootId: string;
  traceItems: TraceItem[];
  isCompleted: boolean;
  startTime: number;
  workerItems?: WorkerProgressItem[];
  totalWorkers?: number;
  finalPreview?: any;
  finalPreviewBatch?: any[];
}

export interface WorkerProgressItem {
  workerId: string;
  text: string;
  agentName?: string;
  color?: string;
  timestamp: number;
}

/**
 * Service for persisting trajectory data independently of the side panel.
 * This ensures background workflows record all trajectory data even when
 * the user is viewing a different session in the side panel.
 */
export class TrajectoryPersistenceService {
  // In-memory trajectory state per session
  private trajectories = new Map<string, SessionTrajectory>();

  // Debounce timers for batched persistence
  private persistTimers = new Map<string, NodeJS.Timeout>();
  private static readonly PERSIST_DEBOUNCE_MS = 500;

  /**
   * Initialize or get trajectory for a session.
   * If trajectory doesn't exist in memory but exists in storage, loads the existing rootId to avoid duplication.
   */
  getOrCreateTrajectory(sessionId: string, actor: string = Actors.SYSTEM): SessionTrajectory {
    let trajectory = this.trajectories.get(sessionId);
    if (!trajectory) {
      const timestamp = Date.now();
      const rootId = `${timestamp}-${actor}`;
      trajectory = {
        rootId,
        traceItems: [],
        isCompleted: false,
        startTime: timestamp,
      };
      this.trajectories.set(sessionId, trajectory);
      logger.info(`[Trajectory] Created new trajectory for session ${sessionId}, rootId=${rootId}`);

      // CRITICAL: Check if there's an existing rootId in storage and adopt it to avoid duplication
      // This handles the case where user switches sessions and the trajectory was evicted from memory
      this.loadExistingRootId(sessionId, trajectory);
    }
    return trajectory;
  }

  /**
   * Load existing rootId from storage to avoid creating duplicate trajectory blocks
   */
  private async loadExistingRootId(sessionId: string, trajectory: SessionTrajectory): Promise<void> {
    try {
      const existing = await chatHistoryStore.loadMessageMetadata(sessionId);
      const storedRootId = (existing as any)?.__sessionRootId;
      if (storedRootId && storedRootId !== trajectory.rootId) {
        // Adopt the existing rootId and load any existing trace items
        const oldRootId = trajectory.rootId;
        trajectory.rootId = storedRootId;
        const storedData = (existing as any)?.[storedRootId];
        if (storedData?.traceItems && Array.isArray(storedData.traceItems)) {
          trajectory.traceItems = storedData.traceItems;
        }
        logger.info(`[Trajectory] Adopted existing rootId ${storedRootId} for session ${sessionId} (was ${oldRootId})`);
      }
    } catch (e) {
      logger.debug(`[Trajectory] Could not load existing rootId for ${sessionId}:`, e);
    }
  }

  /**
   * Check if a session has an active trajectory
   */
  hasTrajectory(sessionId: string): boolean {
    return this.trajectories.has(sessionId);
  }

  /**
   * Get the root ID for a session (for panel to use when displaying)
   */
  getRootId(sessionId: string): string | null {
    return this.trajectories.get(sessionId)?.rootId || null;
  }

  /**
   * Add a trace item to a session's trajectory
   */
  addTraceItem(
    sessionId: string,
    actor: string,
    content: string,
    timestamp: number,
    additionalData?: Record<string, any>,
  ): void {
    const trajectory = this.getOrCreateTrajectory(sessionId, actor);

    const { pageUrl, pageTitle, ...rest } = additionalData || {};
    const newItem: TraceItem = {
      actor,
      content,
      timestamp,
      ...(pageUrl && { pageUrl }),
      ...(pageTitle && { pageTitle }),
      ...rest,
    };

    trajectory.traceItems.push(newItem);
    this.schedulePersist(sessionId);
  }

  /**
   * Update worker progress for multiagent workflows
   */
  updateWorkerProgress(sessionId: string, workerItem: WorkerProgressItem): void {
    const trajectory = this.getOrCreateTrajectory(sessionId);

    if (!trajectory.workerItems) {
      trajectory.workerItems = [];
    }

    // Replace existing item for this worker or add new
    const workerKey = String(workerItem.workerId);
    const existingIndex = trajectory.workerItems.findIndex(w => String(w.workerId) === workerKey);

    if (existingIndex >= 0) {
      trajectory.workerItems[existingIndex] = workerItem;
    } else {
      trajectory.workerItems.push(workerItem);
    }

    trajectory.totalWorkers = Math.max(trajectory.totalWorkers || 0, trajectory.workerItems.length);
    this.schedulePersist(sessionId);
  }

  /**
   * Mark a session's trajectory as completed
   */
  markCompleted(sessionId: string, finalPreview?: any, finalPreviewBatch?: any[]): void {
    const trajectory = this.trajectories.get(sessionId);
    if (!trajectory) return;

    trajectory.isCompleted = true;
    if (finalPreview) trajectory.finalPreview = finalPreview;
    if (finalPreviewBatch) trajectory.finalPreviewBatch = finalPreviewBatch;

    // Force immediate persist on completion
    this.persistNow(sessionId);
    logger.info(`[Trajectory] Marked session ${sessionId} as completed`);
  }

  /**
   * Process an execution event and extract trajectory data
   */
  processEvent(sessionId: string, event: any): void {
    if (!sessionId) return;

    const state = String(event?.state || '').toLowerCase();
    const data = event?.data || {};
    const actor = String(event?.actor || data?.actor || Actors.SYSTEM);
    const timestamp = event?.timestamp || Date.now();
    const content = data?.details || data?.message || '';
    const pageInfo = { pageUrl: data?.pageUrl || data?.url, pageTitle: data?.pageTitle || data?.title };

    // Skip empty content events unless it's a significant state change
    const isTerminal = ['task.start', 'task.ok', 'task.fail', 'task.cancel'].includes(state);
    if (!content && !isTerminal) return;

    switch (state) {
      case 'task.start':
        this.getOrCreateTrajectory(sessionId, actor);
        if (content) this.addTraceItem(sessionId, actor, content, timestamp, pageInfo);
        break;

      case 'act.start':
        this.addTraceItem(sessionId, actor, content || 'Performing action...', timestamp, {
          action: data?.action,
          ...pageInfo,
        });
        break;

      case 'act.ok':
        if (content) this.addTraceItem(sessionId, actor, content, timestamp, pageInfo);
        break;

      case 'thinking':
        this.addTraceItem(sessionId, actor, content || 'Thinking...', timestamp);
        break;

      case 'task.ok':
        if (content) this.addTraceItem(sessionId, actor, content, timestamp);
        this.markCompleted(sessionId, data?.finalPreview, data?.finalPreviewBatch);
        break;

      case 'task.fail':
        this.addTraceItem(sessionId, actor, content || 'Task failed', timestamp, { error: true });
        this.markCompleted(sessionId);
        break;

      case 'task.cancel':
        this.addTraceItem(sessionId, actor, content || 'Task cancelled', timestamp, { cancelled: true });
        this.markCompleted(sessionId);
        break;

      default:
        if (content) this.addTraceItem(sessionId, actor, content, timestamp, { state, ...pageInfo });
        break;
    }

    // Handle worker progress updates for multiagent
    if (data?.workerId && content) {
      this.updateWorkerProgress(sessionId, {
        workerId: String(data.workerId),
        text: content,
        agentName: data.agentName,
        color: data.agentColor,
        timestamp,
      });
    }
  }

  /**
   * Schedule a debounced persist for a session
   */
  private schedulePersist(sessionId: string): void {
    const existing = this.persistTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.persistNow(sessionId);
      this.persistTimers.delete(sessionId);
    }, TrajectoryPersistenceService.PERSIST_DEBOUNCE_MS);

    this.persistTimers.set(sessionId, timer);
  }

  /**
   * Persist trajectory data immediately
   */
  private async persistNow(sessionId: string): Promise<void> {
    const trajectory = this.trajectories.get(sessionId);
    if (!trajectory) return;

    try {
      // Load existing metadata to MERGE with (don't replace)
      const existingMetadata = await chatHistoryStore.loadMessageMetadata(sessionId).catch(() => ({}));

      // Build new metadata in the format expected by the panel
      const newData = {
        traceItems: trajectory.traceItems,
        isCompleted: trajectory.isCompleted,
        ...(trajectory.workerItems && { workerItems: trajectory.workerItems }),
        ...(trajectory.totalWorkers && { totalWorkers: trajectory.totalWorkers }),
        ...(trajectory.finalPreview && { finalPreview: trajectory.finalPreview }),
        ...(trajectory.finalPreviewBatch && { finalPreviewBatch: trajectory.finalPreviewBatch }),
      };

      // Merge with existing metadata, preserving other rootId entries
      const metadata: Record<string, any> = {
        ...existingMetadata,
        // Store rootId at top level for panel to find
        __sessionRootId: trajectory.rootId,
        [trajectory.rootId]: {
          ...((existingMetadata as any)?.[trajectory.rootId] || {}),
          ...newData,
        },
      };

      await chatHistoryStore.storeMessageMetadata(sessionId, metadata);
      logger.debug(`[Trajectory] Persisted ${trajectory.traceItems.length} items for session ${sessionId}`);
    } catch (error) {
      logger.error(`[Trajectory] Failed to persist for session ${sessionId}:`, error);
    }
  }

  /**
   * Clean up trajectory for a session (called when session is deleted or completed)
   */
  cleanup(sessionId: string): void {
    const timer = this.persistTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(sessionId);
    }

    // Persist any remaining data before cleanup
    this.persistNow(sessionId);

    // Keep completed trajectories in memory briefly for late events
    const trajectory = this.trajectories.get(sessionId);
    if (trajectory?.isCompleted) {
      setTimeout(() => {
        this.trajectories.delete(sessionId);
        logger.debug(`[Trajectory] Cleaned up trajectory for session ${sessionId}`);
      }, 5000);
    }
  }

  /**
   * Force cleanup all trajectories (for killswitch)
   */
  cleanupAll(): void {
    for (const [sessionId] of this.trajectories) {
      this.cleanup(sessionId);
    }
  }

  /**
   * Get current trajectory state for debugging
   */
  getTrajectoryState(sessionId: string): SessionTrajectory | null {
    return this.trajectories.get(sessionId) || null;
  }
}

// Export singleton instance
export const trajectoryPersistence = new TrajectoryPersistenceService();
