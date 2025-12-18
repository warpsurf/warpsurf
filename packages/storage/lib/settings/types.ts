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

// Fallback model lists (used when Helicone API unavailable)
export const llmProviderFallbackModelNames = {
  [ProviderTypeEnum.OpenAI]: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4.1-mini', 
    'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini', 'o1-mini', 'o4-mini', 'o3', 'gpt-4o-search-preview', 'gpt-4o-mini-search-preview',
    'gpt-4o-2024-11-20', 'gpt-4o-2024-08-06', 'gpt-4o-mini-2024-07-18', 'gpt-4-turbo', 'gpt-4-turbo-preview', 'gpt-3.5-turbo'],
  [ProviderTypeEnum.Anthropic]: [
    'claude-3-7-sonnet-latest',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'claude-opus-4-1-20250805',
    'claude-opus-4-1',
    'claude-opus-4-0',
    'claude-opus-4-20250514',
    'claude-sonnet-4-0',
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ],
  [ProviderTypeEnum.Gemini]: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-pro', 'gemini-pro-vision'],
  [ProviderTypeEnum.Grok]: ['grok-4', 'grok-4-fast', 'grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast', 'grok-2', 'grok-2-mini', 'grok-beta'],
  [ProviderTypeEnum.OpenRouter]: [
    'openai/gpt-4.1',
    'openai/gpt-4.1-mini',
    'openai/o4-mini',
    'openai/gpt-4o-2024-11-20',
    'google/gemini-2.5-flash-preview',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3-haiku',
    'meta-llama/llama-3.1-405b-instruct',
    'meta-llama/llama-3.1-70b-instruct',
    'meta-llama/llama-3.1-8b-instruct',
    'mistralai/mixtral-8x7b-instruct',
    'mistralai/mistral-7b-instruct',
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
    [AgentNameEnum.AgentPlanner]: 'gpt-4.1',
    [AgentNameEnum.MultiagentPlanner]: 'gpt-4.1',
    [AgentNameEnum.MultiagentWorker]: 'gpt-4.1',
    [AgentNameEnum.AgentNavigator]: 'gpt-4.1',
    [AgentNameEnum.AgentValidator]: 'gpt-4.1-mini',
    [AgentNameEnum.Auto]: 'gpt-5-nano',
    [AgentNameEnum.Chat]: 'gpt-5-mini',
    [AgentNameEnum.Search]: 'gpt-4o-mini-search-preview',
    [AgentNameEnum.MultiagentRefiner]: 'gpt-4.1-mini',
    [AgentNameEnum.HistorySummariser]: 'gpt-4.1-mini',
    [AgentNameEnum.Estimator]: 'gpt-5-nano',
  },
  [ProviderTypeEnum.Anthropic]: {
    [AgentNameEnum.AgentPlanner]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.MultiagentPlanner]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.MultiagentWorker]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.AgentNavigator]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.AgentValidator]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.Auto]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.Chat]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.Search]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.MultiagentRefiner]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.HistorySummariser]: 'claude-sonnet-4-20250514',
    [AgentNameEnum.Estimator]: 'claude-3-5-haiku-latest',
  },
  [ProviderTypeEnum.Gemini]: {
    [AgentNameEnum.AgentPlanner]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.MultiagentPlanner]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.MultiagentWorker]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.AgentNavigator]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.AgentValidator]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.Auto]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.Chat]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.Search]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.MultiagentRefiner]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.HistorySummariser]: 'gemini-2.5-flash-lite',
    [AgentNameEnum.Estimator]: 'gemini-2.5-flash-lite',
  },
  [ProviderTypeEnum.Grok]: {
    [AgentNameEnum.AgentPlanner]: 'grok-3',
    [AgentNameEnum.MultiagentPlanner]: 'grok-3',
    [AgentNameEnum.MultiagentWorker]: 'grok-3',
    [AgentNameEnum.AgentNavigator]: 'grok-3',
    [AgentNameEnum.AgentValidator]: 'grok-3-fast',
    [AgentNameEnum.Auto]: 'grok-3-mini',
    [AgentNameEnum.Chat]: 'grok-3-mini-fast',
    [AgentNameEnum.Search]: 'grok-3',
    [AgentNameEnum.MultiagentRefiner]: 'grok-3-fast',
    [AgentNameEnum.HistorySummariser]: 'grok-3-fast',
    [AgentNameEnum.Estimator]: 'grok-3-mini-fast',
  },
  [ProviderTypeEnum.OpenRouter]: {
    [AgentNameEnum.AgentPlanner]: 'openai/gpt-4.1',
    [AgentNameEnum.MultiagentPlanner]: 'openai/gpt-4.1',
    [AgentNameEnum.MultiagentWorker]: 'openai/gpt-4.1',
    [AgentNameEnum.AgentNavigator]: 'openai/gpt-4.1',
    [AgentNameEnum.AgentValidator]: 'openai/gpt-4.1-mini',
    [AgentNameEnum.Auto]: 'openai/gpt-4.1-mini',
    [AgentNameEnum.Chat]: 'openai/gpt-4o-2024-11-20',
    [AgentNameEnum.Search]: 'google/gemini-2.5-flash-preview',
    [AgentNameEnum.MultiagentRefiner]: 'openai/gpt-4.1-mini',
    [AgentNameEnum.HistorySummariser]: 'openai/gpt-4.1-mini',
    [AgentNameEnum.Estimator]: 'openai/gpt-4.1-mini',
  },
  // Custom OpenAI providers don't have predefined models as they are user-defined
};