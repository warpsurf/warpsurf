import { createLogger } from '@src/log';

const logger = createLogger('HistoryPreprocessor');

export interface RawHistoryItem {
  url: string;
  title?: string;
  lastVisitTime?: number;
  visitCount?: number;
  typedCount?: number;
}

export interface ProcessedHistoryItem {
  url: string;
  title: string;
  visitCount: number;
  lastVisit: number;
  domain: string;
  isRelevant: boolean;
}

export interface HistoryPreprocessorOptions {
  maxItems?: number;
  filterNoise?: boolean;
  minVisitCount?: number;
}

/**
 * Noise patterns to filter out (CDNs, tracking, auto-refresh)
 */
const NOISE_PATTERNS = [
  /googleads\./,
  /doubleclick\./,
  /analytics\./,
  /facebook\.com\/tr/,
  /\.js$/,
  /\.css$/,
  /\.png$/,
  /\.jpg$/,
  /\.gif$/,
  /\.svg$/,
  /\.woff/,
  /\.ttf$/,
  /\/api\//,
  /\/ping$/,
  /\/beacon/,
  /googlesyndication/,
  /cloudfront\.net/,
  /\.json$/,
  /\.xml$/,
];

/**
 * Check if a URL is noise/irrelevant
 */
function isNoiseUrl(url: string): boolean {
  try {
    return NOISE_PATTERNS.some(pattern => pattern.test(url));
  } catch {
    return false;
  }
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Deduplicate history items by URL, aggregating visit counts
 * 
 * @param items Raw history items from chrome.history API
 * @param options Preprocessing options
 * @returns Deduplicated and enriched history items
 */
export function preprocessHistory(
  items: RawHistoryItem[],
  options: HistoryPreprocessorOptions = {}
): ProcessedHistoryItem[] {
  const {
    maxItems = 1000,
    filterNoise = true,
    minVisitCount = 1,
  } = options;

  logger.debug(`Preprocessing ${items.length} raw history items`);

  // Step 1: Deduplicate by URL and aggregate visit counts
  const urlMap = new Map<string, ProcessedHistoryItem>();

  for (const item of items) {
    if (!item.url) continue;

    // Filter noise if enabled
    if (filterNoise && isNoiseUrl(item.url)) {
      continue;
    }

    const url = item.url;
    const existing = urlMap.get(url);

    if (existing) {
      // Aggregate: increment visit count, update last visit if more recent
      existing.visitCount += (item.visitCount || 1);
      if (item.lastVisitTime && item.lastVisitTime > existing.lastVisit) {
        existing.lastVisit = item.lastVisitTime;
      }
    } else {
      // New entry
      urlMap.set(url, {
        url,
        title: item.title || 'Untitled',
        visitCount: item.visitCount || 1,
        lastVisit: item.lastVisitTime || Date.now(),
        domain: extractDomain(url),
        isRelevant: true,
      });
    }
  }

  // Step 2: Convert to array and sort by relevance
  let processed = Array.from(urlMap.values());

  // Step 3: Filter by minimum visit count
  if (minVisitCount > 1) {
    processed = processed.filter(item => item.visitCount >= minVisitCount);
  }

  // Step 4: Sort by visit count (descending) and recency
  processed.sort((a, b) => {
    // Primary: visit count
    if (b.visitCount !== a.visitCount) {
      return b.visitCount - a.visitCount;
    }
    // Secondary: recency
    return b.lastVisit - a.lastVisit;
  });

  // Step 5: Limit to maxItems
  if (processed.length > maxItems) {
    processed = processed.slice(0, maxItems);
  }

  logger.debug(`Preprocessed to ${processed.length} unique items`);
  logger.debug(`Top 5 by visit count: ${processed.slice(0, 5).map(i => `${i.domain} (${i.visitCount})`).join(', ')}`);

  return processed;
}

/**
 * Format processed history for LLM consumption
 * Returns a concise string representation
 */
export function formatHistoryForLLM(items: ProcessedHistoryItem[]): string {
  const lines = items.map((item, idx) => {
    const date = new Date(item.lastVisit).toLocaleString();
    return `${idx + 1}. [${item.visitCount} visits] ${item.title}\n   URL: ${item.url}\n   Last: ${date}\n   Domain: ${item.domain}`;
  });

  return `Recent Browser History (${items.length} unique pages):\n\n${lines.join('\n\n')}`;
}

