/**
 Uses crude latency estimations
 */

import { LATENCY_DATABASE, DEFAULT_LATENCY, type LatencyEntry } from './latency-database';

export interface ModelLatencyMetrics {
  timeToFirstAnswerToken: number;  // seconds - primary metric for reasoning models
  timeToFirstToken: number;        // seconds - time to first token
  outputTokensPerSecond: number;   // tokens/sec - output generation speed
  isEstimated: boolean;            // true if using default values
}

// Cache for resolved model lookups
const resolvedCache: Map<string, LatencyEntry | null> = new Map();

/**
 * Normalize model names for consistent matching
 */
function normalizeModelName(modelName: string): string {
  return modelName.toLowerCase()
    .replace(/^(openai\/|anthropic\/|google\/|meta\/|mistral\/|xai\/|vercel\/|perplexity\/)/, '')
    .replace(/\s+/g, '-')
    .replace(/[()]/g, '')
    .replace(/[-_]+/g, '-')
    .trim();
}

/**
 * Find matching entry in the latency database
 */
function findMatchingEntry(modelName: string): LatencyEntry | null {
  // Check cache first
  if (resolvedCache.has(modelName)) {
    return resolvedCache.get(modelName) ?? null;
  }

  const normalized = normalizeModelName(modelName);
  const dbKeys = Object.keys(LATENCY_DATABASE);

  // Try exact match first
  for (const key of dbKeys) {
    if (normalizeModelName(key) === normalized) {
      resolvedCache.set(modelName, LATENCY_DATABASE[key]);
      return LATENCY_DATABASE[key];
    }
  }

  // Try fuzzy match: user model contains DB key
  for (const key of dbKeys) {
    const normalizedKey = normalizeModelName(key);
    if (normalized.includes(normalizedKey) || normalizedKey.includes(normalized)) {
      resolvedCache.set(modelName, LATENCY_DATABASE[key]);
      return LATENCY_DATABASE[key];
    }
  }

  // No match found
  resolvedCache.set(modelName, null);
  return null;
}

/**
 * Get latency metrics for a model
 * Returns real data if available, otherwise returns default estimates
 */
export function getModelLatency(modelName: string): ModelLatencyMetrics {
  const entry = findMatchingEntry(modelName);
  
  if (entry) {
    return {
      timeToFirstAnswerToken: entry.ttfa ?? DEFAULT_LATENCY.ttfa,
      timeToFirstToken: entry.ttft ?? DEFAULT_LATENCY.ttft,
      outputTokensPerSecond: entry.tps ?? DEFAULT_LATENCY.tps,
      isEstimated: false,
    };
  }

  return {
    timeToFirstAnswerToken: DEFAULT_LATENCY.ttfa,
    timeToFirstToken: DEFAULT_LATENCY.ttft,
    outputTokensPerSecond: DEFAULT_LATENCY.tps,
    isEstimated: true,
  };
}

/**
 * Check if a model has real latency data (not estimated)
 */
export function hasLatencyData(modelName: string): boolean {
  return findMatchingEntry(modelName) !== null;
}

/**
 * Initialize the latency calculator (no-op, kept for backward compatibility)
 */
export async function initializeLatencyCalculator(): Promise<void> {
  console.log(`[LatencyCalculator] Initialized (${Object.keys(LATENCY_DATABASE).length} models in database)`);
}

/**
 * Get all models in the database (for debugging)
 */
export function getCachedLatencyModels(): string[] {
  return Object.keys(LATENCY_DATABASE);
}

/**
 * Get all models that have real latency data
 */
export function getModelsWithLatencyData(): string[] {
  return Object.keys(LATENCY_DATABASE);
}

/**
 * Get summary statistics about the latency database
 */
export function getLatencySummaryStats(): {
  totalCached: number;
  withTTFA: number;
  withTTFT: number;
  withOutputSpeed: number;
  defaultTTFA: number;
  defaultTTFT: number;
  defaultTPS: number;
} {
  const entries = Object.values(LATENCY_DATABASE);
  return {
    totalCached: entries.length,
    withTTFA: entries.filter(e => e.ttfa !== undefined).length,
    withTTFT: entries.filter(e => e.ttft !== undefined).length,
    withOutputSpeed: entries.filter(e => e.tps !== undefined).length,
    defaultTTFA: DEFAULT_LATENCY.ttfa,
    defaultTTFT: DEFAULT_LATENCY.ttft,
    defaultTPS: DEFAULT_LATENCY.tps,
  };
}

/**
 * Get count of models in database
 */
export function getCachedLatencyCount(): number {
  return Object.keys(LATENCY_DATABASE).length;
}

// Deprecated: kept for backward compatibility
export async function getModelsWithoutLatencyData(): Promise<string[]> {
  return [];
}
