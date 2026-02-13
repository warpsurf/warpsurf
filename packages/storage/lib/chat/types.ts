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
  TOOL = 'tool',
}

/** Workflow status hints for progress messages (transient, not persisted) */
export type WorkflowStatusHint = 'routing' | 'configuring' | 'thinking' | 'searching' | 'navigating';

export interface Message {
  actor: Actors;
  content: string;
  timestamp: number; // Unix timestamp in milliseconds
  /**
   * Optional stable identifier for cross-system deduplication.
   * (Used to prevent duplicate persistence when the same event is saved via multiple paths.)
   */
  eventId?: string;
  /**
   * Transient UI hint for workflow-specific status messages during progress.
   * Not persisted to storage - only used for live display in the side panel.
   */
  statusHint?: WorkflowStatusHint;
}

export interface ChatMessage extends Message {
  id: string; // Unique ID for each message
}

export interface ChatSessionMetadata {
  id: string;
  title: string;
  createdAt: number; // Unix timestamp in milliseconds
  updatedAt: number; // Unix timestamp in milliseconds
  messageCount: number;
}

// ChatSession is the full conversation history displayed in the Sidepanel
export interface ChatSession extends ChatSessionMetadata {
  messages: ChatMessage[];
}

// ChatAgentStepHistory is the history of the every step of the agent
export interface ChatAgentStepHistory {
  task: string;
  history: string;
  timestamp: number; // Unix timestamp in milliseconds
}

// Per-message request summary used by UI tooltips
export interface RequestSummary {
  inputTokens: number;
  outputTokens: number;
  latency: string;
  cost: number;
  apiCalls: number;
  modelName?: string;
  provider?: string;
}

// Tab context info for messages that used context tabs
export interface ContextTabInfo {
  id: number;
  title: string;
  favIconUrl?: string;
  url?: string;
}

// Per-message metadata used by UI (trace items, search queries, etc.)
export interface MessageMetadataValue {
  searchQueries?: string[];
  sourceUrls?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceItems?: Array<{ url: string; title?: string; author?: string }> | any[];
  traceItems?: Array<{ actor: string; content: string; timestamp: number }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workerItems?:
    | Array<{ workerId: string; text?: string; agentName?: string; color?: string; timestamp: number }>
    | any[];
  agentColor?: string;
  // Context tabs that were provided with the request
  contextTabs?: ContextTabInfo[];
}

// Aggregated per-session statistics surface in the UI footer
export interface SessionStats {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatency: number;
  totalCost: number;
  avgLatencyPerRequest: number;
}

export interface ChatHistoryStorage {
  // Get all chat sessions (with empty message arrays for listing)
  getAllSessions: () => Promise<ChatSession[]>;

  // Clear all chat sessions and messages
  clearAllSessions: () => Promise<void>;

  // Clear messages and related data for a specific session (keep session metadata)
  clearSession: (sessionId: string) => Promise<void>;

  // Get only session metadata (for efficient listing)
  getSessionsMetadata: () => Promise<ChatSessionMetadata[]>;

  // Get a specific chat session with its messages
  getSession: (sessionId: string) => Promise<ChatSession | null>;

  // Create a new chat session
  createSession: (title: string) => Promise<ChatSession>;

  // Create a new chat session with a specific ID (for synchronous ID generation)
  createSessionWithId: (sessionId: string, title: string) => Promise<ChatSession>;

  // Update an existing chat session
  updateTitle: (sessionId: string, title: string) => Promise<ChatSessionMetadata>;

  // Delete a chat session
  deleteSession: (sessionId: string) => Promise<void>;

  // Add a message to a chat session
  addMessage: (sessionId: string, message: Message) => Promise<ChatMessage>;

  // Delete a message from a chat session
  deleteMessage: (sessionId: string, messageId: string) => Promise<void>;

  // Store the history of the agent's state
  storeAgentStepHistory: (sessionId: string, task: string, history: string) => Promise<void>;

  // Load the history of the agent's state
  loadAgentStepHistory: (sessionId: string) => Promise<ChatAgentStepHistory | null>;

  // Persist and load per-message request summaries for a session (tooltips)
  storeRequestSummaries: (sessionId: string, summaries: Record<string, RequestSummary>) => Promise<void>;
  loadRequestSummaries: (sessionId: string) => Promise<Record<string, RequestSummary>>;

  // Persist and load per-message metadata for a session (trace items, etc.)
  storeMessageMetadata: (sessionId: string, metadata: Record<string, MessageMetadataValue>) => Promise<void>;
  loadMessageMetadata: (sessionId: string) => Promise<Record<string, MessageMetadataValue>>;

  // Persist and load aggregated per-session statistics
  storeSessionStats: (sessionId: string, stats: SessionStats) => Promise<void>;
  loadSessionStats: (sessionId: string) => Promise<SessionStats | null>;
}
