/** Validator Event Handler - Manages validation phase for browser automation workflows */

import { Actors } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import type { EventHandlerCreator } from './create-task-event-handler';
import { createAggregateRoot, addTraceItem, updateAggregateRootContent } from './utils';

/** Creates the Validator event handler */
export const createValidatorHandler: EventHandlerCreator = (deps) => {
  const { logger } = deps;

  return (event) => {
    const state = event.state;
    const timestamp = event.timestamp || Date.now();
    const data = (event as any)?.data || {};
    const content = data?.details ?? (event as any)?.content ?? '';

    switch (state) {
      case ExecutionState.STEP_START:
        if (!deps.agentTraceRootIdRef.current && content) {
          createAggregateRoot(Actors.AGENT_NAVIGATOR, content, timestamp, deps);
        }
        if (deps.agentTraceRootIdRef.current) {
          addTraceItem(Actors.AGENT_VALIDATOR, content || 'Validating output...', timestamp, deps);
          if (content) updateAggregateRootContent(content, deps);
        }
        break;

      case ExecutionState.STEP_OK:
        if (deps.agentTraceRootIdRef.current && content) {
          addTraceItem(Actors.AGENT_VALIDATOR, `✓ ${content}`, timestamp, deps);
          updateAggregateRootContent(content, deps);
        }
        break;

      case ExecutionState.STEP_FAIL:
        if (deps.agentTraceRootIdRef.current) {
          const failText = `Validation failed: ${content || ''}`;
          addTraceItem(Actors.AGENT_VALIDATOR, failText, timestamp, deps);
          updateAggregateRootContent(failText, deps);
        }
        break;

      case ExecutionState.STEP_CANCEL:
        break;

      default:
        logger.error('Invalid validator state', state);
        return;
    }
  };
};

