import {
  generalSettingsStore,
  agentModelStore,
  AgentNameEnum,
  llmProviderFallbackModelNames,
  ProviderTypeEnum,
} from '@extension/storage';
import { getAllProvidersDecrypted } from '@src/crypto';
import { ALLOWED_GENERAL_SETTINGS } from './tool-schema';
import { createLogger } from '@src/log';

const logger = createLogger('ToolHandlers');

export interface ToolCallResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/** Context passed to handlers for runtime actions (e.g., setting context tabs). */
export interface ToolContext {
  setContextTabIds: (ids: number[]) => void;
  removeContextTabIds: (idsToRemove: Set<number>) => void;
}

/** Map user-facing role names to AgentNameEnum. */
const ROLE_MAP: Record<string, AgentNameEnum> = {
  Auto: AgentNameEnum.Auto,
  Chat: AgentNameEnum.Chat,
  Search: AgentNameEnum.Search,
  Navigator: AgentNameEnum.AgentNavigator,
  AgentPlanner: AgentNameEnum.AgentPlanner,
  AgentValidator: AgentNameEnum.AgentValidator,
  MultiagentPlanner: AgentNameEnum.MultiagentPlanner,
  MultiagentWorker: AgentNameEnum.MultiagentWorker,
  MultiagentRefiner: AgentNameEnum.MultiagentRefiner,
  HistorySummariser: AgentNameEnum.HistorySummariser,
  Estimator: AgentNameEnum.Estimator,
};

const allowedSettingsSet = new Set<string>(ALLOWED_GENERAL_SETTINGS);

/** String settings with specific allowed values. */
const STRING_ENUM_SETTINGS: Record<string, readonly string[]> = {
  themeMode: ['auto', 'light', 'dark'],
};

type Handler = (args: Record<string, any>, ctx: ToolContext) => Promise<ToolCallResult>;

const handlers: Record<string, Handler> = {
  // ── Context Management ──────────────────────────────────────────────

  add_tabs_to_context: async (args, ctx) => {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const eligible = allTabs.filter(
      t => t.id && t.id > 0 && !t.url?.startsWith('chrome://') && !t.url?.startsWith('chrome-extension://'),
    );

    let selected: chrome.tabs.Tab[];
    if (args.all) {
      selected = eligible;
    } else if (Array.isArray(args.tab_ids) && args.tab_ids.length > 0) {
      const requestedIds = new Set(args.tab_ids.map(Number));
      selected = eligible.filter(t => requestedIds.has(t.id!));
      if (selected.length === 0) {
        return { success: false, message: `None of the requested tab IDs (${args.tab_ids.join(', ')}) were found.` };
      }
    } else {
      // Default to active tab
      const active = await chrome.tabs.query({ active: true, currentWindow: true });
      selected = active.filter(
        t => t.id && t.id > 0 && !t.url?.startsWith('chrome://') && !t.url?.startsWith('chrome-extension://'),
      );
    }

    if (selected.length === 0) {
      return { success: false, message: 'No eligible tabs found.' };
    }

    const tabIds = selected.map(t => t.id!);
    ctx.setContextTabIds(tabIds);

    const tabMeta = selected.map(t => ({
      id: t.id!,
      title: t.title || '(untitled)',
      favIconUrl: t.favIconUrl,
      url: t.url,
    }));
    const titles = tabMeta.map(t => t.title);
    return {
      success: true,
      message: `Added ${tabIds.length} tab(s) to context: ${titles.join(', ')}`,
      data: { contextTabsMeta: tabMeta },
    };
  },

  remove_tabs_from_context: async (args, ctx) => {
    if (args.all) {
      ctx.setContextTabIds([]);
      return { success: true, message: 'Removed all tabs from context.' };
    }

    if (!Array.isArray(args.tab_ids) || args.tab_ids.length === 0) {
      return { success: false, message: 'Specify tab_ids to remove, or set all to true.' };
    }

    const removeSet = new Set(args.tab_ids.map(Number));
    // We need the current context tab IDs - pass them through ctx
    ctx.removeContextTabIds(removeSet);
    return { success: true, message: `Removed ${removeSet.size} tab(s) from context.` };
  },

  // ── General Settings ────────────────────────────────────────────────

  update_general_setting: async args => {
    const { setting, value } = args;
    if (!allowedSettingsSet.has(setting)) {
      return { success: false, message: `Setting '${setting}' cannot be modified via chat.` };
    }

    const current = await generalSettingsStore.getSettings();
    const currentVal = (current as any)[setting];
    let coerced = value;

    // Validate string enum settings
    const allowedValues = STRING_ENUM_SETTINGS[setting];
    if (allowedValues) {
      const strValue = String(value).toLowerCase();
      if (!allowedValues.includes(strValue)) {
        return { success: false, message: `Invalid value for '${setting}'. Allowed: ${allowedValues.join(', ')}.` };
      }
      coerced = strValue;
    } else if (typeof currentVal === 'boolean') {
      coerced = value === true || value === 'true';
    } else if (typeof currentVal === 'number') {
      coerced = Number(value);
      if (isNaN(coerced)) return { success: false, message: `Invalid number for '${setting}'.` };
    }

    await generalSettingsStore.updateSettings({ [setting]: coerced });
    return { success: true, message: `${setting} set to ${coerced}` };
  },

  // ── Model Configuration ─────────────────────────────────────────────

  update_model_for_role: async args => {
    const agentName = ROLE_MAP[args.role];
    if (!agentName) return { success: false, message: `Unknown role: ${args.role}` };

    const existing = (await agentModelStore.getAgentModel(agentName)) || ({} as any);
    const provider = args.provider || existing.provider;
    if (!provider)
      return { success: false, message: `No provider specified and no existing provider for ${args.role}.` };

    await agentModelStore.setAgentModel(agentName, {
      ...existing,
      provider,
      modelName: args.model_name,
    });

    return { success: true, message: `${args.role} model → ${args.model_name} (${provider})` };
  },

  update_model_parameters: async args => {
    const agentName = ROLE_MAP[args.role];
    if (!agentName) return { success: false, message: `Unknown role: ${args.role}` };

    const existing = await agentModelStore.getAgentModel(agentName);
    if (!existing) return { success: false, message: `No model configured for ${args.role}. Set a model first.` };

    const params = { ...(existing.parameters || {}) };
    const changes: string[] = [];

    if (args.temperature !== undefined) {
      if (args.temperature === null) {
        delete params.temperature;
        changes.push('temperature → default');
      } else {
        params.temperature = args.temperature;
        changes.push(`temperature → ${args.temperature}`);
      }
    }
    if (args.max_output_tokens !== undefined) {
      params.maxOutputTokens = args.max_output_tokens;
      changes.push(`maxOutputTokens → ${args.max_output_tokens}`);
    }

    const update: any = { ...existing, parameters: params };
    if (args.reasoning_effort !== undefined) {
      update.reasoningEffort = args.reasoning_effort === null ? undefined : args.reasoning_effort;
      changes.push(`reasoningEffort → ${args.reasoning_effort ?? 'removed'}`);
    }
    if (args.web_search !== undefined) {
      update.webSearch = args.web_search;
      changes.push(`webSearch → ${args.web_search}`);
    }

    if (changes.length === 0) return { success: false, message: 'No parameters specified to update.' };

    await agentModelStore.setAgentModel(agentName, update);
    return { success: true, message: `${args.role}: ${changes.join(', ')}` };
  },

  // ── Reset ───────────────────────────────────────────────────────────

  reset_settings_to_defaults: async args => {
    if (args.category === 'general') {
      await generalSettingsStore.resetToDefaults();
      return { success: true, message: 'General settings reset to defaults.' };
    }
    if (args.category === 'model') {
      if (args.role) {
        const agentName = ROLE_MAP[args.role];
        if (!agentName) return { success: false, message: `Unknown role: ${args.role}` };
        await agentModelStore.resetAgentModel(agentName);
        return { success: true, message: `${args.role} model config reset.` };
      }
      // Reset all models
      const agents = await agentModelStore.getConfiguredAgents();
      for (const agent of agents) await agentModelStore.resetAgentModel(agent);
      return { success: true, message: `All model configurations reset (${agents.length} roles).` };
    }
    return { success: false, message: `Unknown category: ${args.category}` };
  },

  // ── Read-Only Queries ───────────────────────────────────────────────

  get_current_settings: async args => {
    const category = args.category || 'all';
    const data: any = {};

    if (category === 'general' || category === 'all') {
      data.general = await generalSettingsStore.getSettings();
    }
    if (category === 'models' || category === 'all') {
      const all = await agentModelStore.getAllAgentModels();
      if (args.role) {
        const agentName = ROLE_MAP[args.role];
        data.models = agentName ? { [args.role]: all[agentName] } : {};
      } else {
        // Remap to user-facing role names
        data.models = Object.fromEntries(
          Object.entries(ROLE_MAP)
            .filter(([, v]) => all[v])
            .map(([k, v]) => [k, all[v]]),
        );
      }
    }
    return { success: true, message: 'Settings retrieved.', data };
  },

  list_available_models: async args => {
    const providerMap: Record<string, ProviderTypeEnum> = {
      openai: ProviderTypeEnum.OpenAI,
      anthropic: ProviderTypeEnum.Anthropic,
      gemini: ProviderTypeEnum.Gemini,
      grok: ProviderTypeEnum.Grok,
      openrouter: ProviderTypeEnum.OpenRouter,
    };
    const pt = providerMap[args.provider?.toLowerCase()];
    if (!pt) return { success: false, message: `Unknown provider: ${args.provider}` };

    const models = (llmProviderFallbackModelNames as any)[pt] || [];
    return { success: true, message: `${models.length} models available for ${args.provider}.`, data: models };
  },

  list_configured_providers: async () => {
    try {
      const providers = await getAllProvidersDecrypted();
      const ids = Object.keys(providers);
      return { success: true, message: `Configured providers: ${ids.join(', ') || 'none'}`, data: ids };
    } catch {
      return { success: false, message: 'Failed to read provider configuration.' };
    }
  },
};

/**
 * Execute a single tool call by name.
 */
export async function executeToolCall(
  name: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const handler = handlers[name];
  if (!handler) {
    logger.warning(`Unknown tool: ${name}`);
    return { success: false, message: `Unknown tool: ${name}` };
  }
  try {
    return await handler(args, ctx);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Tool '${name}' failed: ${msg}`);
    return { success: false, message: `Tool '${name}' failed: ${msg}` };
  }
}
