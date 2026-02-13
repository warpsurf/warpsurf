/** Search Event Handler - Handles LLM with web search, with streaming support */

import { Actors } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import type { EventHandlerCreator } from './create-task-event-handler';

// Track active streams: streamId -> { index, content, originalTimestamp }
const activeStreams = new Map<string, { index: number; content: string; originalTimestamp: number }>();

/** Creates the Search event handler */
export const createSearchHandler: EventHandlerCreator = deps => {
  const { persistAgentMessage, setMessages, lastAgentMessageRef } = deps;

  return event => {
    const actor = event.actor || Actors.SEARCH;
    const state = event.state;
    const timestamp = event.timestamp || Date.now();
    const data = (event as any)?.data || {};
    const content = data?.details ?? (event as any)?.content ?? '';
    const streamId = data?.streamId;
    const isFinal = data?.isFinal;

    switch (state) {
      case ExecutionState.STEP_START:
        setMessages((prev: any[]) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.content === 'Showing progress...') {
            const updated = [...prev];
            updated[prev.length - 1] = { ...lastMsg, actor: Actors.SEARCH, statusHint: 'searching' };
            return updated;
          }
          return [
            ...prev,
            { actor: Actors.SEARCH, content: 'Showing progress...', timestamp, statusHint: 'searching' },
          ];
        });
        lastAgentMessageRef.current = { timestamp, actor };
        break;

      case ExecutionState.STEP_STREAMING:
        if (!streamId) break;

        if (isFinal) {
          // Stream complete - persist and cleanup
          const stream = activeStreams.get(streamId);
          if (stream) {
            persistAgentMessage(actor, stream.content, stream.originalTimestamp, `stream:${streamId}`);
            // CRITICAL: Use the ORIGINAL timestamp for message ID matching
            lastAgentMessageRef.current = { timestamp: stream.originalTimestamp, actor };
            activeStreams.delete(streamId);
          }
          break;
        }

        // Streaming chunk
        const existing = activeStreams.get(streamId);
        if (existing) {
          existing.content += content;
          setMessages((prev: any[]) => {
            const updated = [...prev];
            if (updated[existing.index]) {
              updated[existing.index] = { ...updated[existing.index], content: existing.content };
            }
            return updated;
          });
        } else {
          // First chunk - replace progress indicator or add new message
          setMessages((prev: any[]) => {
            const progressIdx = prev.findIndex((m, i) => i === prev.length - 1 && m.content === 'Showing progress...');
            if (progressIdx !== -1) {
              activeStreams.set(streamId, { index: progressIdx, content, originalTimestamp: timestamp });
              const updated = [...prev];
              updated[progressIdx] = { actor: Actors.SEARCH, content, timestamp };
              // Set lastAgentMessageRef on first chunk so it has the correct timestamp
              lastAgentMessageRef.current = { timestamp, actor };
              return updated;
            }
            activeStreams.set(streamId, { index: prev.length, content, originalTimestamp: timestamp });
            lastAgentMessageRef.current = { timestamp, actor };
            return [...prev, { actor: Actors.SEARCH, content, timestamp }];
          });
        }
        break;

      case ExecutionState.STEP_OK:
      case ExecutionState.STEP_CANCEL:
        break;

      case ExecutionState.STEP_FAIL: {
        const fallback = 'Request failed';
        const errorMessage = data?.error?.userMessage || content || fallback;
        setMessages((prev: any[]) => {
          const progressIdx = prev.findIndex((m, i) => i === prev.length - 1 && m.content === 'Showing progress...');
          if (progressIdx !== -1) {
            const updated = [...prev];
            updated[progressIdx] = { actor: Actors.SEARCH, content: errorMessage, timestamp };
            return updated;
          }
          return [...prev, { actor: Actors.SEARCH, content: errorMessage, timestamp }];
        });
        persistAgentMessage(actor, errorMessage, timestamp, (event as any)?.eventId || data?.eventId);
        lastAgentMessageRef.current = { timestamp, actor };
        break;
      }
    }
  };
};
