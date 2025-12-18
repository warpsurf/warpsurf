/** Estimator Event Handler - Manages cost estimation and approval flow for multiagent workflows */

import { Actors } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import { formatDuration } from '../../utils';
import type { EventHandlerCreator } from './create-task-event-handler';

// Track the mapping between taskId and estimator message rootId
// This ensures each estimation workflow updates its own message, not a previous one
// Exported for use by system event handler when marking workflow complete
export const taskIdToEstimatorRootId = new Map<string, string>();

/** Creates the Estimator event handler */
export const createEstimatorHandler: EventHandlerCreator = (deps) => {
  const { logger, appendMessage, setMessages, setMessageMetadata, getMessages, setPendingEstimation,
    getRecalculatedEstimation, setInputEnabled, setShowStopButton, setIsJobActive } = deps;

  return (event) => {
    const state = event.state;
    const timestamp = event.timestamp || Date.now();
    const data = (event as any)?.data || {};
    const content = data?.details ?? (event as any)?.content ?? '';
    const taskId = String(data?.taskId || '');

    // Helper to find the estimator message for the current task
    const findEstimatorMsgIndex = (messages: any[]): number => {
      const rootId = taskIdToEstimatorRootId.get(taskId);
      if (rootId) {
        // Find by exact rootId match (timestamp + actor)
        const idx = messages.findIndex((m: any) => 
          m.actor === Actors.ESTIMATOR && `${m.timestamp}-${m.actor}` === rootId
        );
        if (idx !== -1) return idx;
      }
      // Fallback: find the LAST estimator message (most recent one)
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].actor === Actors.ESTIMATOR) return i;
      }
      return -1;
    };

    // Helper to get the rootId for the current task's estimator message
    const getEstimatorRootId = (): string | null => {
      return taskIdToEstimatorRootId.get(taskId) || null;
    };

    switch (state) {
      case ExecutionState.STEP_START: {
        const rootTimestamp = timestamp;
        const rootId = `${rootTimestamp}-${Actors.ESTIMATOR}`;
        if (taskId) taskIdToEstimatorRootId.set(taskId, rootId);
        appendMessage({ actor: Actors.ESTIMATOR, content: 'Estimating workflow...', timestamp: rootTimestamp });
        setMessageMetadata((prev: any) => {
          const existing = prev[rootId] || {};
          const traceItems = existing.traceItems || [];
          return { ...prev, [rootId]: { ...existing, taskId,
            traceItems: [...traceItems, { actor: Actors.ESTIMATOR, content: 'Starting estimation...', timestamp }] } };
        });
        break;
      }

      case ExecutionState.ESTIMATION_PENDING: {
        try {
          const messageStr = data?.message;
          if (!messageStr) return;
          const estimation = JSON.parse(messageStr);
          setPendingEstimation(estimation);
          setMessages((prev: any[]) => {
            const idx = findEstimatorMsgIndex(prev);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], content: 'Workflow estimation ready - awaiting approval' };
              return updated;
            }
            return prev;
          });
          const rootId = getEstimatorRootId();
          if (rootId) {
            // Store base estimation - actual display values (with latency) will be shown in popup
            // and stored in metadata during ESTIMATION_APPROVED
            setMessageMetadata((prev: any) => {
              const existing = prev[rootId] || {};
              const traceItems = existing.traceItems || [];
              return { ...prev, [rootId]: { ...existing,
                traceItems: [...traceItems, { actor: Actors.ESTIMATOR, content: 'Estimation ready - review details below', timestamp }],
                estimation } };
            });
          }
        } catch (e) {
          logger.error('[Panel] Failed to parse estimation:', e);
        }
        break;
      }

      case ExecutionState.ESTIMATION_APPROVED: {
        // Get estimation from event data (with latency adjustments) or fallback
        const recalculatedEst = data?.estimation || getRecalculatedEstimation();
        setPendingEstimation(null);
        setMessages((prev: any[]) => {
          const idx = findEstimatorMsgIndex(prev);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], content: '✓ Workflow approved, starting task...' };
            return updated;
          }
          return prev;
        });
        const rootId = getEstimatorRootId();
        if (rootId) {
          setMessageMetadata((prev: any) => {
            const existing = prev[rootId] || {};
            const traceItems = existing.traceItems || [];
            const estimationToUse = recalculatedEst || existing.estimation;
            // Build approval trace with final (latency-adjusted) values
            const summary = estimationToUse?.summary;
            // Safely format cost - handle null/NaN/negative (-1 means no pricing available)
            const costValue = summary?.estimated_cost_usd;
            const hasCost = costValue != null && !isNaN(costValue) && costValue >= 0;
            const costStr = hasCost ? `~$${costValue.toFixed(3)}` : '';
            const approvalContent = summary 
              ? `Approved: ${formatDuration(summary.total_agent_duration_s || 0)} estimated${costStr ? ', ' + costStr : ''}`
              : 'User approved workflow';
            return { ...prev, [rootId]: { ...existing, estimation: estimationToUse,
              traceItems: [...traceItems, { actor: Actors.ESTIMATOR, content: approvalContent, timestamp }],
              workflowStartTime: timestamp } };
          });
        }
        break;
      }

      case ExecutionState.ESTIMATION_CANCELLED: {
        setPendingEstimation(null);
        setInputEnabled(true);
        setShowStopButton(false);
        setIsJobActive(false);
        setMessages((prev: any[]) => {
          const idx = findEstimatorMsgIndex(prev);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], content: '✗ Workflow cancelled by user' };
            return updated;
          }
          return prev;
        });
        const rootId = getEstimatorRootId();
        if (rootId) {
          setMessageMetadata((prev: any) => {
            const existing = prev[rootId] || {};
            const traceItems = existing.traceItems || [];
            return { ...prev, [rootId]: { ...existing,
              traceItems: [...traceItems, { actor: Actors.ESTIMATOR, content: 'User cancelled workflow', timestamp }],
              isCompleted: true } };
          });
          taskIdToEstimatorRootId.delete(taskId);
        }
        break;
      }

      case ExecutionState.STEP_FAIL: {
        setPendingEstimation(null);
        setMessages((prev: any[]) => {
          const estimatorMsgIndex = findEstimatorMsgIndex(prev);
          if (estimatorMsgIndex !== -1) {
            const updated = [...prev];
            updated[estimatorMsgIndex] = { ...updated[estimatorMsgIndex], content: content || 'Estimation failed' };
            return updated;
          }
          return prev;
        });
        const rootId = getEstimatorRootId();
        if (rootId) {
          setMessageMetadata((prev: any) => {
            const existing = prev[rootId] || {};
            return { ...prev, [rootId]: { ...existing, isCompleted: true } };
          });
          // Clean up the mapping
          taskIdToEstimatorRootId.delete(taskId);
        }
        break;
      }

      default:
        logger.error('Invalid estimator state', state);
        return;
    }
  };
};
