/** Main Task Event Handler Router - Routes events to actor-specific handlers */

import { Actors } from '@extension/storage';
import type { Message } from '@extension/storage';
import { ExecutionState, type AgentEvent } from '../../types/event';
import { createSystemHandler } from './system-event-handler';
import { createNavigatorHandler } from './navigator-event-handler';
import { createPlannerHandler } from './planner-event-handler';
import { createValidatorHandler } from './validator-event-handler';
import { createChatHandler } from './chat-event-handler';
import { createSearchHandler } from './search-event-handler';
import { createAutoHandler } from './auto-event-handler';
import { createEstimatorHandler } from './estimator-event-handler';
import { createToolHandler } from './tool-event-handler';
import { normalizeEvent, shouldSkipJobSummary } from './utils';

/** Dependencies injected into event handlers */
export interface TaskEventHandlerDeps {
  logger: { log: (...args: any[]) => void; error: (...args: any[]) => void };
  appendMessage: (m: Message, sessionId?: string | null) => void;
  persistAgentMessage: (actor: any, content: string, timestamp: number, eventId?: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsJobActive: (v: boolean) => void;
  setShowStopButton: (v: boolean) => void;
  setIsHistoricalSession: (v: boolean) => void;
  setHasFirstPreview: (v: boolean) => void;
  setMirrorPreview: (updater: any) => void;
  setMirrorPreviewBatch: (updater: any) => void;
  setWorkerTabGroups: (updater: any) => void;
  setShowCloseTabs: (v: boolean) => void;
  setIsFollowUpMode: (v: boolean) => void;
  setInputEnabled: (v: boolean) => void;
  setIsReplaying: (v: boolean) => void;
  setIsAgentModeActive: (v: boolean) => void;
  setActiveAggregateMessageId: (v: string | null) => void;
  setIsPaused: (v: boolean) => void;
  agentTraceRootIdRef: React.MutableRefObject<string | null>;
  setAgentTraceRootId: (v: string | null) => void;
  agentTraceActiveRef: React.MutableRefObject<boolean>;
  lastAgentMessageRef: React.MutableRefObject<{ timestamp: number; actor: string } | null>;
  jobActiveRef: React.MutableRefObject<boolean>;
  laneColorByLaneRef: React.MutableRefObject<Map<number, string>>;
  processedJobSummariesRef: React.MutableRefObject<Set<string>>;
  sessionIdRef: React.MutableRefObject<string | null>;
  taskIdToRootIdRef: React.MutableRefObject<Map<string, string>>;
  lastAgentMessageByTaskRef: React.MutableRefObject<Map<string, { timestamp: number; actor: string }>>;
  closableTaskIdsRef: React.MutableRefObject<Set<string>>;
  workflowEndedRef: React.MutableRefObject<boolean>;
  cancelSummaryTargetsRef: React.MutableRefObject<Map<string, string>>;
  runStartedAtRef: React.MutableRefObject<number | null>;
  setMessageMetadata: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setRequestSummaries: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  updateSessionStats: (data: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalLatencyMs: number;
    totalCost: number;
  }) => void;
  getCurrentTaskAgentType: () => string | null;
  getWorkerTabGroups: () => Array<any>;
  getChatSessions: () => Array<{ id: string; title: string; createdAt: number; updatedAt: number }>;
  getMessages: () => Message[];
  getMirrorPreviewBatch: () => Array<any>;
  lastUserPromptRef: React.MutableRefObject<string | null>;
  ensureAgentOrdinal: (taskId: string, hint?: number) => number;
  portRef: React.MutableRefObject<chrome.runtime.Port | null>;
  setPendingEstimation: (estimation: any | null) => void;
  getRecalculatedEstimation: () => any | null;
  setContextTabIdsRef?: React.MutableRefObject<((tabIds: number[]) => void) | null>;
}

export type EventHandler = (event: AgentEvent) => void;
export type EventHandlerCreator = (deps: TaskEventHandlerDeps) => EventHandler;

export interface NormalizedEvent {
  actor: any;
  state: ExecutionState;
  timestamp: number;
  data: any;
  content?: string;
}

export interface JobSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatencyMs: number;
  totalLatencySeconds: number;
  totalCost: number;
  apiCallCount: number;
  modelName?: string;
  provider?: string;
}

export interface WorkerProgressItem {
  workerId: string;
  text: string;
  agentName?: string;
  color?: string;
  timestamp: number;
}

export interface WorkerTabGroup {
  taskId: string;
  name: string;
  color: string;
  groupId?: number;
}

/** Creates unified event handler that routes to actor-specific handlers */
export function createTaskEventHandler(deps: TaskEventHandlerDeps) {
  const { logger, appendMessage, setMirrorPreview } = deps;
  const handlers: Record<string, (event: AgentEvent) => void> = {
    [Actors.SYSTEM]: createSystemHandler(deps),
    [Actors.AGENT_NAVIGATOR]: createNavigatorHandler(deps),
    [Actors.AGENT_PLANNER]: createPlannerHandler(deps),
    [Actors.AGENT_VALIDATOR]: createValidatorHandler(deps),
    [Actors.CHAT]: createChatHandler(deps),
    [Actors.SEARCH]: createSearchHandler(deps),
    [Actors.AUTO]: createAutoHandler(deps),
    [Actors.ESTIMATOR]: createEstimatorHandler(deps),
    [Actors.TOOL]: createToolHandler(deps),
    [Actors.USER]: () => {},
  };

  return function handleTaskEvent(event: AgentEvent): void {
    const { actor, content, data } = normalizeEvent(event);
    const state = event.state;
    if (state === ExecutionState.TASK_START || state === ExecutionState.TASK_OK || state === ExecutionState.TASK_FAIL) {
      logger.log('[Panel] Received event:', { actor, state, content: content?.substring?.(0, 100) });
    }
    const handler = handlers[actor as string];
    if (!handler) {
      logger.error('Unknown actor', actor);
      return;
    }
    let shouldSkipDefaultRendering = false;
    try {
      handler(event);
      shouldSkipDefaultRendering = true;
    } catch (error) {
      logger.error('Handler error', { actor, error });
      shouldSkipDefaultRendering = false;
    }
    // Global post-processing
    if (!shouldSkipDefaultRendering && shouldSkipJobSummary(content)) shouldSkipDefaultRendering = true;
    if (!shouldSkipDefaultRendering && (content ?? '') !== '') {
      try {
        appendMessage({
          actor,
          content: content || '',
          timestamp: event.timestamp || Date.now(),
          eventId: (event as any)?.eventId || (event as any)?.data?.eventId,
        } as any);
      } catch {}
    }
    try {
      if ((data as any)?.agentColor || (data as any)?.agentName) {
        setMirrorPreview((prev: any) => ({
          url: prev?.url,
          title: prev?.title,
          screenshot: prev?.screenshot,
          tabId: prev?.tabId,
          color: (data as any)?.agentColor || prev?.color,
        }));
      }
    } catch {}
  };
}
