/** Search Event Handler - Handles LLM with web search, includes search metadata (queries, sources) */

import { Actors } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import type { EventHandlerCreator } from './create-task-event-handler';

/** Creates the Search event handler */
export const createSearchHandler: EventHandlerCreator = (deps) => {
  const { logger, persistAgentMessage, setMessages, setMessageMetadata, lastAgentMessageRef } = deps;

  return (event) => {
    const actor = event.actor || Actors.SEARCH;
    const state = event.state;
    const timestamp = event.timestamp || Date.now();
    const data = (event as any)?.data || {};
    const content = data?.details ?? (event as any)?.content ?? '';

    switch (state) {
      case ExecutionState.STEP_START:
        setMessages((prev: any[]) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.content === 'Showing progress...') {
            const updated = [...prev];
            updated[prev.length - 1] = { ...lastMsg, actor: Actors.SEARCH };
            return updated;
          }
          return [...prev, { actor: Actors.SEARCH, content: 'Showing progress...', timestamp }];
        });
        lastAgentMessageRef.current = { timestamp, actor };
        break;

      case ExecutionState.STEP_OK:
        setMessages((prev: any[]) => {
          const lastIndex = prev.findIndex((msg: any, idx: number) =>
            idx === prev.length - 1 && msg.actor === Actors.SEARCH && msg.content === 'Showing progress...');
          if (lastIndex !== -1) {
            const updated = [...prev];
            updated[lastIndex] = { ...updated[lastIndex], content: content || '', timestamp };
            return updated;
          }
          return [...prev, { actor, content: content || '', timestamp }];
        });
        persistAgentMessage(actor, content || '', timestamp);
        lastAgentMessageRef.current = { timestamp, actor };
        logger.log('[Panel] Tracked SEARCH message for job summary:', { timestamp, actor });
        
        // Process search metadata
        if (data?.message) {
          try {
            const payload = JSON.parse(data.message);
            if (payload?.type === 'search_metadata') {
              const messageId = `${timestamp}-${actor}`;
              setMessageMetadata((prev: any) => ({
                ...prev,
                [messageId]: {
                  searchQueries: payload.searchQueries || [],
                  sourceUrls: payload.sourceUrls || [],
                  sourceItems: payload.sourceItems || [],
                },
              }));
            }
          } catch {}
        }
        break;

      case ExecutionState.STEP_FAIL:
      case ExecutionState.STEP_CANCEL:
        break;

      default:
        logger.error('Invalid LLM with search state', state);
        return;
    }
  };
};
