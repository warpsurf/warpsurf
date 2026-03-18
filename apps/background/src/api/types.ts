// API type definitions for programmatic access to WarpSurf

/** Provider configuration for API requests */
export interface APIConfig {
  provider: string;
  modelName: string;
  apiKey: string;
  baseUrl?: string;
  parameters?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  thinkingLevel?: 'high' | 'medium' | 'low' | 'off' | 'default';
}

/** Task execution options */
export interface APIRunOptions {
  task: string;
  taskId?: string;
  workflow?: 'auto' | 'chat' | 'search' | 'agent' | 'multiagent';
  timeoutMs?: number;
  timeout?: number;
  config: APIConfig;
}

/** Usage statistics from task execution */
export interface APIUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatencyMs: number;
  totalCost: number;
  apiCallCount: number;
  provider: string;
  modelName: string;
}

/** Action trace entry for agent workflows */
export interface APITraceEntry {
  action: string;
  status: 'start' | 'ok' | 'fail';
  details?: string;
  timestamp: number;
}

/** Task result */
export interface APIResult {
  taskId: string;
  status: 'running' | 'completed' | 'error' | 'cancelled' | 'pending' | 'timeout';
  result?: string;
  error?: string;
  usage?: APIUsage;
  trace?: APITraceEntry[];
}

/** Optional setting overrides - only applied if provided */
export interface APISettingsOverrides {
  general?: Partial<{
    maxSteps: number;
    maxActionsPerStep: number;
    maxFailures: number;
    maxValidatorFailures: number;
    retryDelay: number;
    maxInputTokens: number;
    useVision: boolean;
    planningInterval: number;
    minWaitPageLoad: number;
    maxWorkerAgents: number;
    enablePlanner: boolean;
    enableValidator: boolean;
    enableWorkflowEstimation: boolean;
    showTabPreviews: boolean;
    responseTimeoutSeconds: number;
  }>;
  firewall?: Partial<{
    enabled: boolean;
    allowList: string[];
    denyList: string[];
  }>;
}
