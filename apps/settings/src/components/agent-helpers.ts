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
 * Each section has a distinct pale tint for visual differentiation
 */
export function getAgentSectionColor(agentName: AgentNameEnum, isDarkMode: boolean): string {
  switch (agentName) {
    case AgentNameEnum.Auto:
      // Neutral warm gray
      return isDarkMode ? 'border-[#3a3a38] bg-[#232321]' : 'border-[#e5e4e0] bg-[#f7f6f2]';
    case AgentNameEnum.Chat:
      // Pale violet tint
      return isDarkMode ? 'border-[#3d3a42] bg-[#252428]' : 'border-[#e6e4ed] bg-[#f6f5fa]';
    case AgentNameEnum.Search:
      // Pale teal tint
      return isDarkMode ? 'border-[#384040] bg-[#222828]' : 'border-[#e0eaea] bg-[#f2f8f8]';
    case AgentNameEnum.MultiagentPlanner:
    case AgentNameEnum.MultiagentRefiner:
    case AgentNameEnum.MultiagentWorker:
      // Pale orange/peach tint
      return isDarkMode ? 'border-[#423a36] bg-[#2a2420]' : 'border-[#ede6e0] bg-[#faf6f2]';
    case AgentNameEnum.AgentNavigator:
    case AgentNameEnum.AgentPlanner:
    case AgentNameEnum.AgentValidator:
      // Pale amber/yellow tint
      return isDarkMode ? 'border-[#403c32] bg-[#28261e]' : 'border-[#ebe8dc] bg-[#f9f7ee]';
    case AgentNameEnum.HistorySummariser:
      // Pale blue tint
      return isDarkMode ? 'border-[#363a40] bg-[#222528]' : 'border-[#e2e6ec] bg-[#f4f6fa]';
    case AgentNameEnum.Estimator:
      // Pale green tint
      return isDarkMode ? 'border-[#384038] bg-[#222822]' : 'border-[#e2ebe2] bg-[#f4faf4]';
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
