import { createLogger } from '@src/log';
import type { HistorySummaryOutput } from '@src/workflows/specialized/history-summarizer/history-summarizer-workflow';

const logger = createLogger('HistoryContext');

const GLOBAL_CONTEXT_KEY = 'history_context_global';

export interface StoredHistoryContext {
  summary: HistorySummaryOutput;
  timestamp: number;
  windowHours: number;
}

/**
 * Store global history context for use by all agents
 */
export async function storeHistoryContext(
  summary: HistorySummaryOutput,
  windowHours: number
): Promise<void> {
  const context: StoredHistoryContext = {
    summary,
    timestamp: Date.now(),
    windowHours,
  };

  try {
    await chrome.storage.local.set({ [GLOBAL_CONTEXT_KEY]: context });
    logger.info('Stored global history context');
  } catch (error) {
    logger.error('Failed to store history context:', error);
    throw error;
  }
}

/**
 * Retrieve global history context
 */
export async function getHistoryContext(): Promise<StoredHistoryContext | null> {
  try {
    const result = await chrome.storage.local.get(GLOBAL_CONTEXT_KEY);
    if (result[GLOBAL_CONTEXT_KEY]) {
      logger.info('Retrieved global history context');
      return result[GLOBAL_CONTEXT_KEY] as StoredHistoryContext;
    }
    logger.info('No history context found');
    return null;
  } catch (error) {
    logger.error('Failed to retrieve history context:', error);
    return null;
  }
}

/**
 * Check if history context exists
 */
export async function hasHistoryContext(): Promise<boolean> {
  const context = await getHistoryContext();
  return context !== null;
}

/**
 * Check if history context is stale (older than threshold)
 */
export function isHistoryContextStale(
  context: StoredHistoryContext,
  maxAgeHours: number = 48
): boolean {
  const ageMs = Date.now() - context.timestamp;
  const ageHours = ageMs / (1000 * 60 * 60);
  return ageHours > maxAgeHours;
}

/**
 * Format history context as a separate user/system message
 * This will be injected WITHOUT modifying existing system prompts
 */
export function formatHistoryContextAsMessage(
  context: StoredHistoryContext
): string {
  const { summary } = context;
  
  const lines: string[] = [
    '=== BROWSING HISTORY CONTEXT ===',
    '',
    'To help you better understand my current work and interests, here is a summary of my recent browsing activity:',
    '',
    `**Summary:** ${summary.summary}`,
    '',
  ];

  if (summary.keyTopics && summary.keyTopics.length > 0) {
    lines.push(`**Key Topics:** ${summary.keyTopics.join(', ')}`, '');
  }

  if (summary.patterns && summary.patterns.trim()) {
    lines.push(`**Activity Patterns:** ${summary.patterns}`, '');
  }

  if (summary.notableUrls && summary.notableUrls.length > 0) {
    lines.push('**Notable Recent Pages:**');
    const top5 = summary.notableUrls.slice(0, 5);
    for (const item of top5) {
      lines.push(`• **${item.title}** (${item.visitCount} visits)`);
      lines.push(`  ${item.url}`);
      if (item.relevance) {
        lines.push(`  _${item.relevance}_`);
      }
    }
    lines.push('');
  }

  if (summary.categories && Object.keys(summary.categories).length > 0) {
    const sortedCategories = Object.entries(summary.categories)
      .filter(([, pct]) => pct > 5)
      .sort(([, a], [, b]) => b - a);
    
    if (sortedCategories.length > 0) {
      lines.push('**Activity Distribution:**');
      for (const [category, percentage] of sortedCategories) {
        lines.push(`• ${category}: ${percentage}%`);
      }
      lines.push('');
    }
  }

  lines.push(
    'Please use this context to better understand what I\'m working on and tailor your assistance accordingly.',
    ''
  );

  return lines.join('\n');
}

/**
 * Clear global history context
 */
export async function clearHistoryContext(): Promise<void> {
  try {
    await chrome.storage.local.remove(GLOBAL_CONTEXT_KEY);
    logger.info('Cleared global history context');
  } catch (error) {
    logger.error('Failed to clear history context:', error);
  }
}

