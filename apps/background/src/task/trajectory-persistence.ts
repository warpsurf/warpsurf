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
  eventId?: string;
  pageUrl?: string;
  pageTitle?: string;
  [key: string]: any;
}

export interface SessionTrajectory {
  rootId: string;
  traceItems: TraceItem[];
  traceItemIds?: Set<string>;
  isCompleted: boolean;
  startTime: number;
  rootMessagePersisted?: boolean;
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

  private static readonly FALLBACK_OUTPUT = 'Task completed successfully';

  // Debounce timers for batched persistence
  private persistTimers = new Map<string, NodeJS.Timeout>();
  private static readonly PERSIST_DEBOUNCE_MS = 500;

  // Cache of rootIds for faster lookup (populated on demand and from storage)
  public rootIdCache = new Map<string, string>();

  private processedSummaries = new Set<string>();

  /**
   * Initialize or get trajectory for a session.
   * If trajectory doesn't exist in memory but exists in storage, loads the existing rootId to avoid duplication.
   * @param sessionId - The session ID
   * @param actor - The actor for the rootId (should match the panel's actor, e.g., agent_navigator)
   * @param eventTimestamp - The event timestamp (should match the panel's timestamp for the aggregate message)
   */
  getOrCreateTrajectory(sessionId: string, actor: string = Actors.SYSTEM, eventTimestamp?: number): SessionTrajectory {
    let trajectory = this.trajectories.get(sessionId);
    if (!trajectory) {
      // Use event timestamp if provided, otherwise use current time
      const timestamp = eventTimestamp || Date.now();
      // Use cached rootId if available (prevents duplication after session switch)
      const cachedRootId = this.rootIdCache.get(sessionId);
      const rootId = cachedRootId || `${timestamp}-${actor}`;

      trajectory = {
        rootId,
        traceItems: [],
        traceItemIds: new Set<string>(),
        isCompleted: false,
        startTime: timestamp,
        rootMessagePersisted: false,
      };
      this.trajectories.set(sessionId, trajectory);

      if (cachedRootId) {
        logger.info(`[Trajectory] Restored trajectory for session ${sessionId} using cached rootId=${rootId}`);
      } else {
        logger.info(`[Trajectory] Created new trajectory for session ${sessionId}, rootId=${rootId}`);
        // Load existing rootId from storage (async, will update if found)
        this.loadExistingRootId(sessionId, trajectory);
      }
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
        this.rootIdCache.set(sessionId, storedRootId); // Cache for future use
        const storedData = (existing as any)?.[storedRootId];
        if (storedData?.traceItems && Array.isArray(storedData.traceItems)) {
          trajectory.traceItems = storedData.traceItems;
          const ids = new Set<string>();
          for (const item of storedData.traceItems) {
            if ((item as any)?.eventId) ids.add(String((item as any).eventId));
          }
          trajectory.traceItemIds = ids;
        }
        logger.info(`[Trajectory] Adopted existing rootId ${storedRootId} for session ${sessionId} (was ${oldRootId})`);
      }
    } catch (e) {
      logger.debug(`[Trajectory] Could not load existing rootId for ${sessionId}:`, e);
    }
  }

  private isFallbackOutput(content: string | undefined): boolean {
    return String(content || '').trim() === TrajectoryPersistenceService.FALLBACK_OUTPUT;
  }

  private async ensureRootMessage(sessionId: string, actor: string, timestamp: number, content: string): Promise<void> {
    const trimmed = String(content || '').trim();
    if (!trimmed || this.isFallbackOutput(trimmed)) return;
    try {
      const session = await chatHistoryStore.getSession(sessionId);
      const exists = session?.messages?.some(
        m =>
          Number(m.timestamp) === Number(timestamp) &&
          String(m.actor || '').toLowerCase() === String(actor || '').toLowerCase(),
      );
      if (exists) return;
    } catch {}
    try {
      await chatHistoryStore.addMessage(sessionId, { actor, content: trimmed, timestamp } as any);
    } catch (e) {
      logger.error(`[Trajectory] Failed to persist root message for ${sessionId}:`, e);
    }
  }

  private async persistSessionSummary(sessionId: string, summary: any): Promise<void> {
    if (!summary || typeof summary !== 'object') return;
    const summaryKey = `${sessionId}:${Number(summary.totalInputTokens) || 0}:${Number(summary.totalOutputTokens) || 0}:${
      Number(summary.totalCost) || 0
    }:${Number(summary.apiCallCount) || 0}`;
    if (this.processedSummaries.has(summaryKey)) return;
    this.processedSummaries.add(summaryKey);

    const totalInputTokens = Number(summary.totalInputTokens) || 0;
    const totalOutputTokens = Number(summary.totalOutputTokens) || 0;
    const totalCost = Number(summary.totalCost) || 0;
    const totalLatencyMs =
      Number(summary.totalLatencyMs) || Math.round(Number(summary.totalLatencySeconds || 0) * 1000);
    const totalRequests = Number(summary.apiCallCount) || 1;
    const sessionStats = {
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalLatency: totalLatencyMs,
      totalCost,
      avgLatencyPerRequest: totalRequests > 0 ? totalLatencyMs / totalRequests : 0,
    };

    let rootId = this.rootIdCache.get(sessionId) || this.trajectories.get(sessionId)?.rootId || '';
    try {
      const metadata = await chatHistoryStore.loadMessageMetadata(sessionId).catch(() => ({}));
      const storedRootId = (metadata as any)?.__sessionRootId;
      if (storedRootId) rootId = storedRootId;
    } catch {}

    if (rootId) {
      try {
        const existing = await chatHistoryStore.loadRequestSummaries(sessionId).catch(() => ({}));
        if (!(existing as any)?.[rootId]) {
          const requestSummary = {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            latency: (Number(summary.totalLatencySeconds) || 0).toString() || '0.00',
            cost: totalCost,
            apiCalls: Number(summary.apiCallCount) || 0,
            modelName: summary.modelName,
            provider: summary.provider,
          };
          await chatHistoryStore.storeRequestSummaries(sessionId, { ...(existing || {}), [rootId]: requestSummary });
        }
      } catch (e) {
        logger.error(`[Trajectory] Failed to persist request summary for ${sessionId}:`, e);
      }
    }

    try {
      await chatHistoryStore.storeSessionStats(sessionId, sessionStats);
    } catch (e) {
      logger.error(`[Trajectory] Failed to persist session stats for ${sessionId}:`, e);
    }
  }

  private async ensureOutputMessage(
    sessionId: string,
    actor: string,
    timestamp: number,
    content: string,
  ): Promise<void> {
    const trimmed = String(content || '').trim();
    if (!trimmed || this.isFallbackOutput(trimmed)) return;
    let outputActor = actor;
    const actorLower = String(actor || '').toLowerCase();
    if (actorLower === String(Actors.SYSTEM).toLowerCase()) {
      const lastNonSystem = this.trajectories
        .get(sessionId)
        ?.traceItems?.slice()
        .reverse()
        .find(t => String(t.actor || '').toLowerCase() !== String(Actors.SYSTEM).toLowerCase());
      if (lastNonSystem?.actor === Actors.CHAT || lastNonSystem?.actor === Actors.SEARCH) {
        outputActor = lastNonSystem.actor;
      } else {
        // For agent workflows, final output is already captured in aggregate details.
        return;
      }
    }
    try {
      const session = await chatHistoryStore.getSession(sessionId);
      const exists = session?.messages?.some(m => String(m.content || '').trim() === trimmed);
      if (exists) return;
    } catch {}
    try {
      await chatHistoryStore.addMessage(sessionId, { actor: outputActor, content: trimmed, timestamp } as any);
    } catch (e) {
      logger.error(`[Trajectory] Failed to persist output message for ${sessionId}:`, e);
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
    // Pass timestamp so if trajectory needs to be created, it uses correct timestamp
    const trajectory = this.getOrCreateTrajectory(sessionId, actor, timestamp);
    const isFirstItem = trajectory.traceItems.length === 0;

    const { pageUrl, pageTitle, ...rest } = additionalData || {};
    const eventId = (additionalData as any)?.eventId ? String((additionalData as any).eventId) : undefined;
    if (eventId && trajectory.traceItemIds?.has(eventId)) return;
    const newItem: TraceItem = {
      actor,
      content,
      timestamp,
      ...(eventId && { eventId }),
      ...(pageUrl && { pageUrl }),
      ...(pageTitle && { pageTitle }),
      ...rest,
    };

    trajectory.traceItems.push(newItem);
    if (eventId && trajectory.traceItemIds) trajectory.traceItemIds.add(eventId);
    if (isFirstItem && !trajectory.rootMessagePersisted) {
      trajectory.rootMessagePersisted = true;
      void this.ensureRootMessage(sessionId, actor, timestamp, content);
    }
    this.schedulePersist(sessionId);
  }

  /**
   * Update worker progress for multiagent workflows
   */
  updateWorkerProgress(sessionId: string, workerItem: WorkerProgressItem): void {
    const trajectory = this.trajectories.get(sessionId);
    if (!trajectory) return;

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
    if (!trajectory) {
      logger.info(`[Trajectory] markCompleted: no trajectory for session ${sessionId}`);
      return;
    }

    trajectory.isCompleted = true;
    if (finalPreview) trajectory.finalPreview = finalPreview;
    if (finalPreviewBatch) trajectory.finalPreviewBatch = finalPreviewBatch;

    // Force immediate persist on completion
    this.persistNow(sessionId);
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
    const eventId = event?.eventId || data?.eventId;
    const pageInfo = { pageUrl: data?.pageUrl || data?.url, pageTitle: data?.pageTitle || data?.title };
    const actorLower = actor.toLowerCase();
    const isSystemActor = actorLower === String(Actors.SYSTEM).toLowerCase() || actorLower === 'system';
    const isTerminal = ['task.ok', 'task.fail', 'task.cancel'].includes(state);

    if (state === 'step.streaming') {
      return;
    }
    const isChatOrSearch =
      actorLower === String(Actors.CHAT).toLowerCase() || actorLower === String(Actors.SEARCH).toLowerCase();
    if (isChatOrSearch && state.startsWith('step.')) {
      return;
    }

    // Critical events that require immediate persistence (no debounce)
    const isCritical = ['task.start', 'task.ok', 'task.fail', 'task.cancel'].includes(state);

    if (!content && !isCritical) return;
    let trajectory = this.trajectories.get(sessionId);
    if (!trajectory && (!isSystemActor || isTerminal)) {
      trajectory = this.getOrCreateTrajectory(sessionId, actor, timestamp);
    }

    switch (state) {
      case 'task.start':
        // Delay root creation for system events so agent workflows use agent_navigator rootId
        if (!trajectory && isSystemActor) break;
        if (content) this.addTraceItem(sessionId, actor, content, timestamp, { ...pageInfo, eventId });
        this.persistNow(sessionId); // Immediate persist on task start
        break;

      case 'act.start':
        this.addTraceItem(sessionId, actor, content || 'Performing action...', timestamp, {
          action: data?.action,
          ...pageInfo,
          eventId,
        });
        break;

      case 'act.ok':
        if (content) this.addTraceItem(sessionId, actor, content, timestamp, { ...pageInfo, eventId });
        break;

      case 'thinking':
        this.addTraceItem(sessionId, actor, content || 'Thinking...', timestamp, { eventId });
        break;

      case 'task.ok':
        // Add the final trace item with the completion content
        if (content && !this.isFallbackOutput(content)) {
          const lastTrace = trajectory?.traceItems?.[trajectory.traceItems.length - 1];
          const isDuplicate = lastTrace && lastTrace.actor === actor && String(lastTrace.content) === String(content);
          if (!isDuplicate) this.addTraceItem(sessionId, actor, content, timestamp, { eventId });
        }
        void this.ensureOutputMessage(sessionId, actor, timestamp, content);
        void this.persistSessionSummary(sessionId, data?.summary);
        // NOTE: markCompleted is called by handleTaskCompletion in task-manager.ts
        // which has access to the finalPreview mirrors
        break;

      case 'task.fail':
        this.addTraceItem(sessionId, actor, content || 'Task failed', timestamp, { error: true, eventId });
        // NOTE: markCompleted is called by handleTaskCompletion in task-manager.ts
        break;

      case 'task.cancel':
        this.addTraceItem(sessionId, actor, content || 'Task cancelled', timestamp, { cancelled: true, eventId });
        // NOTE: markCompleted is called by handleTaskCompletion in task-manager.ts
        break;

      default:
        if (content) this.addTraceItem(sessionId, actor, content, timestamp, { state, ...pageInfo, eventId });
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
   * Persist trajectory data immediately (public for pre-warm calls)
   */
  async persistNow(sessionId: string): Promise<void> {
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
    try {
      for (const key of this.processedSummaries) {
        if (key.startsWith(`${sessionId}:`)) this.processedSummaries.delete(key);
      }
    } catch {}

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
