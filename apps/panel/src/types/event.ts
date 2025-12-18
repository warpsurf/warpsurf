import type { Actors } from '@extension/storage';
import { EventType, ExecutionState } from '@extension/shared/lib/utils';
export { EventType, ExecutionState };

// EventType is imported from shared

// Background → side-panel messages for workflow v2 graph and final output
export interface WorkflowGraphUpdateMessage {
  type: 'workflow_graph_update';
  data: {
    sessionId: string;
    graph: any;
  };
}

export interface WorkflowFinalAnswerMessage {
  type: 'final_answer';
  data: {
    sessionId: string;
    text: string;
  };
}

// ExecutionState is imported from shared (includes tab states)

// Add tab-level states for side panel handling
// Remove TabExecutionState in favor of ExecutionState.TAB_*

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
