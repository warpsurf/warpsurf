/**
 * Model Registry - Single source for model lists and pricing
 *
 * Data Source: OpenRouter API (models + pricing for all providers)
 *
 * For direct providers (OpenAI, Anthropic, Gemini, Grok), models are derived
 * from OpenRouter's provider groups with the provider prefix stripped.
 *
 * When useLivePricingData=false, uses bundled cache from pricing-cache.ts
 */
import { filterModelsForProvider } from './model-filters';
import { CACHED_PRICING_DATA } from './pricing-cache';
import { llmProviderModelNames } from '@extension/storage';

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
}

interface OpenRouterApiResponse {
  data: OpenRouterModel[];
}

export interface OpenRouterProviderGroup {
  id: string;
  displayName: string;
  modelCount: number;
  models: string[];
}

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
}

const STORAGE_KEY = 'model-registry-cache';
const CACHE_VERSION = 8; // v8: Removed Helicone, OpenRouter-only

// Map internal provider IDs to OpenRouter group IDs
const PROVIDER_TO_OPENROUTER_GROUP: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
  grok: 'x-ai',
};

const OPENROUTER_PROVIDER_PRIORITY: Record<string, number> = {
  openai: 1,
  anthropic: 2,
  google: 3,
  'meta-llama': 4,
  mistralai: 5,
  'x-ai': 6,
  deepseek: 7,
  cohere: 8,
  perplexity: 9,
};

const OPENROUTER_PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  'meta-llama': 'Meta Llama',
  mistralai: 'Mistral',
  'x-ai': 'xAI',
  deepseek: 'DeepSeek',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  qwen: 'Qwen',
  microsoft: 'Microsoft',
};

class ModelRegistry {
  private static instance: ModelRegistry;
  private openRouterGroups: OpenRouterProviderGroup[] = [];
  private openRouterPricing: Map<string, ModelPricing> = new Map();
  private contextLengths: Map<string, number> = new Map();
  private loggedModels: Set<string> = new Set();

  private openRouterFetchedAt = 0;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  private useLiveData = false;
  private cacheDate: string | null = null;

  private constructor() {}

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    await this.initPromise;
    this.isInitialized = true;
  }

  private async doInitialize(): Promise<void> {
    await this.loadPricingModeSetting();

    if (this.useLiveData) {
      await this.loadFromStorage();
      if (this.openRouterGroups.length === 0) {
        await this.refreshFromOpenRouter();
        this.logSummary('Initialized (live)');
      } else {
        this.logSummary('Initialized from storage (live)');
        this.refreshFromOpenRouter()
          .then(() => this.logSummary('Refreshed (live)'))
          .catch(err => console.warn('[ModelRegistry] Background refresh failed:', err));
      }
    } else {
      this.loadFromStaticCache();
      this.logSummary('Initialized from bundled cache');
    }
  }

  private async loadPricingModeSetting(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('warnings-settings');
      const settings = result['warnings-settings'];
      this.useLiveData = settings?.useLivePricingData ?? false;
    } catch {
      this.useLiveData = false;
    }
  }

  private loadFromStaticCache(): void {
    this.cacheDate = CACHED_PRICING_DATA.generatedAt;

    this.openRouterGroups = CACHED_PRICING_DATA.openRouter.groups.map(g => ({
      id: g.id,
      displayName: g.displayName,
      modelCount: g.models.length,
      models: g.models,
    }));
    this.openRouterFetchedAt = new Date(CACHED_PRICING_DATA.generatedAt).getTime();

    for (const [model, pricing] of Object.entries(CACHED_PRICING_DATA.openRouter.pricing)) {
      this.openRouterPricing.set(model, pricing);
    }

    if (CACHED_PRICING_DATA.openRouter.contextLengths) {
      for (const [model, length] of Object.entries(CACHED_PRICING_DATA.openRouter.contextLengths)) {
        this.contextLengths.set(model, length);
      }
    }
  }

  private logSummary(context: string): void {
    const orTotal = this.openRouterGroups.reduce((s, g) => s + g.modelCount, 0);
    console.log(
      `[ModelRegistry] ${context} (${this.openRouterGroups.length} providers, ${orTotal} models, ${this.openRouterPricing.size} priced)`,
    );
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const cached = result[STORAGE_KEY];
      if (!cached || cached.version !== CACHE_VERSION) {
        if (cached) await chrome.storage.local.remove(STORAGE_KEY);
        return;
      }

      this.openRouterGroups = cached.openRouterGroups || [];
      this.openRouterFetchedAt = cached.openRouterFetchedAt || 0;

      if (cached.openRouterPricing) {
        this.openRouterPricing = new Map(Object.entries(cached.openRouterPricing));
      }
      if (cached.contextLengths) {
        this.contextLengths = new Map(Object.entries(cached.contextLengths));
      }
    } catch (e) {
      console.warn('[ModelRegistry] Failed to load from storage:', e);
    }
  }

  private async saveToStorage(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          version: CACHE_VERSION,
          openRouterGroups: this.openRouterGroups,
          openRouterFetchedAt: this.openRouterFetchedAt,
          openRouterPricing: Object.fromEntries(this.openRouterPricing),
          contextLengths: Object.fromEntries(this.contextLengths),
        },
      });
    } catch (e) {
      console.warn('[ModelRegistry] Failed to save to storage:', e);
    }
  }

  async refreshFromOpenRouter(): Promise<void> {
    await this.fetchOpenRouterModels();
    await this.saveToStorage();
  }

  private async fetchOpenRouterModels(): Promise<void> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      if (!res.ok) return;

      const data: OpenRouterApiResponse = await res.json();
      const groups = new Map<string, string[]>();

      for (const model of data.data) {
        if (model.id.endsWith(':free') || model.id.includes(':extended')) continue;

        const providerId = this.extractProviderId(model.id);
        if (!groups.has(providerId)) groups.set(providerId, []);
        groups.get(providerId)!.push(model.id);

        const inputCost = parseFloat(model.pricing?.prompt);
        const outputCost = parseFloat(model.pricing?.completion);
        if (!isNaN(inputCost) && !isNaN(outputCost)) {
          this.openRouterPricing.set(model.id, { inputPerToken: inputCost, outputPerToken: outputCost });
        }

        if (typeof model.context_length === 'number' && model.context_length > 0) {
          this.contextLengths.set(model.id, model.context_length);
        }
      }

      this.openRouterGroups = Array.from(groups.entries())
        .map(([id, models]) => ({
          id,
          displayName: OPENROUTER_PROVIDER_NAMES[id] || this.formatProviderId(id),
          modelCount: models.length,
          models: models.sort(),
        }))
        .sort((a, b) => (OPENROUTER_PROVIDER_PRIORITY[a.id] || 100) - (OPENROUTER_PROVIDER_PRIORITY[b.id] || 100));

      this.openRouterFetchedAt = Date.now();
    } catch (e) {
      console.error('[ModelRegistry] Failed to fetch OpenRouter:', e);
    }
  }

  private extractProviderId(modelId: string): string {
    const idx = modelId.indexOf('/');
    return idx > 0 ? modelId.substring(0, idx) : 'other';
  }

  private formatProviderId(id: string): string {
    return id
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // === Model List Methods ===

  getModelsForProvider(provider: string): string[] {
    const models = this.getOpenRouterModelsForProvider(provider);
    if (models.length > 0) {
      return filterModelsForProvider(provider, models);
    }
    return filterModelsForProvider(provider, this.getFallbackModels(provider));
  }

  getAllModelsForProvider(provider: string): string[] {
    const models = this.getOpenRouterModelsForProvider(provider);
    return models.length > 0 ? models : this.getFallbackModels(provider);
  }

  private getOpenRouterModelsForProvider(provider: string): string[] {
    const groupId = PROVIDER_TO_OPENROUTER_GROUP[provider];
    if (!groupId) return [];

    const group = this.openRouterGroups.find(g => g.id === groupId);
    if (!group?.models.length) return [];

    const prefix = `${groupId}/`;
    return group.models.filter(m => m.startsWith(prefix)).map(m => m.slice(prefix.length));
  }

  getOpenRouterProviderGroups(): OpenRouterProviderGroup[] {
    return this.openRouterGroups;
  }

  getModelsForOpenRouterProviders(enabledIds: string[]): string[] {
    return this.openRouterGroups.filter(g => enabledIds.includes(g.id)).flatMap(g => g.models);
  }

  isValidModel(provider: string, modelName: string): boolean {
    if (provider === 'openrouter') {
      return this.openRouterGroups.some(g => g.models.includes(modelName));
    }
    const groupId = PROVIDER_TO_OPENROUTER_GROUP[provider];
    if (!groupId) return true;
    const group = this.openRouterGroups.find(g => g.id === groupId);
    if (!group) return true;
    return group.models.includes(`${groupId}/${modelName}`);
  }

  // === Pricing Methods ===

  getModelPricing(modelName: string): ModelPricing | null {
    const isFirstLookup = !this.loggedModels.has(modelName);

    // Direct lookup (OpenRouter models with '/' or exact match)
    const direct = this.openRouterPricing.get(modelName);
    if (direct) {
      if (isFirstLookup) {
        this.loggedModels.add(modelName);
        console.log(
          `[ModelRegistry] Model "${modelName}" pricing: $${(direct.inputPerToken * 1e6).toFixed(2)}/$${(direct.outputPerToken * 1e6).toFixed(2)} per 1M`,
        );
      }
      return direct;
    }

    // For direct-provider models, try adding provider prefixes
    // e.g. "gemini-3.1-flash-lite-preview" → "google/gemini-3.1-flash-lite-preview"
    for (const group of this.openRouterGroups) {
      const orKey = `${group.id}/${modelName}`;
      const pricing = this.openRouterPricing.get(orKey);
      if (pricing) {
        if (isFirstLookup) {
          this.loggedModels.add(modelName);
          console.log(
            `[ModelRegistry] Model "${modelName}" pricing: $${(pricing.inputPerToken * 1e6).toFixed(2)}/$${(pricing.outputPerToken * 1e6).toFixed(2)} per 1M (via ${orKey})`,
          );
        }
        return pricing;
      }
    }

    if (isFirstLookup) {
      this.loggedModels.add(modelName);
      console.warn(`[ModelRegistry] Model "${modelName}" pricing: unavailable`);
    }
    return null;
  }

  hasModelPricing(modelName: string): boolean {
    return this.getModelPricing(modelName) !== null;
  }

  // === Context Length Methods ===

  /** Get context length (in tokens) for a model. Returns null if unknown. */
  getModelContextLength(modelName: string): number | null {
    return this.contextLengths.get(modelName) ?? null;
  }

  // === Utility Methods ===

  private getFallbackModels(provider: string): string[] {
    return (llmProviderModelNames as Record<string, string[]>)[provider] || [];
  }

  async forceRefresh(): Promise<void> {
    this.openRouterGroups = [];
    this.openRouterPricing.clear();
    this.contextLengths.clear();
    await this.refreshFromOpenRouter();
  }

  async reinitialize(): Promise<void> {
    this.isInitialized = false;
    this.initPromise = null;
    this.openRouterGroups = [];
    this.openRouterPricing.clear();
    this.contextLengths.clear();
    this.loggedModels.clear();
    this.cacheDate = null;
    await this.initialize();
  }

  /** Check if using static bundled cache (vs live API data) */
  isUsingCachedData(): boolean {
    return !this.useLiveData;
  }

  /** Get cache generation date (only relevant when using cached data) */
  getCacheDate(): string | null {
    return this.useLiveData ? null : this.cacheDate;
  }

  getStats() {
    const formatAge = (ts: number) => {
      if (!ts) return 'never';
      const mins = Math.floor((Date.now() - ts) / 60000);
      return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
    };

    return {
      openRouter: {
        providers: this.openRouterGroups.length,
        totalModels: this.openRouterGroups.reduce((s, g) => s + g.modelCount, 0),
        age: formatAge(this.openRouterFetchedAt),
      },
      pricing: this.openRouterPricing.size,
      contextLengths: this.contextLengths.size,
    };
  }
}

// Singleton and exports
export const modelRegistry = ModelRegistry.getInstance();

export const initializeModelRegistry = () => modelRegistry.initialize();
export const getModelsForProvider = (p: string) => modelRegistry.getModelsForProvider(p);
export const getOpenRouterProviderGroups = () => modelRegistry.getOpenRouterProviderGroups();
export const getModelsForOpenRouterProviders = (ids: string[]) => modelRegistry.getModelsForOpenRouterProviders(ids);
export const getModelPricing = (model: string) => modelRegistry.getModelPricing(model);
export const hasModelPricing = (model: string) => modelRegistry.hasModelPricing(model);
export const getModelContextLength = (model: string) => modelRegistry.getModelContextLength(model);
export const getModelRegistryStats = () => modelRegistry.getStats();
export const forceRefreshModelRegistry = () => modelRegistry.forceRefresh();
export const getModelRegistryCachedCount = () => modelRegistry.getStats().openRouter.totalModels;

export type { ModelPricing as OpenRouterPricing };

// Cache status exports
export const reinitializeModelRegistry = () => modelRegistry.reinitialize();
export const isUsingCachedPricing = () => modelRegistry.isUsingCachedData();
export const getCachedPricingDate = () => modelRegistry.getCacheDate();
