/**
 * Tool definitions for chat-driven settings configuration.
 * Each tool maps to an existing storage API. Only pre-query settings are exposed.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/** Settings that can be modified via update_general_setting. */
export const ALLOWED_GENERAL_SETTINGS = [
  // Theme & display
  'themeMode',
  // Vision & display
  'useVision',
  'useVisionForPlanner',
  'displayHighlights',
  'enableCoordinateClick',
  'showTabPreviews',
  'fullPageWindow',
  // Agent behavior
  'maxSteps',
  'maxActionsPerStep',
  'maxFailures',
  'maxValidatorFailures',
  'retryDelay',
  'maxInputTokens',
  'planningInterval',
  'minWaitPageLoad',
  'maxWorkerAgents',
  // Pipeline toggles
  'useFullPlanningPipeline',
  'enablePlanner',
  'enableValidator',
  'enableMultiagentPlanner',
  'enableMultiagentValidator',
  // Context & history
  'enableAutoTabContext',
  'enableSiteSkills',
  'enableHistoryContext',
  'historySummaryWindowHours',
  'historySummaryMaxRawItems',
  'historySummaryMaxProcessedItems',
  // Execution
  'responseTimeoutSeconds',
  'enableWorkflowEstimation',
  'showEmergencyStop',
  // Region
  'preferredRegion',
] as const;

/** Region values accepted by preferredRegion (matches web-settings UI). */
export const VALID_REGIONS = [
  // Americas
  'com',
  'ca',
  'com.mx',
  'com.br',
  'com.ar',
  'com.co',
  // Europe
  'co.uk',
  'ie',
  'fr',
  'de',
  'at',
  'ch',
  'nl',
  'be',
  'es',
  'pt',
  'it',
  'se',
  'no',
  'dk',
  'fi',
  'pl',
  'cz',
  'com.tr',
  // Middle East & Africa
  'ae',
  'com.sa',
  'co.il',
  'co.za',
  // Asia-Pacific
  'cn',
  'co.jp',
  'co.kr',
  'com.tw',
  'com.hk',
  'in',
  'com.sg',
  'co.id',
  'co.th',
  'com.my',
  'com.ph',
  'com.vn',
  'com.au',
  'co.nz',
] as const;

/** Valid agent role names (user-facing → AgentNameEnum mapping is in tool-handlers). */
export const VALID_ROLES = [
  'Auto',
  'Chat',
  'Search',
  'Navigator',
  'AgentPlanner',
  'AgentValidator',
  'MultiagentPlanner',
  'MultiagentWorker',
  'MultiagentRefiner',
  'HistorySummariser',
  'Estimator',
] as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'add_tabs_to_context',
    description:
      'Add browser tabs to the conversation context. Use tab_ids to add specific tabs (from OPEN TABS list), or set all to true for every tab.',
    parameters: {
      tab_ids: { type: 'number[]', description: 'Array of tab IDs to add (from the OPEN TABS list in the prompt).' },
      all: { type: 'boolean', description: 'If true, add all open tabs. Overrides tab_ids.', default: false },
    },
  },
  {
    name: 'remove_tabs_from_context',
    description: 'Remove specific tabs from context, or remove all tabs from context.',
    parameters: {
      tab_ids: { type: 'number[]', description: 'Array of tab IDs to remove.' },
      all: { type: 'boolean', description: 'If true, remove all tabs from context.', default: false },
    },
  },
  {
    name: 'update_general_setting',
    description: `Update a general extension setting. Allowed settings: ${ALLOWED_GENERAL_SETTINGS.join(', ')}.`,
    parameters: {
      setting: { type: 'string', description: 'Setting key to update.', enum: [...ALLOWED_GENERAL_SETTINGS] },
      value: {
        type: 'any',
        description: 'New value (boolean, number, or string depending on the setting). null or empty to clear.',
      },
    },
    required: ['setting', 'value'],
  },
  {
    name: 'update_model_for_role',
    description: 'Change which LLM model is used for a specific agent role.',
    parameters: {
      role: { type: 'string', description: 'Agent role.', enum: [...VALID_ROLES] },
      provider: {
        type: 'string',
        description: 'Provider ID (openai, anthropic, gemini, grok, openrouter). Omit to keep current provider.',
      },
      model_name: { type: 'string', description: 'Model identifier (e.g., gpt-4o, claude-sonnet-4-20250514).' },
    },
    required: ['role', 'model_name'],
  },
  {
    name: 'update_model_parameters',
    description: 'Adjust parameters (temperature, max tokens, thinking level, web search) for a model role.',
    parameters: {
      role: { type: 'string', description: 'Agent role.', enum: [...VALID_ROLES] },
      temperature: { type: 'number|null', description: '0-2. null = reset to provider default.' },
      max_output_tokens: { type: 'number', description: 'Max output tokens (default 8192).' },
      thinking_level: {
        type: 'string|null',
        description: 'Controls reasoning depth. null = remove.',
        enum: ['high', 'medium', 'low', 'off', 'default'],
      },
      web_search: { type: 'boolean', description: 'Enable native web search tools.' },
    },
    required: ['role'],
  },
  {
    name: 'reset_settings_to_defaults',
    description: 'Reset a category of settings to defaults.',
    parameters: {
      category: { type: 'string', description: 'Which settings to reset.', enum: ['general', 'model'] },
      role: {
        type: 'string',
        description: 'If category is model, which role to reset. Omit to reset all.',
        enum: [...VALID_ROLES],
      },
    },
    required: ['category'],
  },
  {
    name: 'get_current_settings',
    description: 'Retrieve current settings so the user can inspect them.',
    parameters: {
      category: {
        type: 'string',
        description: 'Which settings to return.',
        enum: ['general', 'models', 'all'],
        default: 'all',
      },
      role: {
        type: 'string',
        description: 'If category is models, optionally filter to a single role.',
        enum: [...VALID_ROLES],
      },
    },
  },
  {
    name: 'list_available_models',
    description: 'List available models for a given provider.',
    parameters: {
      provider: {
        type: 'string',
        description: 'Provider ID.',
        enum: ['openai', 'anthropic', 'gemini', 'grok', 'openrouter'],
      },
    },
    required: ['provider'],
  },
  {
    name: 'list_configured_providers',
    description: 'List which LLM providers the user has configured (has API keys for).',
    parameters: {},
  },
  {
    name: 'update_speech_to_text',
    description: 'Update speech-to-text settings (language and auto-submit).',
    parameters: {
      language: {
        type: 'string',
        description: 'ISO 639-1 language code (e.g., en, fr, de, ja). Empty string to reset.',
      },
      auto_submit: { type: 'boolean', description: 'Auto-submit transcribed text after recording.' },
    },
  },
  {
    name: 'get_speech_to_text_settings',
    description: 'Retrieve current speech-to-text configuration.',
    parameters: {},
  },
];

/** Build a text representation of the tool schema for inclusion in prompts. */
export function buildToolSchemaText(): string {
  return TOOL_DEFINITIONS.map(t => {
    const params = Object.entries(t.parameters);
    const paramLines = params.map(([name, p]) => {
      const req = t.required?.includes(name) ? ' (required)' : '';
      const enumStr = p.enum ? ` One of: ${p.enum.join(', ')}.` : '';
      return `    - ${name}: ${p.type}${req} — ${p.description}${enumStr}`;
    });
    return `  ${t.name}: ${t.description}\n${paramLines.length ? paramLines.join('\n') : '    (no parameters)'}`;
  }).join('\n\n');
}
