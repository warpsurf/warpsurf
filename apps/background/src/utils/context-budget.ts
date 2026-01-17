/**
 * Context Budget Calculator
 *
 * Calculates available token/character budgets for context tabs based on model limits.
 * Isolated module for dynamic context extraction sizing.
 */
import { getModelContextLength } from './model-registry';

/** Default context length when model info unavailable */
const DEFAULT_CONTEXT_LENGTH = 128_000;

/** Minimum context length to prevent unusable budgets */
const MIN_CONTEXT_LENGTH = 8_000;

/** Estimated characters per token (conservative) */
const CHARS_PER_TOKEN = 3.5;

/** Reserved tokens for system prompt and base overhead */
const SYSTEM_PROMPT_RESERVE = 8_000;

/** Reserved tokens for expected output */
const OUTPUT_RESERVE = 16_000;

/** Safety margin for conversation history, tool calls, etc. */
const SAFETY_MARGIN = 8_000;

/** Maps direct provider names to OpenRouter provider prefixes */
const PROVIDER_PREFIX_MAP: Record<string, string> = {
  gemini: 'google',
  grok: 'x-ai',
};

/** Overhead per tab for XML wrapper (approximate) */
const PER_TAB_OVERHEAD_CHARS = 150;

export interface ContextBudget {
  /** Model's total context window in tokens */
  contextLength: number;
  /** Tokens available for context tabs */
  availableTokens: number;
  /** Character budget for context tabs */
  availableChars: number;
  /** Whether using fallback (model not found) */
  isFallback: boolean;
}

/**
 * Normalize a direct provider model name to OpenRouter format.
 * Handles naming differences between direct providers and OpenRouter.
 */
function normalizeModelName(modelName: string): string {
  // Claude models: convert "3-5" to "3.5" and strip date suffix
  // e.g., "claude-3-5-sonnet-20241022" → "claude-3.5-sonnet"
  if (modelName.startsWith('claude-')) {
    let normalized = modelName
      .replace(/(\d)-(\d)/g, '$1.$2') // "3-5" → "3.5"
      .replace(/-\d{8}$/, ''); // Remove date suffix like "-20241022"
    return normalized;
  }
  return modelName;
}

/**
 * Generate possible OpenRouter model IDs for a direct provider model.
 * Returns multiple candidates to try in order of specificity.
 */
function getOpenRouterCandidates(modelName: string, provider?: string): string[] {
  if (modelName.includes('/')) return [modelName]; // Already OpenRouter format

  // Infer provider from model name patterns
  const inferredProvider =
    provider ||
    (modelName.startsWith('gpt-') ||
    modelName.startsWith('o1') ||
    modelName.startsWith('o3') ||
    modelName.startsWith('chatgpt')
      ? 'openai'
      : modelName.startsWith('claude')
        ? 'anthropic'
        : modelName.startsWith('gemini')
          ? 'google'
          : modelName.startsWith('grok')
            ? 'x-ai'
            : null);

  if (!inferredProvider) return [];

  const prefix = PROVIDER_PREFIX_MAP[inferredProvider] || inferredProvider;
  const normalized = normalizeModelName(modelName);

  const candidates: string[] = [];

  // Try exact match first
  candidates.push(`${prefix}/${modelName}`);

  // Try normalized version if different
  if (normalized !== modelName) {
    candidates.push(`${prefix}/${normalized}`);
  }

  // Try without version date (e.g., "gpt-4o-2024-11-20" → "gpt-4o")
  const withoutDate = modelName.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (withoutDate !== modelName) {
    candidates.push(`${prefix}/${withoutDate}`);
  }

  return [...new Set(candidates)]; // Remove duplicates
}

/**
 * Get context length for a model from OpenRouter data.
 * Works for both OpenRouter models (provider/model) and direct provider models.
 */
export function getContextLengthForModel(modelName: string, provider?: string): number {
  // Direct lookup (works for OpenRouter models)
  const directLength = getModelContextLength(modelName);
  if (directLength) return directLength;

  // Try candidate OpenRouter model IDs
  for (const candidate of getOpenRouterCandidates(modelName, provider)) {
    if (candidate !== modelName) {
      const length = getModelContextLength(candidate);
      if (length) return length;
    }
  }

  return DEFAULT_CONTEXT_LENGTH;
}

/**
 * Calculate available context budget for a model.
 */
export function calculateContextBudget(modelName: string, provider?: string): ContextBudget {
  const contextLength = getContextLengthForModel(modelName, provider);
  const effectiveLength = Math.max(contextLength, MIN_CONTEXT_LENGTH);

  const reservedTokens = SYSTEM_PROMPT_RESERVE + OUTPUT_RESERVE + SAFETY_MARGIN;
  const availableTokens = Math.max(0, effectiveLength - reservedTokens);
  const availableChars = Math.floor(availableTokens * CHARS_PER_TOKEN);

  // Using fallback if we ended up with the default
  const isFallback = contextLength === DEFAULT_CONTEXT_LENGTH;

  return {
    contextLength: effectiveLength,
    availableTokens,
    availableChars,
    isFallback,
  };
}

/**
 * Calculate per-tab character limits given total budget and tab count.
 * Distributes budget evenly across tabs, accounting for XML wrapper overhead.
 */
export function calculatePerTabLimit(totalChars: number, tabCount: number): number {
  if (tabCount <= 0) return 0;
  // Account for per-tab XML wrapper overhead
  const effectiveBudget = Math.max(0, totalChars - tabCount * PER_TAB_OVERHEAD_CHARS);
  return Math.floor(effectiveBudget / tabCount);
}
