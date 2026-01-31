/** System Event Handler - Manages task lifecycle (start/ok/fail/cancel/pause/resume) and dashboard integration */

import { Actors, chatHistoryStore } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import type { EventHandlerCreator } from './create-task-event-handler';
import {
  updateWorkerProgress,
  handleWorkerTabCreated,
  handleSingleAgentTabCreated,
  updateTabGroupColor,
  reconstructWorkerTabGroupsFromPreview,
  shouldShowCloseTabs,
  addRunningAgent,
  moveToCompleted,
} from './utils';
import {
  parseJobSummary,
  storeJobSummary,
  updateRequestSummary,
  updateLastAgentMessageSummary,
  updateAggregateRootSummary,
  addTraceItem,
  markAggregateComplete,
  persistFinalPreview,
} from './utils';
import { taskIdToEstimatorRootId } from './estimator-event-handler';

/** Creates the System event handler */
export const createSystemHandler: EventHandlerCreator = deps => {
  const { logger } = deps;

  /** Check if a terminal event is for the current session */
  const isEventForCurrentSession = (eventData: any): boolean => {
    // Check both taskId and sessionId (background sends sessionId, some events use taskId)
    const eventSessionId = String(eventData?.taskId || eventData?.sessionId || '');
    const currentSessionId = String(deps.sessionIdRef.current || '');
    // If no session in panel, don't update UI (background handles persistence)
    if (!currentSessionId) return false;
    // If event has no session identifier, skip (don't assume it's for current session)
    if (!eventSessionId) return false;
    // Only process if explicitly for current session
    return eventSessionId === currentSessionId;
  };

  return event => {
    const state = event.state;
    const timestamp = event.timestamp || Date.now();
    const data = (event as any)?.data || {};
    const content = data?.details ?? (event as any)?.content ?? '';

    // Update worker progress for multiagent mode
    try {
      updateWorkerProgress(event, deps);
    } catch {}

    // Handle tab creation
    try {
      if (state === ExecutionState.TAB_CREATED && data?.tabId) {
        if (data?.workerId) handleWorkerTabCreated(event, deps);
        else handleSingleAgentTabCreated(event, deps);
      }
    } catch {}

    switch (state) {
      case ExecutionState.TAB_GROUP_UPDATED:
        updateTabGroupColor(event, deps);
        break;

      case ExecutionState.TASK_START: {
        // CRITICAL: Only reset trajectory state if this event is for the CURRENT session
        // Otherwise we'd wipe out the restored rootId when switching between sessions
        if (isEventForCurrentSession(data)) {
          deps.setIsJobActive(true);
          deps.workflowEndedRef.current = false;
          deps.setShowStopButton(true);
          deps.setIsHistoricalSession(false);
          // Clear preview state for all task types to ensure fresh preview on new tasks
          deps.setHasFirstPreview(false);
          deps.setMirrorPreview(null);
          deps.setMirrorPreviewBatch([]);
          deps.runStartedAtRef.current = timestamp;
          deps.setWorkerTabGroups([]);
          try {
            deps.laneColorByLaneRef.current.clear();
          } catch {}
          if (deps.getCurrentTaskAgentType() !== 'multiagent') {
            if (deps.agentTraceRootIdRef.current) markAggregateComplete(deps);
            deps.setAgentTraceRootId(null);
            deps.agentTraceActiveRef.current = false;
            deps.setActiveAggregateMessageId(null);
          }
          deps.setShowCloseTabs(false);
        }
        // Always update dashboard state regardless of which session the event is for
        try {
          const taskId = String(data?.taskId || deps.sessionIdRef.current || '');
          if (taskId) addRunningAgent(taskId, deps);
        } catch {}
        try {
          if (data?.taskId) {
            deps.taskIdToRootIdRef.current.delete(String(data.taskId));
            deps.lastAgentMessageByTaskRef.current.delete(String(data.taskId));
          }
        } catch {}
        break;
      }

      case ExecutionState.TASK_OK: {
        const taskId = String(data?.taskId || data?.sessionId || deps.sessionIdRef.current || '');
        logger.log('[TASK_OK] Starting handler', {
          taskId,
          sessionId: deps.sessionIdRef.current,
          hasContent: !!content,
          contentPreview: content?.substring?.(0, 100),
          agentTraceRootId: deps.agentTraceRootIdRef.current,
          agentType: deps.getCurrentTaskAgentType?.(),
        });
        // Always update dashboard
        try {
          if (taskId) moveToCompleted(taskId, 'completed', deps);
        } catch {}
        // Clear pending terminal cache for this task
        try {
          chrome.storage.local.get('pending_terminal_events', res => {
            const pending = res.pending_terminal_events || {};
            if (pending[taskId]) {
              delete pending[taskId];
              chrome.storage.local.set({ pending_terminal_events: pending });
            }
          });
        } catch {}

        const isCurrentSession = isEventForCurrentSession(data);

        // Background persistence handles non-current sessions to prevent duplicates.

        // Only update current session's UI
        if (isCurrentSession) {
          deps.setIsJobActive(false);
          deps.workflowEndedRef.current = true;
          deps.setIsFollowUpMode(true);
          deps.setInputEnabled(true);
          deps.setShowStopButton(false);
          deps.setIsReplaying(false);
          try {
            if (deps.portRef.current?.name === 'side-panel-connection')
              deps.portRef.current.postMessage({ type: 'get-all-mirrors-for-cleanup' });
          } catch {}
          try {
            if (shouldShowCloseTabs(deps, data)) {
              reconstructWorkerTabGroupsFromPreview(deps);
              deps.setShowCloseTabs(true);
            }
          } catch {}
          deps.setIsAgentModeActive(false);
          deps.setActiveAggregateMessageId(null); // Clear to prevent stale preview binding
          logger.log('[TASK_OK] Persisting final preview');
          persistFinalPreview(deps);
          // Clear live preview state so UI falls back to persisted finalPreview
          logger.log('[TASK_OK] Clearing live preview state');
          deps.setMirrorPreview(null);
          deps.setMirrorPreviewBatch([]);
          deps.setHasFirstPreview(false);
          const isCurrentlyBrowserUse = deps.getCurrentTaskAgentType() === 'agent';
          logger.log('[TASK_OK] Checking if should add final trace', {
            hasRootId: !!deps.agentTraceRootIdRef.current,
            agentType: deps.getCurrentTaskAgentType?.(),
            isCurrentlyBrowserUse,
          });
          if (
            deps.agentTraceRootIdRef.current &&
            deps.getCurrentTaskAgentType() !== 'multiagent' &&
            isCurrentlyBrowserUse
          ) {
            // Only add a final trace item if we have actual output content
            // Don't show generic "Task completed successfully" - it's redundant
            if (content && content !== 'Task completed successfully') {
              logger.log('[TASK_OK] Adding final trace item:', content.substring(0, 100));
              addTraceItem(Actors.SYSTEM, content, timestamp, deps);
            } else {
              logger.log('[TASK_OK] Skipping generic completion message');
            }
            markAggregateComplete(deps);
          } else if (deps.agentTraceRootIdRef.current && !isCurrentlyBrowserUse) {
            logger.log('[TASK_OK] Marking aggregate complete (non-browser-use)');
            markAggregateComplete(deps);
          } else {
            logger.log('[TASK_OK] Skipping trace - no rootId or multiagent');
          }
          try {
            const taskId = String(data?.taskId || deps.sessionIdRef.current || '');
            const estimatorRootId = taskIdToEstimatorRootId.get(taskId);
            if (estimatorRootId) {
              deps.setMessageMetadata((prev: any) => ({
                ...prev,
                [estimatorRootId]: { ...prev[estimatorRootId], isCompleted: true, workflowEndTime: timestamp },
              }));
              taskIdToEstimatorRootId.delete(taskId);
            }
          } catch {}
          const summary = parseJobSummary(data);
          logger.log('[TASK_OK Debug] Summary parsing result', {
            hasSummary: !!summary,
            rawDataKeys: Object.keys(data || {}),
            hasDataSummary: !!(data as any)?.summary,
            hasDataMessage: !!(data as any)?.message,
            summaryData: summary
              ? {
                  cost: summary.totalCost,
                  inputTokens: summary.totalInputTokens,
                  outputTokens: summary.totalOutputTokens,
                  latency: summary.totalLatencySeconds,
                }
              : null,
          });
          if (summary) {
            const taskId = String(data?.taskId || data?.sessionId || deps.sessionIdRef.current || 'unknown');
            logger.log('[TASK_OK Debug] Storing job summary', {
              taskId,
              agentTraceRootId: deps.agentTraceRootIdRef.current,
              hasLastAgentMessage: !!deps.lastAgentMessageRef.current,
              summaryTokens: summary.totalInputTokens + summary.totalOutputTokens,
              summaryCost: summary.totalCost,
            });
            // storeJobSummary handles updateSessionStats with deduplication
            if (storeJobSummary(summary, taskId, 'task.ok', deps)) {
              if (deps.lastAgentMessageRef.current) {
                logger.log('[TASK_OK Debug] Updating last agent message summary');
                updateLastAgentMessageSummary(summary, deps);
              }
              if (deps.agentTraceRootIdRef.current) {
                logger.log('[TASK_OK Debug] Updating aggregate root summary', {
                  rootId: deps.agentTraceRootIdRef.current,
                });
                updateAggregateRootSummary(summary, deps);
              }
              if (!deps.lastAgentMessageRef.current && deps.agentTraceRootIdRef.current) {
                updateAggregateRootSummary(summary, deps);
                deps.logger.log(
                  '[Panel] Stored job summary for agent aggregate message:',
                  deps.agentTraceRootIdRef.current,
                );
              }
            }
          } else {
            logger.log('[TASK_OK Debug] No summary found in event data');
          }
          // Clear the aggregate root state (not just ref) so UI updates
          // NOTE: We keep agentTraceRootIdRef.current set until multiagent is complete
          // but clear the active state to hide the live preview panel
          if (deps.getCurrentTaskAgentType() !== 'multiagent') {
            deps.agentTraceRootIdRef.current = null;
          }
        }
        break;
      }

      case ExecutionState.TASK_FAIL: {
        const taskId = String(data?.taskId || deps.sessionIdRef.current || '');
        // Always update dashboard
        try {
          if (taskId) moveToCompleted(taskId, 'failed', deps);
        } catch {}
        // Clear pending terminal cache for this task
        try {
          chrome.storage.local.get('pending_terminal_events', res => {
            const pending = res.pending_terminal_events || {};
            if (pending[taskId]) {
              delete pending[taskId];
              chrome.storage.local.set({ pending_terminal_events: pending });
            }
          });
        } catch {}

        const isFailCurrentSession = isEventForCurrentSession(data);
        const failText = content || 'Task failed';

        // Persist message to storage for non-current sessions
        if (!isFailCurrentSession) {
          const failedSessionId = String(data?.sessionId || data?.taskId || '');
          if (failedSessionId) {
            try {
              chatHistoryStore.addMessage(failedSessionId, {
                actor: Actors.SYSTEM,
                content: failText,
                timestamp,
              } as any);
            } catch {}
          }
        }

        // Only update current session's UI
        if (isFailCurrentSession) {
          deps.setIsJobActive(false);
          deps.workflowEndedRef.current = true;
          deps.setIsFollowUpMode(true);
          deps.setInputEnabled(true);
          deps.setShowStopButton(false);
          deps.setIsReplaying(false);
          deps.setActiveAggregateMessageId(null);
          try {
            if (deps.portRef.current?.name === 'side-panel-connection')
              deps.portRef.current.postMessage({ type: 'get-all-mirrors-for-cleanup' });
          } catch {}
          try {
            if (shouldShowCloseTabs(deps, data)) {
              reconstructWorkerTabGroupsFromPreview(deps);
              deps.setShowCloseTabs(true);
            }
          } catch {}
          deps.setIsAgentModeActive(false);
          const failSummary = parseJobSummary(data);
          if (failSummary) {
            const taskId = String(data?.taskId || deps.sessionIdRef.current || 'unknown');
            if (storeJobSummary(failSummary, taskId, 'task.fail', deps)) {
              if (deps.lastAgentMessageRef.current) updateLastAgentMessageSummary(failSummary, deps);
              if (deps.agentTraceRootIdRef.current) updateAggregateRootSummary(failSummary, deps);
            }
          }
          if (deps.getCurrentTaskAgentType() !== 'multiagent' && deps.agentTraceRootIdRef.current) {
            addTraceItem(Actors.SYSTEM, failText, timestamp, deps);
            markAggregateComplete(deps);
          }
          try {
            const taskId = String(data?.taskId || deps.sessionIdRef.current || '');
            const estimatorRootId = taskIdToEstimatorRootId.get(taskId);
            if (estimatorRootId) {
              deps.setMessageMetadata((prev: any) => ({
                ...prev,
                [estimatorRootId]: { ...prev[estimatorRootId], isCompleted: true, workflowEndTime: timestamp },
              }));
              taskIdToEstimatorRootId.delete(taskId);
            }
          } catch {}
          persistFinalPreview(deps);
          // Clear live preview state so UI falls back to persisted finalPreview
          deps.setMirrorPreview(null);
          deps.setMirrorPreviewBatch([]);
          deps.setHasFirstPreview(false);
          if (deps.getCurrentTaskAgentType() !== 'multiagent') deps.agentTraceRootIdRef.current = null;
        }
        break;
      }

      case ExecutionState.TASK_CANCEL: {
        const taskId = String(data?.taskId || deps.sessionIdRef.current || '');
        // Always update dashboard
        try {
          if (taskId) moveToCompleted(taskId, 'cancelled', deps);
        } catch {}
        // Clear pending terminal cache for this task
        try {
          chrome.storage.local.get('pending_terminal_events', res => {
            const pending = res.pending_terminal_events || {};
            if (pending[taskId]) {
              delete pending[taskId];
              chrome.storage.local.set({ pending_terminal_events: pending });
            }
          });
        } catch {}

        const isCancelCurrentSession = isEventForCurrentSession(data);

        // Persist message to storage for non-current sessions
        if (!isCancelCurrentSession) {
          const cancelledSessionId = String(data?.sessionId || data?.taskId || '');
          if (cancelledSessionId) {
            try {
              chatHistoryStore.addMessage(cancelledSessionId, {
                actor: Actors.SYSTEM,
                content: 'Task cancelled',
                timestamp,
              } as any);
            } catch {}
          }
        }

        // Only update current session's UI
        if (isCancelCurrentSession) {
          deps.setIsJobActive(false);
          deps.workflowEndedRef.current = true;
          deps.setIsFollowUpMode(true);
          deps.setInputEnabled(true);
          deps.setShowStopButton(false);
          deps.setIsReplaying(false);
          deps.setIsPaused(false);
          deps.setActiveAggregateMessageId(null);
          try {
            if (deps.portRef.current?.name === 'side-panel-connection')
              deps.portRef.current.postMessage({ type: 'get-all-mirrors-for-cleanup' });
          } catch {}
          try {
            if (deps.getWorkerTabGroups().length > 0 || deps.getCurrentTaskAgentType() === 'multiagent')
              deps.setShowCloseTabs(true);
          } catch {}
          deps.setMessages((prev: any[]) =>
            prev.filter((msg: any, idx: number) => !(msg.content === 'Showing progress...' && idx === prev.length - 1)),
          );
          persistFinalPreview(deps);
          // Clear live preview state so UI falls back to persisted finalPreview
          deps.setMirrorPreview(null);
          deps.setMirrorPreviewBatch([]);
          deps.setHasFirstPreview(false);
          try {
            const isAgentV2 = deps.getCurrentTaskAgentType() === 'multiagent';
            const cancelKey = `${deps.sessionIdRef.current || data?.taskId || 'unknown'}:cancelled`;
            const summaryData = parseJobSummary(data);
            if (!isAgentV2 && !deps.processedJobSummariesRef.current.has(cancelKey)) {
              deps.appendMessage({ actor: Actors.SYSTEM, content: 'Task cancelled', timestamp });
              deps.processedJobSummariesRef.current.add(cancelKey);
            }
            if (!isAgentV2) {
              const messageId = `${timestamp}-${Actors.SYSTEM}`;
              const requestSummary = {
                inputTokens: Number(summaryData?.totalInputTokens) || 0,
                outputTokens: Number(summaryData?.totalOutputTokens) || 0,
                latency: summaryData?.totalLatencySeconds?.toString() || '0.00',
                cost: Number(summaryData?.totalCost) || 0,
                apiCalls: Number(summaryData?.apiCallCount) || 0,
                modelName: summaryData?.modelName,
                provider: summaryData?.provider,
              };
              updateRequestSummary(messageId, requestSummary as any, deps);
              if (summaryData) storeJobSummary(summaryData, deps.sessionIdRef.current || '', 'task.cancel', deps);
              try {
                const taskId = String(data?.taskId || deps.sessionIdRef.current || '');
                if (taskId) {
                  deps.cancelSummaryTargetsRef.current.set(taskId, messageId);
                  if (deps.portRef.current?.name === 'side-panel-connection')
                    deps.portRef.current.postMessage({ type: 'get_token_log', taskId });
                }
              } catch {}
            }
          } catch {}
          try {
            if (shouldShowCloseTabs(deps, data)) deps.setShowCloseTabs(true);
          } catch {}
          deps.setIsAgentModeActive(false);
          if (deps.agentTraceRootIdRef.current) {
            addTraceItem(Actors.SYSTEM, 'Task cancelled', timestamp, deps);
            markAggregateComplete(deps);
            try {
              if (deps.sessionIdRef.current)
                chatHistoryStore.addMessage(deps.sessionIdRef.current, {
                  actor: Actors.SYSTEM,
                  content: 'Task cancelled',
                  timestamp,
                } as any);
            } catch {}
          }
          try {
            const taskId = String(data?.taskId || deps.sessionIdRef.current || '');
            const estimatorRootId = taskIdToEstimatorRootId.get(taskId);
            if (estimatorRootId) {
              deps.setMessageMetadata((prev: any) => ({
                ...prev,
                [estimatorRootId]: { ...prev[estimatorRootId], isCompleted: true, workflowEndTime: timestamp },
              }));
              taskIdToEstimatorRootId.delete(taskId);
            }
          } catch {}
          deps.agentTraceRootIdRef.current = null;
        }
        break;
      }

      case ExecutionState.TASK_PAUSE:
        deps.setIsPaused(true);
        deps.setInputEnabled(true);
        deps.setShowStopButton(true);
        try {
          if (data?.message) {
            const payload = JSON.parse(data.message);
            if (payload?.type === 'request_user_control') {
              const formattedMessage = `**Agent requesting control handover**\n\n${payload.reason || 'Agent paused for human intervention'}\n\n*Click "Take Control" or "Hand back control" to continue.*`;
              if (deps.agentTraceRootIdRef.current) {
                addTraceItem(Actors.SYSTEM, formattedMessage, timestamp, deps, { controlRequest: payload });
              } else {
                deps.appendMessage({ actor: Actors.SYSTEM, content: formattedMessage, timestamp });
                const messageId = `${timestamp}-${Actors.SYSTEM}`;
                deps.setMessageMetadata((prev: any) => ({
                  ...prev,
                  [messageId]: {
                    ...prev[messageId],
                    traceItems: [
                      { actor: Actors.SYSTEM, content: formattedMessage, timestamp, controlRequest: payload },
                    ],
                  },
                }));
              }
            }
          }
        } catch {}
        break;

      case ExecutionState.TASK_RESUME:
        deps.setIsPaused(false);
        if (deps.agentTraceRootIdRef.current) addTraceItem(Actors.SYSTEM, 'Resumed by user', timestamp, deps);
        break;

      case ExecutionState.STEP_START:
      case ExecutionState.STEP_OK:
        break;

      default:
        logger.error('Invalid task state', state);
        return;
    }
  };
};
