/** Combined utilities for event handlers - normalization, metadata, dashboard */

import { Actors, chatHistoryStore } from '@extension/storage';
import type { AgentEvent } from '../../types/event';
import type {
  NormalizedEvent,
  TaskEventHandlerDeps,
  JobSummary,
  WorkerProgressItem,
  WorkerTabGroup,
} from './create-task-event-handler';

// ==================== Event Utilities ====================

/** Normalizes potentially variant event shapes from background */
export function normalizeEvent(event: AgentEvent): NormalizedEvent {
  const actor = ((event as any)?.actor || (event as any)?.data?.actor || Actors.SYSTEM) as any;
  const state = ((event as any)?.state || (event as any)?.data?.state) as any;
  const timestamp = (event as any)?.timestamp || Date.now();
  const data = ((event as any)?.data || {}) as any;
  const content = (data as any)?.details ?? (event as any)?.data?.details ?? (event as any)?.content ?? undefined;
  return { actor, state, timestamp, data, content };
}

/** Checks if content is job_summary JSON that should be skipped */
export function shouldSkipJobSummary(content: string | undefined): boolean {
  if (!content || typeof content !== 'string') return false;
  try {
    const parsed = JSON.parse(content);
    return parsed && parsed.type === 'job_summary';
  } catch {
    return false;
  }
}

/** Updates worker progress for multiagent workflows */
export function updateWorkerProgress(event: AgentEvent, deps: TaskEventHandlerDeps): void {
  const { data } = normalizeEvent(event);
  const workerId = (data as any)?.workerId;
  if (!workerId || !deps.agentTraceRootIdRef.current) return;
  try {
    const rootId = deps.agentTraceRootIdRef.current as string;
    const workerKey = String(workerId);
    const timestamp = Date.now();
    const item: WorkerProgressItem = {
      workerId: workerKey,
      text: (data as any)?.details || (data as any)?.message || '',
      agentName: (data as any)?.agentName,
      color: (data as any)?.agentColor,
      timestamp,
    };
    deps.setMessageMetadata(prev => {
      const existing: any = prev[rootId] || {};
      const prevWorkerItems: Array<any> = Array.isArray(existing.workerItems) ? existing.workerItems : [];
      const without = prevWorkerItems.filter((w: any) => String(w.workerId) !== workerKey);
      return {
        ...prev,
        [rootId]: {
          ...existing,
          workerItems: [...without, item],
          totalWorkers: Math.max(existing.totalWorkers || 0, without.length + 1),
        },
      } as any;
    });
  } catch {}
}

/** Handles TAB_CREATED for worker sessions */
export function handleWorkerTabCreated(event: AgentEvent, deps: TaskEventHandlerDeps): void {
  const { data } = normalizeEvent(event);
  const workerId = (data as any)?.workerId;
  const tabId = (data as any)?.tabId;
  if (!tabId) return;
  try {
    const taskId = String((data as any)?.taskId || workerId || '');
    if (!taskId) return;
    const workerIndex = (data as any)?.workerIndex;
    const ordinal = deps.ensureAgentOrdinal(taskId, workerIndex);
    const agentName = `Web Agent ${ordinal}`;
    const color = (data as any)?.agentColor || '#A78BFA';
    const groupId = (data as any)?.groupId;
    if (deps.getCurrentTaskAgentType() === 'multiagent') deps.setShowCloseTabs(true);
    deps.setWorkerTabGroups((prev: WorkerTabGroup[]) => {
      const exists = prev.some(g => g.taskId === taskId);
      if (!exists) {
        const newGroup: WorkerTabGroup = {
          taskId,
          name: agentName,
          color,
          ...(typeof groupId === 'number' ? { groupId } : {}),
        };
        deps.setShowCloseTabs(true);
        return [...prev, newGroup];
      }
      return prev;
    });
  } catch {}
}

/** Handles TAB_CREATED for single-agent runs */
export function handleSingleAgentTabCreated(event: AgentEvent, deps: TaskEventHandlerDeps): void {
  const { data } = normalizeEvent(event);
  const workerId = (data as any)?.workerId;
  const tabId = (data as any)?.tabId;
  if (workerId || !tabId) return;
  try {
    const taskId = String((data as any)?.taskId || deps.sessionIdRef.current || '');
    if (!taskId) return;
    const workerIndex = (data as any)?.workerIndex;
    const ordinal = deps.ensureAgentOrdinal(taskId, workerIndex);
    const agentName = `Web Agent ${ordinal}`;
    const color = (data as any)?.agentColor || '#A78BFA';
    const groupId = (data as any)?.groupId;
    deps.setWorkerTabGroups((prev: WorkerTabGroup[]) => {
      const exists = prev.some(g => g.taskId === taskId);
      if (!exists) {
        const newGroup: WorkerTabGroup = {
          taskId,
          name: agentName,
          color,
          ...(typeof groupId === 'number' ? { groupId } : {}),
        };
        deps.setShowCloseTabs(true);
        return [...prev, newGroup];
      }
      return prev;
    });
  } catch {}
}

/** Updates tab group colors when TAB_GROUP_UPDATED event received */
export function updateTabGroupColor(event: AgentEvent, deps: TaskEventHandlerDeps): void {
  const { data } = normalizeEvent(event);
  try {
    const taskId = String((data as any)?.taskId || '');
    const finalColor = String((data as any)?.color || '#A78BFA');
    const title = String((data as any)?.title || '');
    const workerIndex = (data as any)?.workerIndex;
    if (!taskId) return;
    deps.setWorkerTabGroups((prev: WorkerTabGroup[]) => {
      const existingIndex = prev.findIndex(group => group.taskId === taskId);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], color: finalColor, ...(title && { name: title }) };
        try {
          deps.laneColorByLaneRef.current.clear();
        } catch {}
        return updated;
      } else {
        const ordinal = deps.ensureAgentOrdinal(taskId, workerIndex);
        const name = title || `Web Agent ${ordinal}`;
        try {
          deps.laneColorByLaneRef.current.clear();
        } catch {}
        return [...prev, { taskId, name, color: finalColor }];
      }
    });
    deps.setShowCloseTabs(true);
  } catch {}
}

/** Reconstructs worker tab groups from mirror preview batch */
export function reconstructWorkerTabGroupsFromPreview(deps: TaskEventHandlerDeps): void {
  try {
    const mirrorPreviewBatch = deps.getMirrorPreviewBatch();
    if (!Array.isArray(mirrorPreviewBatch) || mirrorPreviewBatch.length === 0) return;
    const groupsMap = new Map<string, WorkerTabGroup>();
    (mirrorPreviewBatch as any[]).forEach((p: any, idx: number) => {
      const id = String(p?.agentId || `agent-${idx + 1}`);
      const ordinal = typeof p?.agentOrdinal === 'number' ? p.agentOrdinal : deps.ensureAgentOrdinal(id);
      const name = p?.agentName || `Web Agent ${ordinal}`;
      const color = String(p?.color || '#A78BFA');
      if (!groupsMap.has(id)) groupsMap.set(id, { taskId: id, name, color });
    });
    const groups = Array.from(groupsMap.values());
    if (groups.length > 0) {
      deps.setWorkerTabGroups(groups);
      deps.setShowCloseTabs(true);
    }
  } catch {}
}

/** Checks if close tabs button should be shown */
export function shouldShowCloseTabs(deps: TaskEventHandlerDeps, data: any): boolean {
  try {
    if (deps.getWorkerTabGroups().length > 0) return true;
    const mirrorPreviewBatch = deps.getMirrorPreviewBatch();
    if (Array.isArray(mirrorPreviewBatch) && mirrorPreviewBatch.length > 0) return true;
    const taskId = (data as any)?.taskId;
    if (taskId && deps.closableTaskIdsRef.current.has(String(taskId))) return true;
    return false;
  } catch {
    return false;
  }
}

// ==================== Metadata Utilities ====================

/** Stores job summary with deduplication */
export function storeJobSummary(
  summaryData: JobSummary,
  taskId: string,
  event: 'task.ok' | 'task.fail' | 'task.cancel',
  deps: TaskEventHandlerDeps,
): boolean {
  try {
    const sessionId = taskId || String(deps.sessionIdRef.current) || 'unknown';
    const jobSummaryId = `${sessionId}:${event}:${Number(summaryData.totalInputTokens) || 0}:${Number(summaryData.totalOutputTokens) || 0}:${Number(summaryData.totalCost) || 0}:${Number(summaryData.apiCallCount) || 0}`;
    if (deps.processedJobSummariesRef.current.has(jobSummaryId)) return false;
    deps.processedJobSummariesRef.current.add(jobSummaryId);
    deps.updateSessionStats({
      totalInputTokens: summaryData.totalInputTokens,
      totalOutputTokens: summaryData.totalOutputTokens,
      totalLatencyMs: summaryData.totalLatencyMs,
      totalCost: summaryData.totalCost,
    });
    return true;
  } catch {
    return false;
  }
}

/** Updates request summary for a message */
export function updateRequestSummary(
  messageId: string,
  summary: Partial<JobSummary>,
  deps: TaskEventHandlerDeps,
): void {
  try {
    deps.setRequestSummaries(prev => {
      const existing = (prev as any)[messageId];
      if (existing && Number(existing.latency) > 0 && Number(summary.totalLatencySeconds) === 0) return prev;
      const requestSummary = {
        inputTokens: summary.totalInputTokens || 0,
        outputTokens: summary.totalOutputTokens || 0,
        latency: summary.totalLatencySeconds?.toString() || '0.00',
        cost: summary.totalCost || 0,
        apiCalls: summary.apiCallCount || 0,
        modelName: summary.modelName,
        provider: summary.provider,
      };
      const next = { ...prev, [messageId]: requestSummary } as any;
      try {
        if (deps.sessionIdRef.current) chatHistoryStore.storeRequestSummaries(deps.sessionIdRef.current, next);
      } catch {}
      return next;
    });
  } catch {}
}

/** Updates summary for last agent message */
export function updateLastAgentMessageSummary(summary: Partial<JobSummary>, deps: TaskEventHandlerDeps): void {
  if (!deps.lastAgentMessageRef.current) return;
  const messageId = `${deps.lastAgentMessageRef.current.timestamp}-${deps.lastAgentMessageRef.current.actor}`;
  updateRequestSummary(messageId, summary, deps);
}

/** Updates summary for aggregate root */
export function updateAggregateRootSummary(summary: Partial<JobSummary>, deps: TaskEventHandlerDeps): void {
  if (!deps.agentTraceRootIdRef.current) return;
  updateRequestSummary(deps.agentTraceRootIdRef.current as string, summary, deps);
}

/** Parses job summary from event data (structured or JSON) */
export function parseJobSummary(data: any): JobSummary | null {
  try {
    if ((data as any)?.summary) return (data as any).summary as JobSummary;
    if (data?.message && typeof data.message === 'string') {
      const parsed = JSON.parse(data.message);
      if (parsed && parsed.type === 'job_summary' && parsed.data) return parsed.data as JobSummary;
    }
    return null;
  } catch {
    return null;
  }
}

/** Adds trace item to aggregate message */
export function addTraceItem(
  actor: string,
  content: string,
  timestamp: number,
  deps: TaskEventHandlerDeps,
  additionalData?: any,
): void {
  deps.logger.log('[addTraceItem] Called', {
    actor,
    contentPreview: content?.substring?.(0, 50),
    rootId: deps.agentTraceRootIdRef.current,
    sessionId: deps.sessionIdRef.current,
  });
  if (!deps.agentTraceRootIdRef.current) {
    deps.logger.log('[addTraceItem] Skipped - no rootId');
    return;
  }
  try {
    const rootId = deps.agentTraceRootIdRef.current as string;
    deps.setMessageMetadata(prev => {
      const existing = (prev as any)[rootId] || {};
      const traceItems = (existing as any).traceItems || [];
      // Extract pageUrl and pageTitle from additionalData if present
      const { pageUrl, pageTitle, eventId, ...rest } = additionalData || {};
      const normalizedEventId = eventId ? String(eventId) : '';
      if (normalizedEventId) {
        const hasEventId = traceItems.some((t: any) => String(t?.eventId || '') === normalizedEventId);
        if (hasEventId) return prev as any;
      } else {
        const hasDuplicate = traceItems.some(
          (t: any) =>
            Number(t?.timestamp || 0) === Number(timestamp) &&
            String(t?.actor || '') === String(actor || '') &&
            String(t?.content || '') === String(content || ''),
        );
        if (hasDuplicate) return prev as any;
      }
      const newItem = {
        actor,
        content,
        timestamp,
        ...(normalizedEventId && { eventId: normalizedEventId }),
        ...(pageUrl && { pageUrl }),
        ...(pageTitle && { pageTitle }),
        ...rest,
      };
      const updated = { ...prev, [rootId]: { ...existing, traceItems: [...traceItems, newItem] } } as any;
      deps.logger.log('[addTraceItem] Added item', {
        rootId,
        newTraceCount: traceItems.length + 1,
      });
      try {
        if (deps.sessionIdRef.current) {
          chatHistoryStore.storeMessageMetadata(deps.sessionIdRef.current, updated);
          deps.logger.log('[addTraceItem] Persisted to storage');
        }
      } catch (e) {
        deps.logger.error('[addTraceItem] Failed to persist:', e);
      }
      return updated;
    });
  } catch (e) {
    deps.logger.error('[addTraceItem] Error:', e);
  }
}

/** Marks aggregate message as completed */
export function markAggregateComplete(deps: TaskEventHandlerDeps, rootId?: string): void {
  const targetRootId = rootId || deps.agentTraceRootIdRef.current;
  deps.logger.log('[markAggregateComplete] Called', {
    targetRootId,
    sessionId: deps.sessionIdRef.current,
  });
  if (!targetRootId) {
    deps.logger.log('[markAggregateComplete] Skipped - no rootId');
    return;
  }
  try {
    deps.setMessageMetadata(prev => {
      const existing = (prev as any)[targetRootId] || {};
      const updated = { ...prev, [targetRootId]: { ...existing, isCompleted: true } } as any;
      try {
        if (deps.sessionIdRef.current) chatHistoryStore.storeMessageMetadata(deps.sessionIdRef.current, updated);
      } catch {}
      return updated;
    });
  } catch {}
}

/** Persists final preview snapshot to metadata */
export function persistFinalPreview(deps: TaskEventHandlerDeps): void {
  deps.logger.log('[persistFinalPreview] Called', {
    rootId: deps.agentTraceRootIdRef.current,
    sessionId: deps.sessionIdRef.current,
  });
  if (!deps.agentTraceRootIdRef.current) {
    deps.logger.log('[persistFinalPreview] Skipped - no rootId');
    return;
  }
  try {
    const rootId = deps.agentTraceRootIdRef.current as string;
    const batch = deps.getMirrorPreviewBatch?.();
    deps.logger.log('[persistFinalPreview] Preview data', {
      hasBatch: Array.isArray(batch) && batch.length > 0,
      batchLength: batch?.length,
    });
    deps.setMessageMetadata((prev: any) => {
      const existing: any = prev[rootId] || {};
      const next: any = { ...prev };
      if (Array.isArray(batch) && batch.length > 0) {
        next[rootId] = { ...existing, finalPreviewBatch: batch };
        deps.logger.log('[persistFinalPreview] Saved finalPreviewBatch');
      } else {
        const singlePreview = (deps as any)?.mirrorPreview || existing.finalPreview;
        if (singlePreview) {
          next[rootId] = { ...existing, finalPreview: singlePreview };
          deps.logger.log('[persistFinalPreview] Saved finalPreview');
        } else {
          deps.logger.log('[persistFinalPreview] No preview to save');
        }
      }
      try {
        if (deps.sessionIdRef.current) {
          chatHistoryStore.storeMessageMetadata(deps.sessionIdRef.current, next);
          deps.logger.log('[persistFinalPreview] Persisted to storage');
        }
      } catch (e) {
        deps.logger.error('[persistFinalPreview] Failed to persist:', e);
      }
      return next;
    });
  } catch (e) {
    deps.logger.error('[persistFinalPreview] Error:', e);
  }
}

/** Creates new aggregate root message */
export function createAggregateRoot(
  actor: string,
  content: string,
  timestamp: number,
  deps: TaskEventHandlerDeps,
  options?: { statusHint?: string },
): string {
  const rootId = `${timestamp}-${actor}`;
  deps.setAgentTraceRootId(rootId);
  deps.agentTraceRootIdRef.current = rootId;
  deps.agentTraceActiveRef.current = true;
  deps.appendMessage({ actor, content, timestamp, statusHint: options?.statusHint } as any);
  deps.lastAgentMessageRef.current = { timestamp, actor };
  // CRITICAL: Store rootId as __sessionRootId so it persists across session switches
  deps.setMessageMetadata(prev => {
    const updated = {
      ...prev,
      __sessionRootId: rootId, // Store the rootId for restoration
      [rootId]: { traceItems: [{ actor, content, timestamp }] },
    };
    // Persist to storage
    try {
      if (deps.sessionIdRef.current) chatHistoryStore.storeMessageMetadata(deps.sessionIdRef.current, updated);
    } catch {}
    return updated;
  });
  return rootId;
}

/** Updates aggregate root message content */
export function updateAggregateRootContent(content: string, deps: TaskEventHandlerDeps): void {
  const rootId = deps.agentTraceRootIdRef.current;
  if (!rootId) return;
  try {
    deps.setMessages(prev =>
      prev.map(m => {
        const messageId = `${(m as any).timestamp}-${(m as any).actor}`;
        if (messageId === rootId) return { ...(m as any), content };
        return m;
      }),
    );
  } catch {}
}

// ==================== Dashboard Utilities ====================

const RUNNING_KEY = 'agent_dashboard_running';
const COMPLETED_KEY = 'agent_dashboard_completed';
const MAX_COMPLETED = 200;

interface DashboardAgent {
  sessionId: string;
  sessionTitle: string;
  taskDescription: string;
  startTime: number;
  endTime?: number;
  agentType: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  lastUpdate?: number;
}

/** Adds a running agent to the dashboard */
export function addRunningAgent(taskId: string, deps: TaskEventHandlerDeps): void {
  if (!taskId) {
    deps.logger?.log?.('[addRunningAgent] Skipped - no taskId');
    return;
  }
  deps.logger?.log?.('[addRunningAgent] Starting', { taskId });
  try {
    const sessionTitle = deps.getChatSessions().find(s => String(s.id) === taskId)?.title || '';
    const agentTypeName = deps.getCurrentTaskAgentType() || 'Agent';
    const userMsg =
      deps.lastUserPromptRef.current ||
      [...deps.getMessages()].reverse().find(m => m.actor === Actors.USER)?.content ||
      '';
    const taskDescription = `${agentTypeName}: ${userMsg.substring(0, 120)}`;
    const runningAgent: DashboardAgent = {
      sessionId: taskId,
      sessionTitle,
      taskDescription,
      startTime: Date.now(),
      agentType: agentTypeName,
      status: 'running',
      lastUpdate: Date.now(),
    };
    deps.logger?.log?.('[addRunningAgent] Created entry', {
      sessionId: taskId,
      agentType: agentTypeName,
      startTime: runningAgent.startTime,
    });
    // Use async IIFE to handle errors properly
    (async () => {
      try {
        const result = await chrome.storage.local.get(RUNNING_KEY);
        const arr = Array.isArray(result[RUNNING_KEY]) ? result[RUNNING_KEY] : [];
        const filtered = arr.filter((a: DashboardAgent) => String(a.sessionId) !== taskId);
        filtered.push(runningAgent);
        await chrome.storage.local.set({ [RUNNING_KEY]: filtered });
        deps.logger?.log?.('[addRunningAgent] Storage updated', { newCount: filtered.length });
      } catch (e) {
        deps.logger?.error?.('[addRunningAgent] Storage error:', e);
      }
    })();
  } catch (e) {
    deps.logger?.error?.('[addRunningAgent] Error:', e);
  }
}

/** Moves agent from running to completed */
export function moveToCompleted(
  taskId: string,
  status: 'completed' | 'failed' | 'cancelled',
  deps: TaskEventHandlerDeps,
): void {
  if (!taskId) {
    deps.logger?.log?.('[moveToCompleted] Skipped - no taskId');
    return;
  }
  deps.logger?.log?.('[moveToCompleted] Starting', { taskId, status });
  // Use async IIFE to handle errors properly
  (async () => {
    try {
      const result = await chrome.storage.local.get([RUNNING_KEY, COMPLETED_KEY]);
      const running = Array.isArray(result[RUNNING_KEY]) ? result[RUNNING_KEY] : [];
      const completed = Array.isArray(result[COMPLETED_KEY]) ? result[COMPLETED_KEY] : [];
      deps.logger?.log?.('[moveToCompleted] Current storage', {
        runningCount: running.length,
        completedCount: completed.length,
        foundInRunning: running.some((a: DashboardAgent) => String(a.sessionId) === taskId),
      });
      const existing = running.find((a: DashboardAgent) => String(a.sessionId) === taskId);
      const sessionTitle =
        existing?.sessionTitle || deps.getChatSessions().find(s => String(s.id) === taskId)?.title || '';
      const lastUserMsg =
        deps.lastUserPromptRef.current ||
        [...deps.getMessages()].reverse().find(m => m.actor === Actors.USER)?.content ||
        '';
      const taskDescription = existing?.taskDescription || `Agent: ${lastUserMsg.substring(0, 120)}`;
      const startTime = existing?.startTime || Date.now();
      const agentTypeName = existing?.agentType || deps.getCurrentTaskAgentType() || 'auto';
      const completedEntry: DashboardAgent = {
        sessionId: taskId,
        sessionTitle,
        taskDescription,
        startTime,
        endTime: Date.now(),
        agentType: agentTypeName,
        status,
      };
      const newRunning = running.filter((a: DashboardAgent) => String(a.sessionId) !== taskId);
      const nextCompleted = [...completed, completedEntry].slice(-MAX_COMPLETED);
      deps.logger?.log?.('[moveToCompleted] Writing to storage', {
        newRunningCount: newRunning.length,
        newCompletedCount: nextCompleted.length,
        addedEntry: { sessionId: taskId, status, endTime: completedEntry.endTime },
      });
      await chrome.storage.local.set({ [RUNNING_KEY]: newRunning, [COMPLETED_KEY]: nextCompleted });
      deps.logger?.log?.('[moveToCompleted] Storage updated successfully');
    } catch (e) {
      deps.logger?.error?.('[moveToCompleted] Storage error:', e);
    }
  })();
}
