/**
 * Search pattern database loader.
 *
 * Loads search URL patterns from bundled data.
 * Structured for easy extension to remote fetching later.
 */

import { SEARCH_PATTERNS } from './search-patterns';

let cachedPatterns: Record<string, string> | null = null;

/** Get the search patterns database. */
export function getSearchPatterns(): Record<string, string> {
  if (!cachedPatterns) {
    cachedPatterns = SEARCH_PATTERNS;
  }
  return cachedPatterns;
}

/** Get search URL template for a normalized domain. */
export function getPattern(normalizedDomain: string): string | undefined {
  return getSearchPatterns()[normalizedDomain];
}

/** Check if a pattern exists for a domain. */
export function hasPattern(normalizedDomain: string): boolean {
  return normalizedDomain in getSearchPatterns();
}

// ============================================================
// FUTURE: Remote fetching from GitHub
// ============================================================
// const REMOTE_URL = 'https://raw.githubusercontent.com/<org>/<repo>/main/search-patterns.json';
// const CACHE_KEY = 'search_patterns_cache';
// const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
//
// export async function refreshFromRemote(): Promise<boolean> { ... }
// export async function initializePatterns(): Promise<void> { ... }
