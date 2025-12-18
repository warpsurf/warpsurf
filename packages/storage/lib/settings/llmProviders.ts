import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { type AgentNameEnum, llmProviderFallbackModelNames, llmProviderDefaultModels, llmProviderDefaultWebSearch, ProviderTypeEnum } from './types';
import type { EncryptedData } from '../crypto/types';

export interface ProviderConfig {
  name?: string;
  type?: ProviderTypeEnum;
  apiKey?: string;
  _k?: EncryptedData;
  baseUrl?: string;
  modelNames?: string[];
  createdAt?: number;
  enabledSubProviders?: string[];
}

// Interface for storing multiple LLM provider configurations
// The key is the provider id, which is the same as the provider type for built-in providers, but is custom for custom providers
export interface LLMKeyRecord {
  providers: Record<string, ProviderConfig>;
}

export type LLMProviderStorage = BaseStorage<LLMKeyRecord> & {
  setProvider: (providerId: string, config: ProviderConfig) => Promise<void>;
  getProvider: (providerId: string) => Promise<ProviderConfig | undefined>;
  removeProvider: (providerId: string) => Promise<void>;
  hasProvider: (providerId: string) => Promise<boolean>;
  getAllProviders: () => Promise<Record<string, ProviderConfig>>;
};

// Storage for LLM provider configurations
// use "llm-api-keys" as the key for the storage, for backward compatibility
const storage = createStorage<LLMKeyRecord>(
  'llm-api-keys',
  { providers: {} },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

// Helper function to determine provider type from provider name
// Make sure to update this function if you add a new provider type
export function getProviderTypeByProviderId(providerId: string): ProviderTypeEnum {
  // Handle standard provider types
  switch (providerId) {
    case ProviderTypeEnum.OpenAI:
    case ProviderTypeEnum.Anthropic:
    case ProviderTypeEnum.Gemini:
    case ProviderTypeEnum.Grok:
    case ProviderTypeEnum.OpenRouter:
      return providerId;
    default:
      return ProviderTypeEnum.CustomOpenAI;
  }
}

// Helper function to get display name from provider id
// Make sure to update this function if you add a new provider type
export function getDefaultDisplayNameFromProviderId(providerId: string): string {
  switch (providerId) {
    case ProviderTypeEnum.OpenAI:
      return 'OpenAI';
    case ProviderTypeEnum.Anthropic:
      return 'Anthropic';
    case ProviderTypeEnum.Gemini:
      return 'Google';
    case ProviderTypeEnum.Grok:
      return 'xAI';
    case ProviderTypeEnum.OpenRouter:
      return 'OpenRouter';
    default:
      return providerId; // Use the provider id as display name for custom providers by default
  }
}

// Get default configuration for built-in providers
export function getDefaultProviderConfig(providerId: string): ProviderConfig {
  switch (providerId) {
    case ProviderTypeEnum.OpenAI:
    case ProviderTypeEnum.Anthropic:
    case ProviderTypeEnum.Gemini:
    case ProviderTypeEnum.Grok:
      return {
        apiKey: '',
        name: getDefaultDisplayNameFromProviderId(providerId),
        type: providerId,
        modelNames: [...(llmProviderFallbackModelNames[providerId] || [])],
        createdAt: Date.now(),
      };
    case ProviderTypeEnum.OpenRouter:
      return {
        apiKey: '',
        name: getDefaultDisplayNameFromProviderId(providerId),
        type: providerId,
        baseUrl: 'https://openrouter.ai/api/v1',
        modelNames: [],
        enabledSubProviders: [],
        createdAt: Date.now(),
      };
    default:
      return {
        apiKey: '',
        name: getDefaultDisplayNameFromProviderId(providerId),
        type: ProviderTypeEnum.CustomOpenAI,
        baseUrl: '',
        modelNames: [],
        createdAt: Date.now(),
      };
  }
}

export function getDefaultAgentModelParams(providerId: string, agentName: AgentNameEnum): Record<string, number> {
  // UI-driven; provide a neutral fallback only if UI hasn't saved yet
  return { temperature: 0.0 };
}

export function getDefaultAgentModel(providerId: string, agentName: AgentNameEnum): string | undefined {
  const providerType = getProviderTypeByProviderId(providerId);
  return llmProviderDefaultModels[providerType as keyof typeof llmProviderDefaultModels]?.[agentName];
}

export function getDefaultWebSearchSetting(providerId: string, agentName: AgentNameEnum): boolean {
  const providerType = getProviderTypeByProviderId(providerId);
  return llmProviderDefaultWebSearch[providerType as keyof typeof llmProviderDefaultWebSearch]?.[agentName] || false;
}

// Ensure backward compatibility for provider configs
function ensureBackwardCompatibility(providerId: string, config: ProviderConfig): ProviderConfig {
  const updatedConfig = { ...config };

  if (!updatedConfig.name) {
    updatedConfig.name = getDefaultDisplayNameFromProviderId(providerId);
  }
  if (!updatedConfig.type) {
    updatedConfig.type = getProviderTypeByProviderId(providerId);
  }
  if (!updatedConfig.modelNames) {
    updatedConfig.modelNames = llmProviderFallbackModelNames[providerId as keyof typeof llmProviderFallbackModelNames] || [];
  }
  if (!updatedConfig.createdAt) {
    updatedConfig.createdAt = new Date('03/04/2025').getTime();
  }
  // OpenRouter: ensure enabledSubProviders exists
  if (updatedConfig.type === ProviderTypeEnum.OpenRouter && !updatedConfig.enabledSubProviders) {
    updatedConfig.enabledSubProviders = [];
  }

  return updatedConfig;
}

export const llmProviderStore: LLMProviderStorage = {
  ...storage,
  async setProvider(providerId: string, config: ProviderConfig) {
    if (!providerId) {
      throw new Error('Provider id cannot be empty');
    }

    const providerType = config.type || getProviderTypeByProviderId(providerId);

    // Check for API key presence (either plaintext or encrypted)
    const hasApiKey = !!(config.apiKey?.trim() || config._k);

    // API key is required for built-in providers (except CustomOpenAI)
    if (providerType !== ProviderTypeEnum.CustomOpenAI && !hasApiKey) {
      throw new Error(`API Key is required for ${getDefaultDisplayNameFromProviderId(providerId)}`);
    }

    if (!config.modelNames || config.modelNames.length === 0) {
      console.warn(`Provider ${providerId} of type ${providerType} is being saved without model names.`);
    }

    const completeConfig: ProviderConfig = {
      baseUrl: config.baseUrl,
      name: config.name || getDefaultDisplayNameFromProviderId(providerId),
      type: providerType,
      createdAt: config.createdAt || Date.now(),
      modelNames: config.modelNames || [],
      enabledSubProviders: config.enabledSubProviders,
    };

    if (config._k) {
      completeConfig._k = config._k;
    }
    if (config.apiKey !== undefined) {
      completeConfig.apiKey = config.apiKey;
    }

    const current = (await storage.get()) || { providers: {} };
    await storage.set({
      providers: {
        ...current.providers,
        [providerId]: completeConfig,
      },
    });
  },
  async getProvider(providerId: string) {
    const data = (await storage.get()) || { providers: {} };
    const config = data.providers[providerId];
    return config ? ensureBackwardCompatibility(providerId, config) : undefined;
  },
  async removeProvider(providerId: string) {
    const current = (await storage.get()) || { providers: {} };
    const newProviders = { ...current.providers };
    delete newProviders[providerId];
    await storage.set({ providers: newProviders });
  },
  async hasProvider(providerId: string) {
    const data = (await storage.get()) || { providers: {} };
    return providerId in data.providers;
  },

  async getAllProviders() {
    const data = await storage.get();
    const providers = { ...data.providers };

    // Add backward compatibility for all providers
    for (const [providerId, config] of Object.entries(providers)) {
      providers[providerId] = ensureBackwardCompatibility(providerId, config);
    }

    return providers;
  },
};
