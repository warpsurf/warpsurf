/**
 * Model Registry - Dual-source model lists and pricing
 *
 * Data Sources:
 * - Helicone API: API-native model names + pricing for direct providers
 * - OpenRouter API: Comprehensive model catalog + pricing for all providers
 *
 * For direct providers (OpenAI, Anthropic, Gemini, Grok):
 *   Model names come from Helicone (API-faithful), supplemented by OpenRouter
 *   for models Helicone hasn't indexed yet. Pricing uses Helicone first,
 *   then falls back to OpenRouter with name normalization.
 *
 * When useLivePricingData=false, uses bundled cache from pricing-cache.ts
 */
import { filterModelsForProvider } from './model-filters';
import { CACHED_PRICING_DATA } from './pricing-cache';
import { llmProviderModelNames } from '@extension/storage';

interface HeliconeModel {
  model: string;
  input_cost_per_1m: number;
  output_cost_per_1m: number;
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
}

const STORAGE_KEY = 'model-registry-cache';
const CACHE_VERSION = 9; // v9: Dual-source Helicone + OpenRouter

const HELICONE_PROVIDER_MAP: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
  grok: 'x',
};

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

  // Helicone data (API-native model names + pricing for direct providers)
  private providerModels: Record<string, string[]> = {};
  private heliconePricing: Map<string, ModelPricing> = new Map();
  private heliconeFetchedAt = 0;

  // OpenRouter data (grouped models + pricing for all providers)
  private openRouterGroups: OpenRouterProviderGroup[] = [];
  private openRouterPricing: Map<string, ModelPricing> = new Map();
  private contextLengths: Map<string, number> = new Map();
  private openRouterFetchedAt = 0;

  private loggedModels: Set<string> = new Set();
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
      const hasData = this.openRouterGroups.length > 0 || Object.keys(this.providerModels).length > 0;
      if (!hasData) {
        await this.refreshAll();
        this.logSummary('Initialized (live)');
      } else {
        this.logSummary('Initialized from storage (live)');
        this.refreshAll()
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

  // === Cache Loading ===

  private loadFromStaticCache(): void {
    this.cacheDate = CACHED_PRICING_DATA.generatedAt;
    const ts = new Date(CACHED_PRICING_DATA.generatedAt).getTime();

    // Helicone data
    if (CACHED_PRICING_DATA.helicone) {
      for (const [provider, data] of Object.entries(CACHED_PRICING_DATA.helicone)) {
        this.providerModels[provider] = data.models;
        for (const [model, pricing] of Object.entries(data.pricing)) {
          this.heliconePricing.set(model, pricing);
        }
      }
      this.heliconeFetchedAt = ts;
    }

    // OpenRouter data
    this.openRouterGroups = CACHED_PRICING_DATA.openRouter.groups.map(g => ({
      id: g.id,
      displayName: g.displayName,
      modelCount: g.models.length,
      models: g.models,
    }));
    this.openRouterFetchedAt = ts;

    for (const [model, pricing] of Object.entries(CACHED_PRICING_DATA.openRouter.pricing)) {
      this.openRouterPricing.set(model, pricing);
      // Index stripped names so direct-provider lookups work without prefix iteration
      const slashIdx = model.indexOf('/');
      if (slashIdx > 0) {
        const stripped = model.substring(slashIdx + 1);
        if (!this.heliconePricing.has(stripped)) {
          this.heliconePricing.set(stripped, pricing);
        }
      }
    }
    if (CACHED_PRICING_DATA.openRouter.contextLengths) {
      for (const [model, length] of Object.entries(CACHED_PRICING_DATA.openRouter.contextLengths)) {
        this.contextLengths.set(model, length);
      }
    }
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const cached = result[STORAGE_KEY];
      if (!cached || cached.version !== CACHE_VERSION) {
        if (cached) await chrome.storage.local.remove(STORAGE_KEY);
        return;
      }

      this.providerModels = cached.providerModels || {};
      this.heliconeFetchedAt = cached.heliconeFetchedAt || 0;
      if (cached.heliconePricing) {
        this.heliconePricing = new Map(Object.entries(cached.heliconePricing));
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
          providerModels: this.providerModels,
          heliconeFetchedAt: this.heliconeFetchedAt,
          heliconePricing: Object.fromEntries(this.heliconePricing),
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

  // === Live Data Fetching ===

  private async refreshAll(): Promise<void> {
    await Promise.all([this.fetchHeliconeModels(), this.fetchOpenRouterModels()]);
    await this.saveToStorage();
  }

  private async fetchHeliconeModels(): Promise<void> {
    for (const [extensionId, heliconeApiId] of Object.entries(HELICONE_PROVIDER_MAP)) {
      try {
        const res = await fetch(`https://helicone.ai/api/llm-costs?provider=${heliconeApiId}`);
        if (!res.ok) continue;
        const data = await res.json();

        const models = [...new Set(data.data.map((m: HeliconeModel) => m.model))] as string[];
        this.providerModels[extensionId] = models;

        for (const entry of data.data as HeliconeModel[]) {
          this.heliconePricing.set(entry.model, {
            inputPerToken: entry.input_cost_per_1m / 1_000_000,
            outputPerToken: entry.output_cost_per_1m / 1_000_000,
          });
        }
      } catch (e) {
        console.warn(`[ModelRegistry] Helicone fetch failed for ${extensionId}:`, e);
      }
    }
    this.heliconeFetchedAt = Date.now();
  }

  private async fetchOpenRouterModels(): Promise<void> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      if (!res.ok) return;

      const data: OpenRouterApiResponse = await res.json();
      const groups = new Map<string, string[]>();

      for (const model of data.data) {
        if (model.id.endsWith(':free') || model.id.includes(':extended')) continue;

        const providerId = model.id.indexOf('/') > 0 ? model.id.substring(0, model.id.indexOf('/')) : 'other';
        if (!groups.has(providerId)) groups.set(providerId, []);
        groups.get(providerId)!.push(model.id);

        const inputCost = parseFloat(model.pricing?.prompt);
        const outputCost = parseFloat(model.pricing?.completion);
        if (!isNaN(inputCost) && !isNaN(outputCost)) {
          const pricing = { inputPerToken: inputCost, outputPerToken: outputCost };
          this.openRouterPricing.set(model.id, pricing);
          const stripped = model.id.substring(model.id.indexOf('/') + 1);
          if (!this.heliconePricing.has(stripped)) {
            this.heliconePricing.set(stripped, pricing);
          }
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

  private formatProviderId(id: string): string {
    return id
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // === Model List Methods ===

  /**
   * Get filtered models for a direct provider.
   * Merges Helicone (API-native names) with OpenRouter (supplementing new models).
   */
  getModelsForProvider(provider: string): string[] {
    const merged = this.getMergedModelsForProvider(provider);
    if (merged.length > 0) return filterModelsForProvider(provider, merged);
    return filterModelsForProvider(provider, this.getFallbackModels(provider));
  }

  getAllModelsForProvider(provider: string): string[] {
    const merged = this.getMergedModelsForProvider(provider);
    return merged.length > 0 ? merged : this.getFallbackModels(provider);
  }

  /**
   * Merge Helicone + OpenRouter models for a direct provider.
   * Helicone provides API-native names; OpenRouter supplements missing models
   * (converted to API-native naming where conventions differ).
   */
  private getMergedModelsForProvider(provider: string): string[] {
    const heliconeModels = this.providerModels[provider] || [];
    const orModels = this.getOpenRouterStrippedModels(provider);

    if (!heliconeModels.length) {
      return orModels.map(m => this.openRouterToNative(provider, m));
    }
    if (!orModels.length) return heliconeModels;

    const heliconeSet = new Set(heliconeModels);
    const supplement = orModels.map(m => this.openRouterToNative(provider, m)).filter(m => !heliconeSet.has(m));

    return [...heliconeModels, ...supplement];
  }

  private getOpenRouterStrippedModels(provider: string): string[] {
    const groupId = PROVIDER_TO_OPENROUTER_GROUP[provider];
    if (!groupId) return [];
    const group = this.openRouterGroups.find(g => g.id === groupId);
    if (!group?.models.length) return [];
    const prefix = `${groupId}/`;
    return group.models.filter(m => m.startsWith(prefix)).map(m => m.slice(prefix.length));
  }

  /** Convert OpenRouter naming to provider-native naming where they differ. */
  private openRouterToNative(provider: string, orName: string): string {
    if (provider === 'anthropic') {
      return orName.replace(/(\d)\.(\d)/g, '$1-$2');
    }
    return orName;
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
    const merged = this.getMergedModelsForProvider(provider);
    return merged.length === 0 || merged.includes(modelName);
  }

  // === Pricing Methods ===

  /**
   * Resolve pricing for a model. Lookup order:
   * 1. OpenRouter direct (for models with '/')
   * 2. Helicone (API-native name match)
   * 3. OpenRouter via provider prefix
   * 4. OpenRouter via normalized name (bridges naming conventions)
   */
  getModelPricing(modelName: string): ModelPricing | null {
    const isFirstLookup = !this.loggedModels.has(modelName);
    const logFound = (p: ModelPricing, via?: string) => {
      if (!isFirstLookup) return;
      this.loggedModels.add(modelName);
      const s = via ? ` (via ${via})` : '';
      console.log(
        `[ModelRegistry] "${modelName}" pricing: $${(p.inputPerToken * 1e6).toFixed(2)}/$${(p.outputPerToken * 1e6).toFixed(2)} per 1M${s}`,
      );
    };

    // OpenRouter models (have '/')
    if (modelName.includes('/')) {
      const p = this.openRouterPricing.get(modelName);
      if (p) {
        logFound(p);
        return p;
      }
    }

    // Helicone (API-native name)
    const hel = this.heliconePricing.get(modelName);
    if (hel) {
      logFound(hel, 'helicone');
      return hel;
    }

    // OpenRouter via provider prefix
    const prefixed = this.lookupWithPrefixes(modelName);
    if (prefixed) {
      logFound(prefixed.pricing, prefixed.key);
      return prefixed.pricing;
    }

    // Normalize and retry (bridges Anthropic hyphens↔dots, strips dates/latest)
    const normalized = this.normalizeForPricingLookup(modelName);
    if (normalized !== modelName) {
      const normPrefixed = this.lookupWithPrefixes(normalized);
      if (normPrefixed) {
        logFound(normPrefixed.pricing, `normalized: ${normPrefixed.key}`);
        return normPrefixed.pricing;
      }
    }

    if (isFirstLookup) {
      this.loggedModels.add(modelName);
      console.warn(`[ModelRegistry] "${modelName}" pricing: unavailable`);
    }
    return null;
  }

  private lookupWithPrefixes(name: string): { pricing: ModelPricing; key: string } | null {
    for (const group of this.openRouterGroups) {
      const orKey = `${group.id}/${name}`;
      const pricing = this.openRouterPricing.get(orKey);
      if (pricing) return { pricing, key: orKey };
    }
    return null;
  }

  private normalizeForPricingLookup(name: string): string {
    let n = name;
    n = n.replace(/-\d{4}-?\d{2}-?\d{2}$/, '');
    n = n.replace(/-latest$/, '');
    n = n.replace(/(\d)-(\d)/g, '$1.$2');
    n = n.replace(/\.0$/, '');
    return n;
  }

  hasModelPricing(modelName: string): boolean {
    return this.getModelPricing(modelName) !== null;
  }

  // === Context Length Methods ===

  getModelContextLength(modelName: string): number | null {
    return this.contextLengths.get(modelName) ?? null;
  }

  // === Utility Methods ===

  private getFallbackModels(provider: string): string[] {
    return (llmProviderModelNames as Record<string, string[]>)[provider] || [];
  }

  private logSummary(context: string): void {
    const helModels = Object.values(this.providerModels).reduce((s, m) => s + m.length, 0);
    const orModels = this.openRouterGroups.reduce((s, g) => s + g.modelCount, 0);
    console.log(
      `[ModelRegistry] ${context} — Helicone: ${helModels} models, ${this.heliconePricing.size} priced | OpenRouter: ${orModels} models, ${this.openRouterPricing.size} priced`,
    );
  }

  async forceRefresh(): Promise<void> {
    this.providerModels = {};
    this.heliconePricing.clear();
    this.openRouterGroups = [];
    this.openRouterPricing.clear();
    this.contextLengths.clear();
    await this.refreshAll();
  }

  async reinitialize(): Promise<void> {
    this.isInitialized = false;
    this.initPromise = null;
    this.providerModels = {};
    this.heliconePricing.clear();
    this.openRouterGroups = [];
    this.openRouterPricing.clear();
    this.contextLengths.clear();
    this.loggedModels.clear();
    this.cacheDate = null;
    await this.initialize();
  }

  isUsingCachedData(): boolean {
    return !this.useLiveData;
  }

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
      helicone: {
        models: Object.values(this.providerModels).reduce((s, m) => s + m.length, 0),
        pricing: this.heliconePricing.size,
        age: formatAge(this.heliconeFetchedAt),
      },
      openRouter: {
        providers: this.openRouterGroups.length,
        totalModels: this.openRouterGroups.reduce((s, g) => s + g.modelCount, 0),
        age: formatAge(this.openRouterFetchedAt),
      },
      pricing: this.heliconePricing.size + this.openRouterPricing.size,
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
  const s = modelRegistry.getStats();
  return s.helicone.models + s.openRouter.totalModels;
};

export type { ModelPricing as OpenRouterPricing };

export const reinitializeModelRegistry = () => modelRegistry.reinitialize();
export const isUsingCachedPricing = () => modelRegistry.isUsingCachedData();
export const getCachedPricingDate = () => modelRegistry.getCacheDate();
