/**
 * Model Registry - Single source for model lists and pricing from all APIs
 *
 * Data Sources (when useLivePricingData=true):
 * - Helicone API: Models + pricing for direct providers (OpenAI, Anthropic, Google, xAI)
 * - OpenRouter API: Models + pricing for OpenRouter (provider/model format)
 *
 * When useLivePricingData=false, uses bundled cache from pricing-cache.ts
 */
import { filterModelsForProvider } from './model-filters';
import { CACHED_PRICING_DATA } from './pricing-cache';
import { llmProviderModelNames } from '@extension/storage';

interface HeliconeModel {
  provider: string;
  model: string;
  operator: 'equals' | 'includes' | 'startsWith';
  input_cost_per_1m: number;
  output_cost_per_1m: number;
  prompt_cache_read_per_1m?: number;
}

interface HeliconeApiResponse {
  metadata: { total_models: number };
  data: HeliconeModel[];
}

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
  cacheReadPerToken?: number;
}

interface CachedProviderData {
  models: string[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'model-registry-cache';
const CACHE_VERSION = 7; // v7: Added context length storage

const HELICONE_PROVIDER_MAP: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
  grok: 'x',
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
  private providerCache: Record<string, CachedProviderData> = {};
  private openRouterGroups: OpenRouterProviderGroup[] = [];

  // Pricing data from both sources
  private heliconePricing: Map<string, ModelPricing> = new Map();
  private openRouterPricing: Map<string, ModelPricing> = new Map();
  private contextLengths: Map<string, number> = new Map();
  private loggedModels: Set<string> = new Set(); // Track which models we've logged

  private openRouterFetchedAt = 0;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  // Live vs cached mode
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
    // Check user preference for live vs cached data
    await this.loadPricingModeSetting();

    if (this.useLiveData) {
      // Live mode: load from storage cache, then refresh from APIs
      await this.loadFromStorage();
      const hasCachedData = Object.keys(this.providerCache).length > 0 || this.openRouterGroups.length > 0;

      if (!hasCachedData) {
        await this.refreshAllProviders();
        this.logSummary('Initialized (live)');
      } else {
        this.logSummary('Initialized from storage (live)');
        this.refreshAllProviders()
          .then(() => this.logSummary('Refreshed (live)'))
          .catch(err => console.warn('[ModelRegistry] Background refresh failed:', err));
      }
    } else {
      // Cached mode: load from static bundled cache
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

    // Load Helicone data
    for (const [provider, data] of Object.entries(CACHED_PRICING_DATA.helicone)) {
      this.providerCache[provider] = {
        models: data.models,
        fetchedAt: new Date(CACHED_PRICING_DATA.generatedAt).getTime(),
      };
      for (const [model, pricing] of Object.entries(data.pricing)) {
        this.heliconePricing.set(model, pricing);
      }
    }

    // Load OpenRouter data
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

    // Load context lengths
    if (CACHED_PRICING_DATA.openRouter.contextLengths) {
      for (const [model, length] of Object.entries(CACHED_PRICING_DATA.openRouter.contextLengths)) {
        this.contextLengths.set(model, length);
      }
    }
  }

  private logSummary(context: string): void {
    const parts: string[] = [];
    for (const [provider, data] of Object.entries(this.providerCache)) {
      parts.push(`${provider}: ${data.models.length}`);
    }
    if (this.openRouterGroups.length > 0) {
      const orTotal = this.openRouterGroups.reduce((s, g) => s + g.modelCount, 0);
      parts.push(`openrouter: ${this.openRouterGroups.length} providers/${orTotal} models`);
    }
    const pricingCount = this.heliconePricing.size + this.openRouterPricing.size;
    console.log(`[ModelRegistry] ${context} (${parts.join(', ')}, ${pricingCount} priced)`);
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const cached = result[STORAGE_KEY];
      if (!cached || cached.version !== CACHE_VERSION) {
        if (cached) await chrome.storage.local.remove(STORAGE_KEY);
        return;
      }

      this.providerCache = cached.providerCache || {};
      this.openRouterGroups = cached.openRouterGroups || [];
      this.openRouterFetchedAt = cached.openRouterFetchedAt || 0;

      if (cached.heliconePricing) {
        this.heliconePricing = new Map(Object.entries(cached.heliconePricing));
      }
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
          providerCache: this.providerCache,
          openRouterGroups: this.openRouterGroups,
          openRouterFetchedAt: this.openRouterFetchedAt,
          heliconePricing: Object.fromEntries(this.heliconePricing),
          openRouterPricing: Object.fromEntries(this.openRouterPricing),
          contextLengths: Object.fromEntries(this.contextLengths),
        },
      });
    } catch (e) {
      console.warn('[ModelRegistry] Failed to save to storage:', e);
    }
  }

  async refreshAllProviders(): Promise<void> {
    await Promise.all([
      ...Object.keys(HELICONE_PROVIDER_MAP).map(p => this.fetchHeliconeModels(p)),
      this.fetchOpenRouterModels(),
    ]);
    await this.saveToStorage();
  }

  private async fetchHeliconeModels(extensionProvider: string): Promise<void> {
    const heliconeProvider = HELICONE_PROVIDER_MAP[extensionProvider];
    if (!heliconeProvider) return;

    try {
      const res = await fetch(`https://helicone.ai/api/llm-costs?provider=${heliconeProvider}`);
      if (!res.ok) return;

      const data: HeliconeApiResponse = await res.json();
      const models = [...new Set(data.data.map(m => m.model))];

      this.providerCache[extensionProvider] = { models, fetchedAt: Date.now() };

      // Store pricing data
      for (const entry of data.data) {
        this.heliconePricing.set(entry.model, {
          inputPerToken: entry.input_cost_per_1m / 1_000_000,
          outputPerToken: entry.output_cost_per_1m / 1_000_000,
          cacheReadPerToken: entry.prompt_cache_read_per_1m ? entry.prompt_cache_read_per_1m / 1_000_000 : undefined,
        });
      }
    } catch (e) {
      console.error(`[ModelRegistry] Failed to fetch ${extensionProvider}:`, e);
    }
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
    const cached = this.providerCache[provider];
    if (cached?.models.length) {
      if (!this.isCacheValid(cached.fetchedAt)) {
        this.fetchHeliconeModels(provider).then(() => this.saveToStorage());
      }
      return filterModelsForProvider(provider, cached.models);
    }
    return filterModelsForProvider(provider, this.getFallbackModels(provider));
  }

  getAllModelsForProvider(provider: string): string[] {
    return this.providerCache[provider]?.models || this.getFallbackModels(provider);
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
    const cached = this.providerCache[provider];
    return cached ? cached.models.includes(modelName) : true;
  }

  // === Pricing Methods ===

  /** Get pricing for any model (checks OpenRouter first for '/' models, then Helicone) */
  getModelPricing(modelName: string): ModelPricing | null {
    const isFirstLookup = !this.loggedModels.has(modelName);

    // OpenRouter models (have '/' in name)
    if (modelName.includes('/')) {
      const orPricing = this.openRouterPricing.get(modelName);
      if (orPricing) {
        if (isFirstLookup) {
          this.loggedModels.add(modelName);
          console.log(
            `[ModelRegistry] Model "${modelName}" pricing: $${(orPricing.inputPerToken * 1e6).toFixed(2)}/$${(orPricing.outputPerToken * 1e6).toFixed(2)} per 1M (OpenRouter)`,
          );
        }
        return orPricing;
      }
    }

    // Helicone direct match
    const helPricing = this.heliconePricing.get(modelName);
    if (helPricing) {
      if (isFirstLookup) {
        this.loggedModels.add(modelName);
        console.log(
          `[ModelRegistry] Model "${modelName}" pricing: $${(helPricing.inputPerToken * 1e6).toFixed(2)}/$${(helPricing.outputPerToken * 1e6).toFixed(2)} per 1M (Helicone)`,
        );
      }
      return helPricing;
    }

    // No match found
    if (isFirstLookup) {
      this.loggedModels.add(modelName);
      console.warn(`[ModelRegistry] Model "${modelName}" pricing: unavailable`);
    }
    return null;
  }

  /** Check if pricing exists for a model */
  hasModelPricing(modelName: string): boolean {
    return this.getModelPricing(modelName) !== null;
  }

  // Legacy accessor for backward compatibility
  getOpenRouterModelPricing(modelId: string): ModelPricing | null {
    return this.openRouterPricing.get(modelId) || null;
  }

  // === Context Length Methods ===

  /** Get context length (in tokens) for a model. Returns null if unknown. */
  getModelContextLength(modelName: string): number | null {
    return this.contextLengths.get(modelName) ?? null;
  }

  // === Utility Methods ===

  private isCacheValid(fetchedAt: number): boolean {
    return Date.now() - fetchedAt < CACHE_TTL_MS;
  }

  private getFallbackModels(provider: string): string[] {
    return (llmProviderModelNames as Record<string, string[]>)[provider] || [];
  }

  async forceRefresh(): Promise<void> {
    this.providerCache = {};
    this.openRouterGroups = [];
    this.heliconePricing.clear();
    this.openRouterPricing.clear();
    this.contextLengths.clear();
    await this.refreshAllProviders();
  }

  /** Reinitialize registry (call after changing useLivePricingData setting) */
  async reinitialize(): Promise<void> {
    this.isInitialized = false;
    this.initPromise = null;
    this.providerCache = {};
    this.openRouterGroups = [];
    this.heliconePricing.clear();
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

    const providers: Record<string, { count: number; age: string }> = {};
    for (const [p, d] of Object.entries(this.providerCache)) {
      providers[p] = { count: d.models.length, age: formatAge(d.fetchedAt) };
    }

    return {
      providers,
      openRouter: {
        providers: this.openRouterGroups.length,
        totalModels: this.openRouterGroups.reduce((s, g) => s + g.modelCount, 0),
        age: formatAge(this.openRouterFetchedAt),
      },
      pricing: {
        helicone: this.heliconePricing.size,
        openRouter: this.openRouterPricing.size,
      },
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
export const getModelRegistryCachedCount = () => {
  const stats = modelRegistry.getStats();
  let total = stats.openRouter.totalModels;
  for (const p of Object.values(stats.providers)) total += p.count;
  return total;
};

// Legacy export for backward compatibility
export const getOpenRouterModelPricing = (id: string) => modelRegistry.getOpenRouterModelPricing(id);
export type { ModelPricing as OpenRouterPricing }; // Alias for compatibility

// Cache status exports
export const reinitializeModelRegistry = () => modelRegistry.reinitialize();
export const isUsingCachedPricing = () => modelRegistry.isUsingCachedData();
export const getCachedPricingDate = () => modelRegistry.getCacheDate();
