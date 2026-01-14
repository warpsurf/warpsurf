// Copied from ../workflow/types
export type SubtaskId = number;

export interface Subtask {
  id: SubtaskId;
  title: string;
  prompt: string;
  startCriteria: SubtaskId[];
  isFinal?: boolean;
  noBrowse?: boolean;
  suggestedUrls?: string[];
  suggestedSearchQueries?: string[];
}

export interface TaskPlan {
  task: string;
  subtasks: Subtask[];
  dependencies: Record<SubtaskId, SubtaskId[]>;
  durations?: Record<SubtaskId, number>;
}

export type WorkerSchedule = Record<number, number[]>;
export type WorkerQueues = Record<number, number[]>;

export type WorkflowNodeStatus = 'not_started' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface GraphNode {
  id: SubtaskId;
  label: string;
  status?: WorkflowNodeStatus;
}

export interface GraphEdge {
  from: SubtaskId;
  to: SubtaskId;
}

export interface GraphPositions {
  [id: number]: { x: number; y: number; width?: number };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  durations?: Record<SubtaskId, number>;
  positions?: GraphPositions;
}

export interface PriorOutput {
  title: string;
  output: string;
  tabIds: number[];
  rawJson?: any;
}

export interface SubtaskOutputRecord {
  result: string;
  raw?: any;
  tabIds: number[];
}

export type SubtaskOutputs = Record<SubtaskId, SubtaskOutputRecord>;

export interface WorkflowConfig {
  maxWorkers: number;
}

export interface WorkflowEventsPort {
  postMessage: (message: any) => void;
}

/** Getter function for dynamic port resolution (handles panel reconnection) */
export type PortGetter = () => WorkflowEventsPort | null;

export interface StartWorkflowPayload {
  sessionId: string;
  query: string;
  maxWorkers?: number;
}
