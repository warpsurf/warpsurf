/**
 * Agent Helpers
 * Shared utilities for agent settings components
 */
import { AgentNameEnum, ProviderTypeEnum, type ProviderConfig } from '@extension/storage';

// Models that have native web search capability per provider
export const ANTHROPIC_SEARCH_MODELS = new Set<string>([
  'claude-opus-4-1-20250805',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
]);

export const OPENAI_SEARCH_MODELS = new Set<string>([
  'gpt-4o-search-preview',
  'gpt-4o-mini-search-preview',
]);

// OpenAI models that use Responses API with web_search tool support
// Matches: o1, o3, o4-mini, gpt-5, gpt-5-mini, gpt-5.1, etc.
export const OPENAI_RESPONSES_API_PATTERN = /^o\d|^o-|^gpt-5/;

// Grok (xAI) models that support Live Search
// All Grok models support Live Search via search_parameters
export const GROK_SEARCH_MODELS = new Set<string>([
  'grok-4',
  'grok-4-fast',
  'grok-3',
  'grok-3-fast',
  'grok-3-mini',
  'grok-3-mini-fast',
  'grok-2',
  'grok-2-mini',
  'grok-beta',
]);

/**
 * Check if a model supports native web search for the given provider
 */
export function supportsNativeSearch(providerConfig: ProviderConfig | undefined, modelName: string): boolean {
  if (!providerConfig) return false;
  switch (providerConfig.type as ProviderTypeEnum) {
    case ProviderTypeEnum.Gemini:
      // All Gemini models support Google Search grounding
      return true;
    case ProviderTypeEnum.Anthropic:
      return ANTHROPIC_SEARCH_MODELS.has(modelName);
    case ProviderTypeEnum.OpenAI:
      // Search-preview models via Chat Completions, or o-series/gpt-5* via Responses API
      return OPENAI_SEARCH_MODELS.has(modelName) || OPENAI_RESPONSES_API_PATTERN.test(modelName);
    case ProviderTypeEnum.Grok:
      return GROK_SEARCH_MODELS.has(modelName);
    case ProviderTypeEnum.OpenRouter:
    case ProviderTypeEnum.CustomOpenAI:
      // Allow all models - search capability depends on underlying model/provider
      return true;
    default:
      return false;
  }
}

/**
 * Get human-readable display name for an agent
 */
export function getAgentDisplayName(agentName: AgentNameEnum): string {
  switch (agentName) {
    // Single-agent workflow components
    case AgentNameEnum.AgentNavigator:
      return 'Navigator';
    case AgentNameEnum.AgentPlanner:
      return 'Planner';
    case AgentNameEnum.AgentValidator:
      return 'Validator';
    // Multiagent workflow components
    case AgentNameEnum.MultiagentPlanner:
      return 'Planner (Multi-Agent)';
    case AgentNameEnum.MultiagentWorker:
      return 'Worker';
    case AgentNameEnum.MultiagentRefiner:
      return 'Refiner';
    // Workflow-level agents
    case AgentNameEnum.Auto:
      return 'Auto';
    case AgentNameEnum.Chat:
      return 'Chat';
    case AgentNameEnum.Search:
      return 'Search';
    // Utility agents
    case AgentNameEnum.HistorySummariser:
      return ''; // Name shown in section title instead
    case AgentNameEnum.Estimator:
      return 'Estimator';
    default:
      return agentName;
  }
}

/**
 * Get description for an agent
 */
export function getAgentDescription(agentName: AgentNameEnum): string {
  switch (agentName) {
    // Single-agent workflow components
    case AgentNameEnum.AgentNavigator:
      return 'Navigates websites and performs actions';
    case AgentNameEnum.AgentPlanner:
      return 'Develops and refines strategies to complete tasks';
    case AgentNameEnum.AgentValidator:
      return 'Checks if tasks are completed successfully';
    // Multiagent workflow components
    case AgentNameEnum.MultiagentPlanner:
      return 'Decomposes tasks and schedules workers';
    case AgentNameEnum.MultiagentWorker:
      return 'Executes assigned subtask within the plan';
    case AgentNameEnum.MultiagentRefiner:
      return 'Refines the plan';
    // Workflow-level agents
    case AgentNameEnum.Auto:
      return 'Analyzes requests and determines the best execution approach';
    case AgentNameEnum.Chat:
      return "Handles basic questions that don't require web access";
    case AgentNameEnum.Search:
      return 'Answers questions requiring current web information';
    // Utility agents
    case AgentNameEnum.HistorySummariser:
      return ''; // Description shown in section header instead
    case AgentNameEnum.Estimator:
      return 'Estimates cost and duration before starting browser workflows';
    default:
      return '';
  }
}

/**
 * Get CSS classes for agent section styling based on agent type and dark mode
 */
export function getAgentSectionColor(agentName: AgentNameEnum, isDarkMode: boolean): string {
  switch (agentName) {
    case AgentNameEnum.Auto:
      // Auto: very pale black
      return isDarkMode
        ? 'border-white/10 bg-white/5 backdrop-blur-md'
        : 'border-black/10 bg-black/5 backdrop-blur-md';
    case AgentNameEnum.Chat:
      // Chat: very pale violet
      return isDarkMode
        ? 'border-violet-400/30 bg-violet-500/10 backdrop-blur-md'
        : 'border-violet-500/20 bg-violet-500/10 backdrop-blur-md';
    case AgentNameEnum.Search:
      // Search: very pale teal
      return isDarkMode
        ? 'border-teal-400/30 bg-teal-500/10 backdrop-blur-md'
        : 'border-teal-500/20 bg-teal-500/10 backdrop-blur-md';
    case AgentNameEnum.MultiagentPlanner:
    case AgentNameEnum.MultiagentRefiner:
    case AgentNameEnum.MultiagentWorker:
      // Multi-agent: pale orange
      return isDarkMode
        ? 'border-orange-400/30 bg-orange-500/10 backdrop-blur-md'
        : 'border-orange-500/20 bg-orange-500/10 backdrop-blur-md';
    case AgentNameEnum.AgentNavigator:
    case AgentNameEnum.AgentPlanner:
    case AgentNameEnum.AgentValidator:
      // Agent family: very pale amber
      return isDarkMode
        ? 'border-amber-400/30 bg-amber-500/10 backdrop-blur-md'
        : 'border-amber-500/25 bg-amber-500/10 backdrop-blur-md';
    case AgentNameEnum.HistorySummariser:
    case AgentNameEnum.Estimator:
      // Utility agents: pale blue/gray
      return isDarkMode
        ? 'border-blue-400/20 bg-blue-500/5 backdrop-blur-md'
        : 'border-blue-500/15 bg-blue-500/5 backdrop-blur-md';
    default:
      return isDarkMode
        ? 'border-slate-700/70 bg-slate-800/60 backdrop-blur-md'
        : 'border-white/20 bg-white/40 backdrop-blur-md';
  }
}

// ============================================================================
// Factory functions for creating initial state objects
// ============================================================================

/**
 * Create a record mapping all AgentNameEnum values to a default value
 */
export function createAgentStateMap<T>(defaultValue: T | (() => T)): Record<AgentNameEnum, T> {
  const result = {} as Record<AgentNameEnum, T>;
  for (const agent of Object.values(AgentNameEnum)) {
    result[agent] = typeof defaultValue === 'function' ? (defaultValue as () => T)() : defaultValue;
  }
  return result;
}

/**
 * Create initial selected models state (all empty strings)
 */
export function createInitialSelectedModels(): Record<AgentNameEnum, string> {
  return createAgentStateMap('');
}

/**
 * Create initial model parameters state
 */
export function createInitialModelParameters(): Record<AgentNameEnum, { temperature: number; maxOutputTokens: number }> {
  return createAgentStateMap(() => ({ temperature: 0, maxOutputTokens: 8192 }));
}

/**
 * Create initial reasoning effort state (all undefined)
 */
export function createInitialReasoningEffort(): Record<AgentNameEnum, 'low' | 'medium' | 'high' | undefined> {
  return createAgentStateMap(undefined);
}

/**
 * Create initial web search enabled state (all false)
 */
export function createInitialWebSearchEnabled(): Record<AgentNameEnum, boolean> {
  return createAgentStateMap(false);
}

