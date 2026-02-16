/**
 * Search pattern resolver.
 *
 * Normalizes URLs and constructs direct search URLs from patterns.
 */

import { getPattern } from './search-pattern-loader';

/**
 * Normalize a URL to a canonical domain for pattern lookup.
 *
 * Strips protocol and 'www.' prefix, preserves meaningful subdomains.
 * Examples:
 *   "https://www.amazon.com/path" -> "amazon.com"
 *   "scholar.google.com" -> "scholar.google.com"
 */
export function normalizeUrlForLookup(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }

  try {
    const parsed = new URL(normalized);
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }
    return hostname;
  } catch {
    return url.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
  }
}

/** Encode search query for URL (uses + for spaces). */
function encodeSearchQuery(query: string): string {
  return encodeURIComponent(query).replace(/%20/g, '+');
}

/** Ensure URL has a protocol. */
function ensureProtocol(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'https://' + url;
  }
  return url;
}

export interface ResolvedUrl {
  url: string;
  patternApplied: boolean;
  domain: string;
}

/**
 * Resolve the final URL to navigate to.
 *
 * If searchQuery is provided and a pattern exists, constructs a direct search URL.
 * Otherwise returns the original URL with protocol.
 */
export function resolveSearchUrl(baseUrl: string, searchQuery?: string): ResolvedUrl {
  const domain = normalizeUrlForLookup(baseUrl);

  if (!searchQuery?.trim()) {
    return { url: ensureProtocol(baseUrl), patternApplied: false, domain };
  }

  const pattern = getPattern(domain);
  if (!pattern) {
    return { url: ensureProtocol(baseUrl), patternApplied: false, domain };
  }

  const encoded = encodeSearchQuery(searchQuery.trim());
  return { url: pattern.replace('{q}', encoded), patternApplied: true, domain };
}
