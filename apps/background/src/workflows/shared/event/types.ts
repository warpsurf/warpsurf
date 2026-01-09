export enum Actors {
  SYSTEM = 'system',
  USER = 'user',
  // Single-agent workflow components
  AGENT_PLANNER = 'agent_planner',
  AGENT_NAVIGATOR = 'agent_navigator',
  AGENT_VALIDATOR = 'agent_validator',
  // Workflow-level actors
  CHAT = 'chat',
  SEARCH = 'search',
  AUTO = 'auto',
  MULTIAGENT = 'multiagent',
  // Utility actors
  ESTIMATOR = 'estimator',
}

import { EventType, ExecutionState } from '@extension/shared/lib/utils';
export { EventType, ExecutionState } from '@extension/shared/lib/utils';

export interface EventData {
  /** Data associated with an event */
  taskId: string;
  /** step is the step number of the task where the event occurred */
  step: number;
  /** max_steps is the maximum number of steps in the task */
  maxSteps: number;
  /** details is the content of the event */
  details: string;
  /** Optional tab ID for tab-related events */
  tabId?: number;
  /** Optional action for action-related events */
  action?: string;
  /** Optional message for events that need to display messages */
  message?: string;
  /** Streaming: unique ID for this stream session */
  streamId?: string;
  /** Streaming: true on final chunk */
  isFinal?: boolean;
  /** Current page URL when action was performed */
  pageUrl?: string;
  /** Current page title when action was performed */
  pageTitle?: string;
}

export class AgentEvent {
  /**
   * Represents a state change event in the task execution system.
   * Each event has a type, a specific state that changed,
   * the actor that triggered the change, and associated data.
   */
  constructor(
    public actor: Actors,
    public state: ExecutionState,
    public data: EventData,
    public timestamp: number = Date.now(),
    public type: EventType = EventType.EXECUTION,
  ) {}
}

// The type of callback for event subscribers
export type EventCallback = (event: AgentEvent) => Promise<void>;
