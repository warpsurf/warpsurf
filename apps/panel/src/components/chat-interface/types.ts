export interface JobSummary {
  inputTokens: number;
  outputTokens: number;
  latency: string;
  cost: number;
  apiCalls: number;
  modelName?: string;
  provider?: string;
}

export interface TraceItem {
  actor: string;
  content: string;
  timestamp: number;
  eventId?: string;
  controlRequest?: { type: string; tabId?: number; reason?: string };
  /** Current page URL when this trace was recorded */
  pageUrl?: string;
  /** Current page title when this trace was recorded */
  pageTitle?: string;
}

export interface WorkerItem {
  workerId: string;
  text?: string;
  agentName?: string;
  color?: string;
  timestamp: number;
}

export interface InlinePreview {
  url?: string;
  title?: string;
  screenshot?: string;
  tabId?: number;
  color?: string;
}

export type InlinePreviewBatch = Array<InlinePreview & { agentId?: string; agentOrdinal?: number; agentName?: string }>;

// Tab context info for messages that used context tabs
export interface ContextTabInfo {
  id: number;
  title: string;
  favIconUrl?: string;
  url?: string;
}

export interface MessageMetadata {
  searchQueries?: string[];
  sourceUrls?: string[];
  sourceItems?: Array<{ url: string; title?: string; author?: string }>;
  traceItems?: TraceItem[];
  workerItems?: WorkerItem[];
  agentColor?: string;
  estimation?: any;
  workflowStartTime?: number;
  workflowEndTime?: number;
  isCompleted?: boolean;
  totalWorkers?: number;
  controlRequest?: { type: string; tabId?: number; reason?: string };
  finalPreview?: InlinePreview;
  finalPreviewBatch?: InlinePreviewBatch;
  // Context tabs that were provided with the request
  contextTabs?: ContextTabInfo[];
}
