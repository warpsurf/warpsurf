/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { Actors } from '@extension/storage';
import { EventType, type AgentEvent } from '../types/event';

type BackgroundHandlers = {
  onExecution?: (event: AgentEvent) => void;
  onExecutionMeta?: (message: any) => void;
  onWorkflowGraphUpdate?: (message: any) => void;
  onWorkflowPlanDataset?: (message: any) => void;
  onWorkflowProgress?: (message: any) => void;
  onFinalAnswer?: (message: any) => void;
  onWorkflowEnded?: (message: any) => void;
  onError?: (message: any) => void;
  onTokenLog?: (message: any) => void;
  onSessionLogs?: (message: any) => void;
  onTabsClosed?: (message: any) => void;
  onTabMirrorUpdate?: (message: any) => void;
  onTabMirrorBatch?: (message: any) => void;
  onTabMirrorBatchForCleanup?: (message: any) => void;
  onWorkerSessionCreated?: (message: any) => void;
  onCancelTaskResult?: (message: any) => void;
  onKillAllComplete?: (message: any) => void;
  onRestoreActiveSession?: (data: {
    sessionId: string;
    agentType: string;
    isRunning: boolean;
    workflowGraph?: any;
    bufferedEvents?: any[];
  }) => void;
  onRestoreViewState?: (data: { currentSessionId?: string; viewMode?: string }) => void;
  onSessionSubscribed?: (message: any) => void;
  onDisconnect?: (error?: any) => void;
};

interface UseBackgroundConnectionParams {
  portRef: MutableRefObject<chrome.runtime.Port | null>;
  sessionIdRef: MutableRefObject<string | null>;
  logger: { log: (...args: any[]) => void; error: (...args: any[]) => void };
  appendMessage: (msg: { actor: any; content: string; timestamp: number }) => void;
  handlers: Partial<BackgroundHandlers>;
  eventIdRefs?: {
    seenEventIdsRef: MutableRefObject<Map<string, Set<string>>>;
    lastEventIdBySessionRef: MutableRefObject<Map<string, string>>;
  };
}

export function useBackgroundConnection(params: UseBackgroundConnectionParams) {
  const { portRef, sessionIdRef, logger, appendMessage, handlers, eventIdRefs } = params;
  const heartbeatIntervalRef = useRef<number | null>(null);
  const handlersRef = useRef<Partial<BackgroundHandlers>>(handlers);
  const cancelledSessionsRef = useRef<Set<string>>(new Set());

  const trackEventId = useCallback(
    (message: any, sessionHint?: string, recordCursor: boolean = true): boolean => {
      const eventId = String(message?.eventId || message?.data?.eventId || '');
      if (!eventId || !eventIdRefs) return false;
      const sid =
        String(
          sessionHint || message?.data?.taskId || message?.data?.sessionId || message?.data?.parentSessionId || '',
        ) || '';
      if (!sid) return false;
      const bySession = eventIdRefs.seenEventIdsRef.current;
      const existing = bySession.get(sid) || new Set<string>();
      if (existing.has(eventId)) return true;
      existing.add(eventId);
      if (existing.size > 2000) {
        let removed = 0;
        for (const id of existing) {
          existing.delete(id);
          removed += 1;
          if (removed >= 500) break;
        }
      }
      bySession.set(sid, existing);
      if (recordCursor) {
        try {
          eventIdRefs.lastEventIdBySessionRef.current.set(sid, eventId);
        } catch {}
      }
      return false;
    },
    [eventIdRefs],
  );

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const stopConnection = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (portRef.current) {
      try {
        portRef.current.disconnect();
      } catch {}
      portRef.current = null;
    }
  }, [portRef]);

  const setupConnection = useCallback(() => {
    logger.log('[Panel] setupConnection called');
    if (portRef.current) {
      logger.log('[Panel] Connection already exists, skipping setup');
      return;
    }
    try {
      if (!chrome?.runtime) {
        throw new Error('Chrome runtime API not available');
      }

      portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });
      logger.log('[Panel] Attempting to connect to background script...');

      if (chrome.runtime.lastError) {
        logger.error('[Panel] Connection error:', chrome.runtime.lastError);
        throw new Error(chrome.runtime.lastError.message || 'Failed to connect to service worker');
      }

      try {
        portRef.current.postMessage({ type: 'panel_opened' });
      } catch {}
      logger.log('[Panel] Connection status:', {
        portName: portRef.current?.name,
        portState: portRef.current ? 'connected' : 'null',
      });

      // biome-ignore lint/suspicious/noExplicitAny: background messages are dynamic
      portRef.current.onMessage.addListener((message: any) => {
        if (message?.type !== 'heartbeat_ack') {
          try {
            const cleaned = JSON.parse(JSON.stringify(message));
            if (cleaned?.data?.screenshot) cleaned.data.screenshot = '[omitted]';
            if (Array.isArray(cleaned?.data)) {
              cleaned.data = cleaned.data.map((d: any) => ({
                ...d,
                screenshot: d && d.screenshot ? '[omitted]' : d?.screenshot,
              }));
            }
            logger.log('[Panel] Received message from background:', cleaned);
          } catch {
            logger.log('[Panel] Received message from background:', message);
          }
        }

        if (message && (message.type === EventType.EXECUTION || message.type === 'execution')) {
          let sessionMatches = true;
          let primaryId: any = null;
          let isTerminalEvent = false;
          // Discard foreign events for other sessions, but NEVER drop terminal events
          try {
            const d: any = (message as any)?.data || {};
            // Collect ALL possible session/task IDs from the event
            const possibleIds = [d?.taskId, d?.workerId, d?.parentSessionId, d?.sessionId].filter(Boolean);
            primaryId = possibleIds[0]; // For storage/logging purposes
            const eventState = String((message as any)?.state || '').toLowerCase();
            isTerminalEvent = eventState === 'task.ok' || eventState === 'task.fail' || eventState === 'task.cancel';

            // Check if ANY of the event's IDs match the current session
            // Rules:
            // - If no current session AND event has no IDs → match (system-wide events in initial state)
            // - If no current session AND event has IDs → no match (event is for a specific session we're not viewing)
            // - If current session is set → only match if event has a matching ID
            sessionMatches =
              (!sessionIdRef.current && possibleIds.length === 0) ||
              (sessionIdRef.current && possibleIds.some(id => String(id) === String(sessionIdRef.current)));

            if (isTerminalEvent) {
              try {
                if (sessionMatches) {
                  // If this is the current session, ensure any pending entry is cleared
                  chrome.storage.local.get('pending_terminal_events', res => {
                    const pending = res.pending_terminal_events || {};
                    if (primaryId && pending[primaryId]) {
                      delete pending[primaryId];
                      chrome.storage.local.set({ pending_terminal_events: pending });
                    }
                  });
                } else {
                  chrome.storage.local.get('pending_terminal_events', res => {
                    const pending = res.pending_terminal_events || {};
                    pending[String(primaryId)] = {
                      state: eventState,
                      data: d,
                      timestamp: (message as any)?.timestamp || Date.now(),
                      content: (message as any)?.data?.details || (message as any)?.content || '',
                      eventId: (message as any)?.eventId || (message as any)?.data?.eventId,
                    };
                    chrome.storage.local.set({ pending_terminal_events: pending });
                  });
                }
              } catch {}
            }
            // Only filter non-terminal events - terminal events must always be processed
            // to ensure UI updates even if user switched sessions mid-task
            if (!isTerminalEvent && !sessionMatches) {
              return;
            }
          } catch {}
          // Track cancellation to drop late mirror updates
          try {
            const state = String((message as any)?.state || (message as any)?.data?.state || '').toLowerCase();
            if (state === 'task.cancel' || state === 'task.ok' || state === 'task.fail') {
              const d: any = (message as any)?.data || {};
              const sid =
                String(d?.parentSessionId || d?.sessionId || d?.taskId || '') || String(sessionIdRef.current || '');
              if (sid) cancelledSessionsRef.current.add(sid);
            }
            // When a new v1 task starts (task.start) for the current session, clear cancel gate
            if (state === 'task.start') {
              const d: any = (message as any)?.data || {};
              const sid =
                String(d?.taskId || d?.parentSessionId || d?.sessionId || '') || String(sessionIdRef.current || '');
              if (sid && cancelledSessionsRef.current.has(sid)) cancelledSessionsRef.current.delete(sid);
            }
          } catch {}
          try {
            const d: any = (message as any)?.data || {};
            const sid =
              String(d?.taskId || d?.sessionId || d?.parentSessionId || '') || String(sessionIdRef.current || '');
            if (trackEventId(message, sid, sessionMatches)) return;
          } catch {}
          logger.log('[Panel] Processing execution event');
          // Normalize shape to AgentEvent for robustness
          const normalized: any = {
            type: EventType.EXECUTION,
            actor: (message as any).actor || (message as any)?.data?.actor || Actors.SYSTEM,
            state: (message as any).state || (message as any)?.data?.state,
            data: (message as any).data || {},
            timestamp: (message as any).timestamp || Date.now(),
            eventId: (message as any)?.eventId || (message as any)?.data?.eventId,
          };
          handlersRef.current.onExecution?.(normalized as AgentEvent);
          try {
            handlersRef.current.onExecutionMeta?.(message);
          } catch {}
        } else if (message && message.type === 'workflow_graph_update') {
          handlersRef.current.onWorkflowGraphUpdate?.(message);
        } else if (message && message.type === 'workflow_plan_dataset') {
          handlersRef.current.onWorkflowPlanDataset?.(message);
        } else if (message && message.type === 'workflow_progress') {
          handlersRef.current.onWorkflowProgress?.(message);
        } else if (message && message.type === 'final_answer') {
          handlersRef.current.onFinalAnswer?.(message);
        } else if (message && message.type === 'workflow_ended') {
          handlersRef.current.onWorkflowEnded?.(message);
        } else if (message && message.type === 'workflow_started') {
          // New run for a session: unmark it from cancelled so mirrors/progress show again
          try {
            const sid = String((message as any)?.data?.sessionId || sessionIdRef.current || '');
            if (sid && cancelledSessionsRef.current.has(sid)) {
              cancelledSessionsRef.current.delete(sid);
            }
          } catch {}
        } else if (message && message.type === 'shortcut') {
          try {
            const text = String((message as any)?.data?.text || '');
            // Route to optional shortcut handler if provided; else just append visually
            if (text) {
              try {
                (handlersRef.current as any)?.onShortcut?.(text);
              } catch {}
              if (!(handlersRef.current as any)?.onShortcut) {
                appendMessage({ actor: Actors.USER as any, content: text, timestamp: Date.now() } as any);
              }
            }
          } catch {}
        } else if (message && message.type === 'error') {
          handlersRef.current.onError?.(message);
        } else if (message && message.type === 'token_log') {
          handlersRef.current.onTokenLog?.(message);
        } else if (message && message.type === 'session_logs') {
          handlersRef.current.onSessionLogs?.(message);
        } else if (message && message.type === 'tabs-closed') {
          handlersRef.current.onTabsClosed?.(message);
        } else if (message && message.type === 'tab-mirror-update') {
          // Strict session filtering for mirror updates
          const mirrorSessionId = message?.data?.sessionId;
          // If no current session, ignore all mirror updates (prevents cross-session leakage)
          if (!sessionIdRef.current) {
            return;
          }
          // If mirror has no sessionId, ignore it (can't verify ownership)
          if (!mirrorSessionId) {
            return;
          }
          // If session IDs don't match, ignore
          if (String(mirrorSessionId) !== String(sessionIdRef.current)) {
            return;
          }
          // Skip mirror updates for cancelled sessions
          if (cancelledSessionsRef.current.has(String(mirrorSessionId))) {
            return;
          }
          // Ensure Close Tabs is visible when we have a mirror for the current session
          try {
            (handlersRef.current as any)?.setShowCloseTabs?.(true);
          } catch {}
          handlersRef.current.onTabMirrorUpdate?.(message);
        } else if (message && message.type === 'tab-mirror-batch') {
          // Strict session filtering for mirror batches
          // If no current session, ignore all batches
          if (!sessionIdRef.current) {
            return;
          }
          if (message?.data && Array.isArray(message.data)) {
            const filtered = message.data.filter((m: any) => {
              const sid = m?.sessionId;
              // Skip mirrors without sessionId (can't verify they belong to current session)
              if (!sid) return false;
              if (cancelledSessionsRef.current.has(String(sid))) return false;
              return String(sid) === String(sessionIdRef.current);
            });
            message = { ...message, data: filtered };
          }
          handlersRef.current.onTabMirrorBatch?.(message);
        } else if (message && message.type === 'tab-mirror-batch-for-cleanup') {
          handlersRef.current.onTabMirrorBatchForCleanup?.(message);
        } else if (message && message.type === 'worker_session_created') {
          handlersRef.current.onWorkerSessionCreated?.(message);
        } else if (message && message.type === 'history_context_updated') {
          (handlersRef.current as any).onHistoryContextUpdated?.(message);
        } else if (message && message.type === 'history_context_status') {
          (handlersRef.current as any).onHistoryContextStatus?.(message);
        } else if (message && message.type === 'cancel_task_result') {
          handlersRef.current.onCancelTaskResult?.(message);
        } else if (message && message.type === 'kill_all_complete') {
          handlersRef.current.onKillAllComplete?.(message);
        } else if (message && message.type === 'restore_active_session') {
          handlersRef.current.onRestoreActiveSession?.(message.data || {});
        } else if (message && message.type === 'restore_view_state') {
          handlersRef.current.onRestoreViewState?.(message.data || {});
        } else if (message && message.type === 'buffered_session_events') {
          // Process buffered events for a subscribed session
          const events = message.events || [];
          for (const event of events) {
            if (event.type === 'execution' || event.type === EventType.EXECUTION) {
              if (trackEventId(event, message.sessionId)) {
                continue;
              }
              const normalized: any = {
                type: EventType.EXECUTION,
                actor: event.actor || event?.data?.actor || Actors.SYSTEM,
                state: event.state || event?.data?.state,
                data: event.data || {},
                timestamp: event.timestamp || Date.now(),
                eventId: event.eventId || event?.data?.eventId,
              };
              handlersRef.current.onExecution?.(normalized as AgentEvent);
            }
          }
        } else if (message && message.type === 'session_subscribed') {
          logger.log('[Panel] Subscribed to session:', message.sessionId);
          try {
            handlersRef.current.onSessionSubscribed?.(message);
          } catch {}
        } else if (message && message.type === 'trajectory_state') {
          // Merge trajectory state from background's in-memory data (additive only)
          const { sessionId, data } = message;
          logger.log('[Panel] Received trajectory_state', {
            sessionId,
            currentSession: sessionIdRef.current,
            matches: String(sessionId) === String(sessionIdRef.current),
            hasData: !!data,
            rootId: data?.rootId,
            traceItemCount: data?.traceItems?.length,
            isCompleted: data?.isCompleted,
            hasFinalPreview: !!data?.finalPreview,
            hasFinalPreviewBatch: !!data?.finalPreviewBatch,
          });
          if (String(sessionId) === String(sessionIdRef.current) && data) {
            try {
              const { rootId, traceItems, workerItems, isCompleted, finalPreview, finalPreviewBatch } = data;
              if (rootId) {
                logger.log('[Panel] Applying trajectory_state', { rootId, traceItemCount: traceItems?.length });
                (handlersRef.current as any)?.setAgentTraceRootId?.(rootId);
                (handlersRef.current as any)?.setMessageMetadata?.((prev: any) => {
                  const existing = prev?.[rootId] || {};
                  // Merge trace items with deduplication by timestamp
                  const existingItems = existing?.traceItems || [];
                  const existingIds = new Set(
                    existingItems.map((t: any) => String((t as any)?.eventId || '')).filter(Boolean),
                  );
                  const existingTs = new Set(existingItems.map((t: any) => t.timestamp));
                  const newItems = (traceItems || []).filter((t: any) => {
                    const id = String((t as any)?.eventId || '');
                    if (id) return !existingIds.has(id);
                    return !existingTs.has(t.timestamp);
                  });
                  const merged = [...existingItems, ...newItems].sort((a: any, b: any) => a.timestamp - b.timestamp);

                  logger.log('[Panel] trajectory_state merge result', {
                    existingCount: existingItems.length,
                    newCount: newItems.length,
                    mergedCount: merged.length,
                  });

                  return {
                    ...prev,
                    __sessionRootId: rootId,
                    [rootId]: {
                      ...existing,
                      traceItems: merged,
                      // Only update workerItems if we have new data
                      ...(workerItems?.length ? { workerItems } : {}),
                      // Only set isCompleted to true, never back to false
                      isCompleted: existing.isCompleted || isCompleted || false,
                      // Preserve existing final preview data, only add if not present
                      ...(finalPreview && !existing.finalPreview ? { finalPreview } : {}),
                      ...(finalPreviewBatch?.length && !existing.finalPreviewBatch?.length
                        ? { finalPreviewBatch }
                        : {}),
                    },
                  };
                });
              }
            } catch (e) {
              logger.error('[Panel] Failed to apply trajectory_state:', e);
            }
          }
        } else if (message && message.type === 'heartbeat_ack') {
          // ignore
        }
      });

      portRef.current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          logger.error('Service worker disconnected with error:', error.message);
        } else {
          logger.log('Service worker connection closed');
        }

        if (error) {
          appendMessage({
            actor: Actors.SYSTEM as any,
            content: error.message || 'Connection to service worker lost. Please reload the extension.',
            timestamp: Date.now(),
          } as any);
        }

        portRef.current = null;
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        try {
          handlersRef.current.onDisconnect?.(error);
        } catch {}
      });

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === 'side-panel-connection') {
          try {
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            logger.error('Heartbeat failed:', error);
            stopConnection();
          }
        } else {
          stopConnection();
        }
      }, 25000);
    } catch (error) {
      logger.error('Failed to establish connection:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appendMessage({
        actor: Actors.SYSTEM as any,
        content: `Failed to connect to service worker: ${errorMessage}`,
        timestamp: Date.now(),
      } as any);
      portRef.current = null;
    }
  }, [appendMessage, logger, portRef, sessionIdRef, stopConnection, trackEventId]);

  const sendMessage = useCallback(
    (message: any) => {
      if (portRef.current?.name !== 'side-panel-connection') {
        logger.error('[Panel] Connection check failed:', {
          portExists: !!portRef.current,
          portName: portRef.current?.name,
        });
        throw new Error('No valid connection available');
      }
      try {
        portRef.current.postMessage(message);
      } catch (error) {
        logger.error('Failed to send message:', error);
        stopConnection();
        throw error;
      }
    },
    [logger, portRef, stopConnection],
  );

  return { setupConnection, stopConnection, sendMessage };
}
