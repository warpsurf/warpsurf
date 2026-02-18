export type AgentStatus = 'running' | 'paused' | 'needs_input' | 'completed' | 'failed' | 'cancelled';

export interface PreviewData {
  tabId?: number;
  url?: string;
  title?: string;
  screenshot?: string;
  lastUpdated?: number;
}

export interface WorkerPreview extends PreviewData {
  workerId: string;
  workerIndex: number;
  color: string;
}

export interface AgentData {
  sessionId: string;
  sessionTitle: string;
  taskDescription: string;
  startTime: number;
  endTime?: number;
  agentType: 'chat' | 'search' | 'agent' | 'multiagent';
  status: AgentStatus;
  preview?: PreviewData;
  workers?: WorkerPreview[];
  metrics?: {
    totalCost?: number;
    totalLatencyMs?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
  };
  lastMessage?: string;
  titleAnimating?: boolean;
}
