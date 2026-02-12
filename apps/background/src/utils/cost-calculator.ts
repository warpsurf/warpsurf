/**
 * LLM Cost Calculator
 *
 * Thin wrapper around model-registry.ts which fetches pricing from:
 * - Helicone API: Direct providers (OpenAI, Anthropic, Google, xAI)
 * - OpenRouter API: OpenRouter models (provider/model format)
 *
 * Returns -1 when pricing is unavailable (displayed as "—" in UI).
 */
import { getModelPricing, initializeModelRegistry, getModelRegistryStats } from './model-registry';

/** Initialize cost calculator (delegates to model registry) */
export const initializeCostCalculator = initializeModelRegistry;

/**
 * Calculate cost for an LLM call
 * @returns Cost in USD, or -1 if pricing unavailable
 */
export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  webSearchCount = 0,
): number {
  if (!modelName) return -1;

  const pricing = getModelPricing(modelName);
  if (!pricing) return -1;

  const inTok = Math.max(0, Number(inputTokens) || 0);
  const outTok = Math.max(0, Number(outputTokens) || 0);
  const searches = Math.max(0, Number(webSearchCount) || 0);

  const cost = inTok * pricing.inputPerToken + outTok * pricing.outputPerToken + searches * 0.01;
  return isFinite(cost) ? cost : -1;
}

/** Format cost for display. Returns "—" for unavailable pricing (-1). */
export function formatCost(cost: number, includeWebSearchNote?: boolean, webSearchCount?: number): string {
  if (!isFinite(cost) || cost < 0) return '—';
  if (cost < 0.001) return '<$0.001';

  const formatted = `$${cost.toFixed(cost < 0.01 ? 3 : 2)}`;
  if (includeWebSearchNote && webSearchCount && webSearchCount > 0) {
    return `${formatted} (incl. $${(webSearchCount * 0.01).toFixed(2)} for ${webSearchCount} searches)`;
  }
  return formatted;
}

// Re-export pricing utilities from model-registry
export { getModelPricing, hasModelPricing, isUsingCachedPricing, getCachedPricingDate } from './model-registry';

// Legacy exports for backward compatibility
export const getCachedPricingCount = () => {
  const stats = getModelRegistryStats();
  return stats.pricing.helicone + stats.pricing.openRouter;
};

export const getCachedModels = (): string[] => [];
export const getModelsWithPricing = (): string[] => [];
export const getModelsWithoutPricing = async (): Promise<string[]> => [];
