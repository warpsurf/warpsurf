// Agent name, used to identify the agent in the settings
export enum AgentNameEnum {
  // Single-agent workflow components
  AgentPlanner = 'agent_planner',
  AgentNavigator = 'agent_navigator',
  AgentValidator = 'agent_validator',
  // Multiagent workflow components
  MultiagentPlanner = 'multiagent_planner',
  MultiagentWorker = 'multiagent_worker',
  MultiagentRefiner = 'multiagent_refiner',
  // Workflow-level agents
  Auto = 'auto',
  Chat = 'chat',
  Search = 'search',
  // Utility agents
  HistorySummariser = 'history_summariser',
  Estimator = 'estimator',
}

// Provider type, types before CustomOpenAI are built-in providers, CustomOpenAI is a custom provider
// For built-in providers, we will create ChatModel instances with its respective LangChain ChatModel classes
// For custom providers, we will create ChatModel instances with the ChatOpenAI class
export enum ProviderTypeEnum {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  Gemini = 'gemini',
  Grok = 'grok',
  OpenRouter = 'openrouter',
  CustomOpenAI = 'custom_openai',
}

// Thinking level type used across all providers
export type ThinkingLevel = 'high' | 'medium' | 'low' | 'off' | 'default';

// Fallback model lists (used when OpenRouter data unavailable)
export const llmProviderFallbackModelNames = {
  [ProviderTypeEnum.OpenAI]: [
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5-chat-latest',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'o3',
    'o4-mini',
    'o3-mini',
    'o1',
    'gpt-4o-search-preview',
    'gpt-4o-mini-search-preview',
    'gpt-4o-2024-11-20',
    'gpt-4o-2024-08-06',
    'gpt-4o-mini-2024-07-18',
    'gpt-4-turbo',
    'gpt-4-turbo-preview',
    'gpt-3.5-turbo',
  ],
  [ProviderTypeEnum.Anthropic]: [
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-opus-4-5-20251101',
    'claude-opus-4-1-20250805',
    'claude-opus-4-1',
    'claude-opus-4-0',
    'claude-opus-4-20250514',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-0',
    'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
    'claude-3-7-sonnet-latest',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-haiku-20240307',
  ],
  [ProviderTypeEnum.Gemini]: [
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite',
  ],
  [ProviderTypeEnum.Grok]: ['grok-4', 'grok-4-fast', 'grok-3', 'grok-3-mini'],
  [ProviderTypeEnum.OpenRouter]: [
    'openai/gpt-5',
    'openai/gpt-5-mini',
    'openai/gpt-4.1',
    'openai/gpt-4.1-mini',
    'openai/o4-mini',
    'openai/gpt-4o-2024-11-20',
    'google/gemini-3.1-flash-lite-preview',
    'google/gemini-2.5-flash',
    'anthropic/claude-sonnet-4.5',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3-haiku',
    'meta-llama/llama-3.1-405b-instruct',
    'meta-llama/llama-3.1-70b-instruct',
    'meta-llama/llama-3.1-8b-instruct',
    'mistralai/mixtral-8x7b-instruct',
    'mistralai/mistral-7b-instruct-v0.1',
  ],
  // Custom OpenAI providers don't have predefined models
};

// Backward compatibility alias
export const llmProviderModelNames = llmProviderFallbackModelNames;

// Default web search settings for each agent per provider
export const llmProviderDefaultWebSearch = {
  [ProviderTypeEnum.Anthropic]: {
    [AgentNameEnum.AgentPlanner]: false,
    [AgentNameEnum.MultiagentPlanner]: false,
    [AgentNameEnum.MultiagentWorker]: false,
    [AgentNameEnum.AgentNavigator]: false,
    [AgentNameEnum.AgentValidator]: false,
    [AgentNameEnum.Auto]: false,
    [AgentNameEnum.Chat]: false,
    [AgentNameEnum.Search]: true, // Enable web search for Search by default
    [AgentNameEnum.MultiagentRefiner]: false,
    [AgentNameEnum.HistorySummariser]: false,
    [AgentNameEnum.Estimator]: false,
  },
  [ProviderTypeEnum.Gemini]: {
    [AgentNameEnum.AgentPlanner]: false,
    [AgentNameEnum.MultiagentPlanner]: false,
    [AgentNameEnum.MultiagentWorker]: false,
    [AgentNameEnum.AgentNavigator]: false,
    [AgentNameEnum.AgentValidator]: false,
    [AgentNameEnum.Auto]: false,
    [AgentNameEnum.Chat]: false,
    [AgentNameEnum.Search]: true, // Enable web search for Search by default
    [AgentNameEnum.MultiagentRefiner]: false,
    [AgentNameEnum.HistorySummariser]: false,
    [AgentNameEnum.Estimator]: false,
  },
  [ProviderTypeEnum.Grok]: {
    [AgentNameEnum.AgentPlanner]: false,
    [AgentNameEnum.MultiagentPlanner]: false,
    [AgentNameEnum.MultiagentWorker]: false,
    [AgentNameEnum.AgentNavigator]: false,
    [AgentNameEnum.AgentValidator]: false,
    [AgentNameEnum.Auto]: false,
    [AgentNameEnum.Chat]: false,
    [AgentNameEnum.Search]: true, // Enable Live Search for Search by default
    [AgentNameEnum.MultiagentRefiner]: false,
    [AgentNameEnum.HistorySummariser]: false,
    [AgentNameEnum.Estimator]: false,
  },
  [ProviderTypeEnum.OpenRouter]: {
    [AgentNameEnum.AgentPlanner]: false,
    [AgentNameEnum.MultiagentPlanner]: false,
    [AgentNameEnum.MultiagentWorker]: false,
    [AgentNameEnum.AgentNavigator]: false,
    [AgentNameEnum.AgentValidator]: false,
    [AgentNameEnum.Auto]: false,
    [AgentNameEnum.Chat]: false,
    [AgentNameEnum.Search]: false, // OpenRouter routes to various providers; web search depends on underlying model
    [AgentNameEnum.MultiagentRefiner]: false,
    [AgentNameEnum.HistorySummariser]: false,
    [AgentNameEnum.Estimator]: false,
  },
};

// Default model recommendations for each agent per provider
export const llmProviderDefaultModels = {
  [ProviderTypeEnum.OpenAI]: {
    [AgentNameEnum.AgentPlanner]: 'gpt-5-mini',
    [AgentNameEnum.MultiagentPlanner]: 'gpt-5-mini',
    [AgentNameEnum.MultiagentWorker]: 'gpt-5-mini',
    [AgentNameEnum.AgentNavigator]: 'gpt-5-mini',
    [AgentNameEnum.AgentValidator]: 'gpt-5-mini',
    [AgentNameEnum.Auto]: 'gpt-5-mini',
    [AgentNameEnum.Chat]: 'gpt-5-mini',
    [AgentNameEnum.Search]: 'gpt-5-mini',
    [AgentNameEnum.MultiagentRefiner]: 'gpt-5-mini',
    [AgentNameEnum.HistorySummariser]: 'gpt-5-mini',
    [AgentNameEnum.Estimator]: 'gpt-5-mini',
  },
  [ProviderTypeEnum.Anthropic]: {
    [AgentNameEnum.AgentPlanner]: 'claude-sonnet-4-6',
    [AgentNameEnum.MultiagentPlanner]: 'claude-sonnet-4-6',
    [AgentNameEnum.MultiagentWorker]: 'claude-sonnet-4-6',
    [AgentNameEnum.AgentNavigator]: 'claude-sonnet-4-6',
    [AgentNameEnum.AgentValidator]: 'claude-sonnet-4-6',
    [AgentNameEnum.Auto]: 'claude-sonnet-4-6',
    [AgentNameEnum.Chat]: 'claude-sonnet-4-6',
    [AgentNameEnum.Search]: 'claude-sonnet-4-6',
    [AgentNameEnum.MultiagentRefiner]: 'claude-sonnet-4-6',
    [AgentNameEnum.HistorySummariser]: 'claude-sonnet-4-6',
    [AgentNameEnum.Estimator]: 'claude-sonnet-4-6',
  },
  [ProviderTypeEnum.Gemini]: {
    [AgentNameEnum.AgentPlanner]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.MultiagentPlanner]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.MultiagentWorker]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.AgentNavigator]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.AgentValidator]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.Auto]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.Chat]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.Search]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.MultiagentRefiner]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.HistorySummariser]: 'gemini-3.1-flash-lite-preview',
    [AgentNameEnum.Estimator]: 'gemini-3.1-flash-lite-preview',
  },
  [ProviderTypeEnum.Grok]: {
    [AgentNameEnum.AgentPlanner]: 'grok-4-fast',
    [AgentNameEnum.MultiagentPlanner]: 'grok-4-fast',
    [AgentNameEnum.MultiagentWorker]: 'grok-4-fast',
    [AgentNameEnum.AgentNavigator]: 'grok-4-fast',
    [AgentNameEnum.AgentValidator]: 'grok-4-fast',
    [AgentNameEnum.Auto]: 'grok-4-fast',
    [AgentNameEnum.Chat]: 'grok-4-fast',
    [AgentNameEnum.Search]: 'grok-4-fast',
    [AgentNameEnum.MultiagentRefiner]: 'grok-4-fast',
    [AgentNameEnum.HistorySummariser]: 'grok-4-fast',
    [AgentNameEnum.Estimator]: 'grok-4-fast',
  },
  [ProviderTypeEnum.OpenRouter]: {
    [AgentNameEnum.AgentPlanner]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.MultiagentPlanner]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.MultiagentWorker]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.AgentNavigator]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.AgentValidator]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.Auto]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.Chat]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.Search]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.MultiagentRefiner]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.HistorySummariser]: 'google/gemini-3.1-flash-lite-preview',
    [AgentNameEnum.Estimator]: 'google/gemini-3.1-flash-lite-preview',
  },
  // Custom OpenAI providers don't have predefined models as they are user-defined
};
