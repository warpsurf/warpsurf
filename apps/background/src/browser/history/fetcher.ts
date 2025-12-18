import { createLogger } from '@src/log';

const logger = createLogger('HistoryFetcher');

export interface RawHistoryItem {
  url: string;
  title?: string;
  lastVisitTime?: number;
  visitCount?: number;
  typedCount?: number;
}

export interface FetchHistoryOptions {
  windowHours: number;
  maxResults?: number;
  text?: string;
}

/**
 * Fetch browser history from Chrome History API
 * 
 * @param options Fetch options (time window, filters)
 * @returns Array of raw history items
 */
export async function fetchBrowserHistory(
  options: FetchHistoryOptions
): Promise<RawHistoryItem[]> {
  const {
    windowHours,
    maxResults = 10000,
    text = '',
  } = options;

  const startTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const endTime = Date.now();

  logger.debug(`Fetching history from ${new Date(startTime).toLocaleString()} to ${new Date(endTime).toLocaleString()}`);

  try {
    const results = await chrome.history.search({
      text,
      startTime,
      endTime,
      maxResults,
    });

    logger.debug(`Fetched ${results.length} raw history items`);
    return results as RawHistoryItem[];
  } catch (error) {
    logger.error('Failed to fetch browser history:', error);
    throw new Error(`History fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

