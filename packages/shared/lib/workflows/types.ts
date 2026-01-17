/**
 * Canonical workflow type identifiers used throughout the extension.
 * These are the ONLY values that should be used for workflow types.
 */
export enum WorkflowType {
  /** Auto-select workflow based on task analysis */
  AUTO = 'auto',

  /** Simple LLM chat without browser interaction */
  CHAT = 'chat',

  /** LLM with web search capabilities */
  SEARCH = 'search',

  /** Single browser automation agent */
  AGENT = 'agent',

  /** Multiple coordinated browser agents */
  MULTIAGENT = 'multiagent',
}

/**
 * Display names for each workflow type (for UI)
 */
export const WORKFLOW_DISPLAY_NAMES: Record<WorkflowType, string> = {
  [WorkflowType.AUTO]: 'Auto',
  [WorkflowType.CHAT]: 'Chat',
  [WorkflowType.SEARCH]: 'Search',
  [WorkflowType.AGENT]: 'Agent',
  [WorkflowType.MULTIAGENT]: 'Multi-Agent',
};

/**
 * Descriptions for each workflow type
 */
export const WORKFLOW_DESCRIPTIONS: Record<WorkflowType, string> = {
  [WorkflowType.AUTO]: 'Automatically select the best workflow',
  [WorkflowType.CHAT]: 'Simple chat without web access',
  [WorkflowType.SEARCH]: 'Chat with web search capabilities',
  [WorkflowType.AGENT]: 'Single browser automation agent',
  [WorkflowType.MULTIAGENT]: 'Multiple coordinated agents',
};

/**
 * Context format for tab content extraction
 */
export type ContextFormat = 'markdown' | 'dom';

/**
 * Configuration for context tab handling per workflow
 */
export interface ContextTabConfig {
  format: ContextFormat;
  maxCharsPerTab: number;
  maxTotalChars: number;
  maxTabs: number;
}

/**
 * Context tab configuration per workflow type.
 * Note: maxTabs is now a fallback limit. When model context is known,
 * dynamic budgeting in context-budget.ts determines actual limits.
 */
export const WORKFLOW_CONTEXT_CONFIG: Record<WorkflowType, ContextTabConfig> = {
  [WorkflowType.CHAT]: { format: 'markdown', maxCharsPerTab: 100000, maxTotalChars: 500000, maxTabs: 50 },
  [WorkflowType.SEARCH]: { format: 'markdown', maxCharsPerTab: 100000, maxTotalChars: 500000, maxTabs: 50 },
  [WorkflowType.AUTO]: { format: 'markdown', maxCharsPerTab: 100000, maxTotalChars: 500000, maxTabs: 50 },
  [WorkflowType.AGENT]: { format: 'dom', maxCharsPerTab: 100000, maxTotalChars: 500000, maxTabs: 50 },
  [WorkflowType.MULTIAGENT]: { format: 'markdown', maxCharsPerTab: 100000, maxTotalChars: 500000, maxTabs: 50 },
};
