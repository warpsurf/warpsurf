/** Auto Event Handler - Routes Auto workflow to appropriate agent based on content analysis */

import { Actors } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import type { EventHandlerCreator } from './create-task-event-handler';

/** Creates the Auto event handler */
export const createAutoHandler: EventHandlerCreator = (deps) => {
  const { logger, setMessages, lastAgentMessageRef } = deps;

  return (event) => {
    const actor = event.actor || Actors.AUTO;
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
            updated[prev.length - 1] = { ...lastMsg, actor: Actors.AUTO };
            return updated;
          }
          return [...prev, { actor: Actors.AUTO, content: 'Showing progress...', timestamp }];
        });
        lastAgentMessageRef.current = { timestamp, actor };
        break;

      case ExecutionState.STEP_OK: {
        // Infer chosen actor from auto result content
        let chosenActor: any = null;
        if (content) {
          const lowerContent = content.toLowerCase();
          if (lowerContent.includes('chat')) chosenActor = Actors.CHAT;
          else if (lowerContent.includes('search')) chosenActor = Actors.SEARCH;
          else if (lowerContent.includes('agent')) chosenActor = Actors.AGENT_NAVIGATOR;
        }
        if (chosenActor) {
          setMessages((prev: any[]) => {
            const lastIndex = prev.findIndex((msg: any, idx: number) =>
              idx === prev.length - 1 && msg.actor === Actors.AUTO && msg.content === 'Showing progress...');
            if (lastIndex !== -1) {
              const updated = [...prev];
              updated[lastIndex] = { ...updated[lastIndex], actor: chosenActor, content: 'Showing progress...' };
              return updated;
            }
            return prev;
          });
        }
        break;
      }

      case ExecutionState.STEP_FAIL:
      case ExecutionState.STEP_CANCEL:
        break;

      default:
        logger.error('Invalid auto state', state);
        return;
    }
  };
};

