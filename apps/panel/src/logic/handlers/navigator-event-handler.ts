/** Navigator Event Handler - Handles browser automation (steps, actions, traces) with multiagent support */

import { Actors } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import type { EventHandlerCreator } from './create-task-event-handler';
import {
  createAggregateRoot,
  addTraceItem,
  updateAggregateRootContent,
  handleWorkerTabCreated,
  handleSingleAgentTabCreated,
} from './utils';

/** Creates the Navigator event handler */
export const createNavigatorHandler: EventHandlerCreator = deps => {
  const { logger, setIsAgentModeActive } = deps;

  return event => {
    const state = event.state;
    const timestamp = event.timestamp || Date.now();
    const data = (event as any)?.data || {};
    const content = data?.details ?? (event as any)?.content ?? '';
    const workerId = data?.workerId;
    const agentName = data?.agentName;
    const workerSuffix = workerId ? ` [${workerId}]` : '';
    const nameSuffix = agentName ? ` (${agentName})` : '';
    // Extract page URL/title from event data for trajectory tracking
    const pageUrl = typeof data?.pageUrl === 'string' ? data.pageUrl : undefined;
    const pageTitle = typeof data?.pageTitle === 'string' ? data.pageTitle : undefined;

    switch (state) {
      case ExecutionState.TAB_CREATED:
        setIsAgentModeActive(true);
        // Handle tab group tracking for both single-agent and multi-agent workflows
        try {
          if (data?.tabId) {
            if (data?.workerId) {
              handleWorkerTabCreated(event, deps);
            } else {
              handleSingleAgentTabCreated(event, deps);
            }
          }
        } catch {}
        // Add to trace for trajectory display
        if (deps.agentTraceRootIdRef.current) {
          const tabContent = pageUrl ? `Opened ${pageUrl}` : content || 'Opened new tab';
          addTraceItem(Actors.AGENT_NAVIGATOR, `${tabContent}${workerSuffix}${nameSuffix}`, timestamp, deps, {
            pageUrl,
            pageTitle,
          });
        }
        break;

      case ExecutionState.STEP_START:
        setIsAgentModeActive(true);
        if (!deps.agentTraceRootIdRef.current && content) {
          createAggregateRoot(Actors.AGENT_NAVIGATOR, content, timestamp, deps);
        }
        if (deps.agentTraceRootIdRef.current) {
          addTraceItem(
            Actors.AGENT_NAVIGATOR,
            `${content || 'Navigator started'}${workerSuffix}${nameSuffix}`,
            timestamp,
            deps,
            { pageUrl, pageTitle },
          );
          if (content) updateAggregateRootContent(content, deps);
        }
        break;

      case ExecutionState.STEP_OK:
        if (deps.agentTraceRootIdRef.current && content) {
          addTraceItem(Actors.AGENT_NAVIGATOR, `${content}${workerSuffix}${nameSuffix}`, timestamp, deps, {
            pageUrl,
            pageTitle,
          });
          updateAggregateRootContent(content, deps);
        }
        break;

      case ExecutionState.STEP_FAIL:
        setIsAgentModeActive(true);
        if (deps.agentTraceRootIdRef.current) {
          addTraceItem(
            Actors.AGENT_NAVIGATOR,
            `Navigator failed: ${content || ''}${workerSuffix}${nameSuffix}`,
            timestamp,
            deps,
            { pageUrl, pageTitle },
          );
        }
        break;

      case ExecutionState.STEP_CANCEL:
        setIsAgentModeActive(true);
        break;

      case ExecutionState.ACT_START:
        setIsAgentModeActive(true);
        if (deps.agentTraceRootIdRef.current) {
          addTraceItem(
            Actors.AGENT_NAVIGATOR,
            `${content || 'Action started'}${workerSuffix}${nameSuffix}`,
            timestamp,
            deps,
            { pageUrl, pageTitle },
          );
          if (content) updateAggregateRootContent(content, deps);
        }
        break;

      case ExecutionState.ACT_OK:
        setIsAgentModeActive(true);
        if (deps.agentTraceRootIdRef.current) {
          addTraceItem(
            Actors.AGENT_NAVIGATOR,
            `${content || 'Action completed'}${workerSuffix}${nameSuffix}`,
            timestamp,
            deps,
            { pageUrl, pageTitle },
          );
          if (content) updateAggregateRootContent(content, deps);
        }
        logger.log('[Panel] Navigator action added to aggregate trace');
        break;

      case ExecutionState.ACT_FAIL:
        setIsAgentModeActive(true);
        if (deps.agentTraceRootIdRef.current) {
          addTraceItem(
            Actors.AGENT_NAVIGATOR,
            `Action failed: ${content || ''}${workerSuffix}${nameSuffix}`,
            timestamp,
            deps,
            { pageUrl, pageTitle },
          );
        }
        break;

      default:
        logger.error('Invalid action', state);
        return;
    }
  };
};
