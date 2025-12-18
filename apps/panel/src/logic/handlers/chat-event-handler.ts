/** Chat Event Handler - Handles chat workflow events with progress indicator pattern */

import { Actors } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import type { EventHandlerCreator } from './create-task-event-handler';

/** Creates the Chat event handler */
export const createChatHandler: EventHandlerCreator = (deps) => {
  const { logger, persistAgentMessage, setMessages, lastAgentMessageRef } = deps;

  return (event) => {
    const actor = event.actor || Actors.CHAT;
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
            updated[prev.length - 1] = { ...lastMsg, actor: Actors.CHAT };
            return updated;
          }
          return [...prev, { actor: Actors.CHAT, content: 'Showing progress...', timestamp }];
        });
        lastAgentMessageRef.current = { timestamp, actor };
        break;

      case ExecutionState.STEP_OK:
        setMessages((prev: any[]) => {
          const lastIndex = prev.findIndex((msg: any, idx: number) =>
            idx === prev.length - 1 && msg.actor === Actors.CHAT && msg.content === 'Showing progress...');
          if (lastIndex !== -1) {
            const updated = [...prev];
            updated[lastIndex] = { ...updated[lastIndex], content: content || '', timestamp };
            return updated;
          }
          return [...prev, { actor, content: content || '', timestamp }];
        });
        persistAgentMessage(actor, content || '', timestamp);
        lastAgentMessageRef.current = { timestamp, actor };
        logger.log('[Panel] Tracked CHAT message for job summary:', { timestamp, actor });
        break;

      case ExecutionState.STEP_FAIL:
      case ExecutionState.STEP_CANCEL:
        break;

      default:
        logger.error('Invalid chat state', state);
        return;
    }
  };
};

