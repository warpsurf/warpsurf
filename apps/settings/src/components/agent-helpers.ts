/**
 * Agent Helpers
 * Shared utilities for agent settings components
 */
import { AgentNameEnum, type ThinkingLevel } from '@extension/storage';

/** Warning message for web search compatibility (shown when selecting models for Search) */
export const WEB_SEARCH_COMPATIBILITY_WARNING =
  'Web search compatibility varies by model. Queries may fail for unsupported models.';

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
 * Uses subtle, pale tints to differentiate sections while maintaining the warm palette
 */
export function getAgentSectionColor(agentName: AgentNameEnum, isDarkMode: boolean): string {
  switch (agentName) {
    case AgentNameEnum.Auto:
      return isDarkMode ? 'border-[#3a3a38] bg-[#252524]' : 'border-[#e5e4e0] bg-[#f5f4f0]';
    case AgentNameEnum.Chat:
      return isDarkMode ? 'border-[#3a3a40] bg-[#252528]' : 'border-[#e4e4ec] bg-[#f4f4f8]';
    case AgentNameEnum.Search:
      return isDarkMode ? 'border-[#3a4040] bg-[#252828]' : 'border-[#e4ecec] bg-[#f4f8f8]';
    case AgentNameEnum.MultiagentPlanner:
    case AgentNameEnum.MultiagentRefiner:
    case AgentNameEnum.MultiagentWorker:
      return isDarkMode ? 'border-[#403a38] bg-[#282524]' : 'border-[#ece8e4] bg-[#f8f6f4]';
    case AgentNameEnum.AgentNavigator:
    case AgentNameEnum.AgentPlanner:
    case AgentNameEnum.AgentValidator:
      return isDarkMode ? 'border-[#3e3a34] bg-[#282520]' : 'border-[#ebe6e0] bg-[#f8f6f2]';
    case AgentNameEnum.HistorySummariser:
    case AgentNameEnum.Estimator:
      return isDarkMode ? 'border-[#383a3a] bg-[#242526]' : 'border-[#e6e8e8] bg-[#f4f6f6]';
    default:
      return isDarkMode ? 'border-[#3a3a34] bg-[#252522]' : 'border-[#e5e4de] bg-[#f3f2ee]';
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
 * Temperature is undefined by default, meaning "use provider's default temperature"
 * Users can explicitly set a temperature value if desired
 */
export function createInitialModelParameters(): Record<
  AgentNameEnum,
  { temperature: number | undefined; maxOutputTokens: number }
> {
  return createAgentStateMap(() => ({ temperature: undefined, maxOutputTokens: 8192 }));
}

/**
 * Create initial thinking level state (all undefined = default)
 */
export function createInitialThinkingLevel(): Record<AgentNameEnum, ThinkingLevel | undefined> {
  return createAgentStateMap(undefined);
}

/** @deprecated Use createInitialThinkingLevel */
export const createInitialReasoningEffort = createInitialThinkingLevel;

/**
 * Create initial web search enabled state (all false)
 */
export function createInitialWebSearchEnabled(): Record<AgentNameEnum, boolean> {
  return createAgentStateMap(false);
}
