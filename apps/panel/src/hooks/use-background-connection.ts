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
  onDisconnect?: (error?: any) => void;
};

interface UseBackgroundConnectionParams {
  portRef: MutableRefObject<chrome.runtime.Port | null>;
  sessionIdRef: MutableRefObject<string | null>;
  logger: { log: (...args: any[]) => void; error: (...args: any[]) => void };
  appendMessage: (msg: { actor: any; content: string; timestamp: number }) => void;
  handlers: Partial<BackgroundHandlers>;
}

export function useBackgroundConnection(params: UseBackgroundConnectionParams) {
  const { portRef, sessionIdRef, logger, appendMessage, handlers } = params;
  const heartbeatIntervalRef = useRef<number | null>(null);
  const handlersRef = useRef<Partial<BackgroundHandlers>>(handlers);
  const cancelledSessionsRef = useRef<Set<string>>(new Set());

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
          // Discard foreign events for other sessions, but NEVER drop terminal events
          try {
            const d: any = (message as any)?.data || {};
            const incomingTaskId = d?.taskId || d?.workerId || d?.parentSessionId || d?.sessionId;
            const eventState = String((message as any)?.state || '').toLowerCase();
            const isTerminalEvent =
              eventState === 'task.ok' || eventState === 'task.fail' || eventState === 'task.cancel';
            // Debug: log terminal events
            if (isTerminalEvent) {
              console.log('[Panel] Terminal event received:', {
                eventState,
                incomingTaskId,
                currentSession: sessionIdRef.current,
              });
              // Persist terminal events for other sessions so they can be applied when user opens that session
              try {
                if (
                  !sessionIdRef.current ||
                  !incomingTaskId ||
                  String(incomingTaskId) === String(sessionIdRef.current)
                ) {
                  // If this is the current session, ensure any pending entry is cleared
                  chrome.storage.local.get('pending_terminal_events', res => {
                    const pending = res.pending_terminal_events || {};
                    if (incomingTaskId && pending[incomingTaskId]) {
                      delete pending[incomingTaskId];
                      chrome.storage.local.set({ pending_terminal_events: pending });
                    }
                  });
                } else {
                  chrome.storage.local.get('pending_terminal_events', res => {
                    const pending = res.pending_terminal_events || {};
                    pending[String(incomingTaskId)] = {
                      state: eventState,
                      data: d,
                      timestamp: (message as any)?.timestamp || Date.now(),
                      content: (message as any)?.data?.details || (message as any)?.content || '',
                    };
                    chrome.storage.local.set({ pending_terminal_events: pending });
                  });
                }
              } catch {}
            }
            // Only filter non-terminal events - terminal events must always be processed
            // to ensure UI updates even if user switched sessions mid-task
            if (
              !isTerminalEvent &&
              sessionIdRef.current &&
              incomingTaskId &&
              String(incomingTaskId) !== String(sessionIdRef.current)
            ) {
              return;
            }
          } catch {}
          // Track cancellation to drop late mirror updates
          try {
            const state = String((message as any)?.state || (message as any)?.data?.state || '').toLowerCase();
            if (state === 'task.cancel') {
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
          logger.log('[Panel] Processing execution event');
          // Normalize shape to AgentEvent for robustness
          const normalized: any = {
            type: EventType.EXECUTION,
            actor: (message as any).actor || (message as any)?.data?.actor || Actors.SYSTEM,
            state: (message as any).state || (message as any)?.data?.state,
            data: (message as any).data || {},
            timestamp: (message as any).timestamp || Date.now(),
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
          // Ensure Close Tabs is visible when we have a mirror for the current session
          try {
            (handlersRef.current as any)?.setShowCloseTabs?.(true);
          } catch {}
          handlersRef.current.onTabMirrorUpdate?.(message);
        } else if (message && message.type === 'tab-mirror-batch') {
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
  }, [appendMessage, logger, portRef, sessionIdRef, stopConnection]);

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
