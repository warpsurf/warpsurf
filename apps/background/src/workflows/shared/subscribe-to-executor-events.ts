import { Executor } from '@src/executor/executor';
import { ExecutionState } from '@src/workflows/shared/event/types';
import { globalTokenTracker } from '@src/utils/token-tracker';
import { sessionLogArchive } from '@src/utils/session-log-archive';

/** Port getter for dynamic resolution (handles panel reconnection) */
type PortGetter = () => chrome.runtime.Port | null;

/** Options for event buffering when port is disconnected */
type BufferOptions = {
  eventBuffer: any[];
  maxSize: number;
};

export async function subscribeToExecutorEvents(
  executor: Executor,
  getPort: PortGetter,
  taskManager: any,
  logger: { warning: Function; debug: Function },
  onTaskFinished?: (executor: Executor) => void,
  bufferOptions?: BufferOptions,
) {
  if ((executor as any).__backgroundSubscribed) {
    logger.warning('Executor already has background subscription, skipping duplicate');
    return;
  }
  (executor as any).__backgroundSubscribed = true;

  executor.subscribeExecutionEvents(async event => {
    // On each new run, archive existing tokens then reset for this task
    try {
      if (event.state === ExecutionState.TASK_START) {
        const taskId: string | undefined = (event as any)?.data?.taskId;
        if (taskId) {
          // Archive existing tokens (e.g., from auto triage) before clearing
          try {
            const existing = (globalTokenTracker as any)?.getTokensForTask?.(String(taskId)) || [];
            if (existing.length > 0) {
              sessionLogArchive.append(String(taskId), existing);
            }
          } catch {}
          try {
            (globalTokenTracker as any)?.clearTokensForTask?.(String(taskId));
          } catch {}
          try {
            (globalTokenTracker as any)?.setCurrentTaskId?.(String(taskId));
          } catch {}
        }
      }
    } catch {}

    try {
      const currentPort = getPort();

      // Build base event (needed whether we send now or buffer)
      const baseDataBuilder = () => {
        const base: any = { ...event.data, taskId: event.data?.taskId };
        try {
          const t = event.data?.taskId ? taskManager.getTask(event.data.taskId) : undefined;
          if (t) {
            base.agentColor = t.color;
            base.agentName = t.name;
          }
        } catch {}
        return base;
      };

      const isTerminal =
        event.state === ExecutionState.TASK_OK ||
        event.state === ExecutionState.TASK_FAIL ||
        event.state === ExecutionState.TASK_CANCEL;

      const outEvent: any = {
        type: event.type,
        actor: event.actor,
        state: event.state,
        data: baseDataBuilder(),
        timestamp: event.timestamp,
      };

      if (!currentPort) {
        // Debug: log when port is missing for terminal events
        if (isTerminal) {
          console.log('[subscribeToExecutorEvents] No port for terminal event:', {
            state: event.state,
            taskId: event.data?.taskId,
            hasBuffer: !!bufferOptions,
          });
        }
        if (bufferOptions && bufferOptions.eventBuffer.length < bufferOptions.maxSize) {
          bufferOptions.eventBuffer.push(outEvent);
        }
      }

      if (currentPort) {
        // Debug: log when sending terminal events
        if (isTerminal) {
          console.log('[subscribeToExecutorEvents] Sending terminal event:', {
            state: event.state,
            taskId: event.data?.taskId,
          });
          try {
            const taskId: string | undefined = (event as any)?.data?.taskId;
            if (taskId) {
              // Collect all usages for this task across rounds, ordered chronologically
              const usages = ((globalTokenTracker as any)?.getTokensForTask?.(taskId) || []).sort(
                (a: any, b: any) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0),
              );
              if (Array.isArray(usages) && usages.length > 0) {
                // Append to combined archive so future rounds can download combined logs
                try {
                  sessionLogArchive.append(String(taskId), usages);
                } catch {}
                const totalInputTokens = usages.reduce((sum: number, u: any) => sum + (u.inputTokens || 0), 0);
                const totalOutputTokens = usages.reduce((sum: number, u: any) => sum + (u.outputTokens || 0), 0);
                // Sum only valid costs (>= 0); if none found, total is -1 (unavailable)
                let hasAnyCost = false;
                const totalCost =
                  usages.reduce((sum: number, u: any) => {
                    const c = Number(u.cost);
                    if (isFinite(c) && c >= 0) {
                      hasAnyCost = true;
                      return sum + c;
                    }
                    return sum;
                  }, 0) || (hasAnyCost ? 0 : -1);
                const apiCallCount = usages.length;
                const last = usages[usages.length - 1] || {};
                const provider = last.provider || 'Unknown';
                const modelName = last.modelName || 'unknown';

                let totalLatencyMs = 0;
                try {
                  // Get completion timestamps
                  const completionTimes = usages
                    .map((u: any) => Number(u?.timestamp || 0))
                    .filter((n: number) => Number.isFinite(n) && n > 0);
                  // Get request start times (fallback to completion time if not set)
                  const startTimes = usages
                    .map((u: any) => Number(u?.requestStartTime || u?.timestamp || 0))
                    .filter((n: number) => Number.isFinite(n) && n > 0);

                  if (startTimes.length > 0 && completionTimes.length > 0) {
                    // Latency = latest completion - earliest start
                    totalLatencyMs = Math.max(0, Math.max(...completionTimes) - Math.min(...startTimes));
                  } else if (completionTimes.length >= 2) {
                    // Fallback for backwards compatibility
                    completionTimes.sort((a, b) => a - b);
                    totalLatencyMs = completionTimes[completionTimes.length - 1] - completionTimes[0];
                  }
                } catch {}

                const dataSummary = {
                  totalInputTokens,
                  totalOutputTokens,
                  totalLatencyMs,
                  totalLatencySeconds: (totalLatencyMs / 1000).toFixed(2),
                  totalCost,
                  apiCallCount,
                  provider,
                  modelName,
                } as const;

                // Attach structured summary and legacy JSON for backward compatibility
                outEvent.data.summary = dataSummary;
                outEvent.data.message = JSON.stringify({ type: 'job_summary', data: dataSummary });

                // Freeze mirrors for this session so previews remain but updates stop
                try {
                  await (taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(taskId));
                } catch {}
              }
            }
          } catch (err) {
            logger.debug('Failed to build summary for terminal event:', err);
          }
        }

        try {
          currentPort.postMessage(outEvent);
          // Debug: confirm terminal event was posted
          if (isTerminal) {
            console.log('[subscribeToExecutorEvents] Terminal event posted successfully');
          }
        } catch (postErr) {
          console.error('[subscribeToExecutorEvents] Failed to post message:', postErr);
          throw postErr;
        }
      }
    } catch (error) {
      console.error('[subscribeToExecutorEvents] Error in event handler:', error);
      logger.debug('Failed to send message to side panel:', error);
    }

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      // Freeze mirrors to retain last preview without further updates
      try {
        const taskId: string | undefined = (event as any)?.data?.taskId;
        if (taskId) {
          (taskManager as any)?.tabMirrorService?.freezeMirrorsForSession?.(String(taskId));
        }
      } catch {}
      await (executor as any)?.cleanup?.();
      try {
        onTaskFinished?.(executor);
      } catch {}
    }
  });
}
