/** Tool Event Handler - Handles tool workflow events (settings changes + streaming responses) */

import { Actors } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import type { EventHandlerCreator } from './create-task-event-handler';

const activeStreams = new Map<string, { index: number; content: string; originalTimestamp: number }>();

/** Creates the Tool event handler */
export const createToolHandler: EventHandlerCreator = deps => {
  const { persistAgentMessage, setMessages, lastAgentMessageRef, setContextTabIdsRef, setMessageMetadata } = deps;

  return event => {
    const actor = event.actor || Actors.TOOL;
    const state = event.state;
    const timestamp = event.timestamp || Date.now();
    const data = (event as any)?.data || {};
    const eventId = (event as any)?.eventId || data?.eventId;
    const content = data?.details ?? (event as any)?.content ?? '';
    const streamId = data?.streamId;
    const isFinal = data?.isFinal;

    // Update UI context tab indicators when tool changes tabs
    if (data?.contextTabIds && Array.isArray(data.contextTabIds)) {
      if (setContextTabIdsRef?.current) setContextTabIdsRef.current(data.contextTabIds);
    }

    // Store tab metadata on this tool message for the context tab chip/tooltip
    if (data?.contextTabsMeta && Array.isArray(data.contextTabsMeta)) {
      const messageId = `${timestamp}-${actor}`;
      setMessageMetadata((prev: any) => ({
        ...prev,
        [messageId]: { ...(prev[messageId] || {}), contextTabs: data.contextTabsMeta },
      }));
    }

    switch (state) {
      case ExecutionState.STEP_START:
        setMessages((prev: any[]) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.content === 'Showing progress...') {
            const updated = [...prev];
            updated[prev.length - 1] = { ...lastMsg, actor: Actors.TOOL, statusHint: 'configuring' };
            return updated;
          }
          return [
            ...prev,
            { actor: Actors.TOOL, content: 'Showing progress...', timestamp, statusHint: 'configuring' },
          ];
        });
        lastAgentMessageRef.current = { timestamp, actor };
        break;

      case ExecutionState.STEP_STREAMING:
        if (!streamId) break;
        if (isFinal) {
          const stream = activeStreams.get(streamId);
          if (stream) {
            persistAgentMessage(actor, stream.content, stream.originalTimestamp, `stream:${streamId}`);
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
          setMessages((prev: any[]) => {
            const progressIdx = prev.findIndex((m, i) => i === prev.length - 1 && m.content === 'Showing progress...');
            if (progressIdx !== -1) {
              activeStreams.set(streamId, { index: progressIdx, content, originalTimestamp: timestamp });
              const updated = [...prev];
              updated[progressIdx] = { actor: Actors.TOOL, content, timestamp };
              lastAgentMessageRef.current = { timestamp, actor };
              return updated;
            }
            activeStreams.set(streamId, { index: prev.length, content, originalTimestamp: timestamp });
            lastAgentMessageRef.current = { timestamp, actor };
            return [...prev, { actor: Actors.TOOL, content, timestamp }];
          });
        }
        break;

      case ExecutionState.STEP_OK:
      case ExecutionState.STEP_FAIL:
        // Tool call results (e.g., "✓ useVision set to true") - show as messages
        if (content) {
          setMessages((prev: any[]) => {
            // Replace "Showing progress..." if it's the last message
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.content === 'Showing progress...' && lastMsg?.actor === Actors.TOOL) {
              const updated = [...prev];
              updated[prev.length - 1] = { actor: Actors.TOOL, content, timestamp };
              return updated;
            }
            return [...prev, { actor: Actors.TOOL, content, timestamp }];
          });
          persistAgentMessage(actor, content, timestamp, eventId);
          lastAgentMessageRef.current = { timestamp, actor };
        }
        break;
    }
  };
};
