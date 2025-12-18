import { createLogger } from '@src/log';
import { HumanMessage } from '@langchain/core/messages';
import { getHistoryContext, formatHistoryContextAsMessage, isHistoryContextStale } from './history-context';
import { generalSettingsStore } from '@extension/storage/lib/settings';

const logger = createLogger('HistoryInjector');

/**
 * Get history context message if available and enabled
 * Returns a HumanMessage to inject BEFORE the user's actual task
 * 
 * @returns HumanMessage with history context, or null if disabled/unavailable
 */
export async function getHistoryContextMessage(): Promise<HumanMessage | null> {
  try {
    // Check if feature is enabled
    const settings = await generalSettingsStore.getSettings();
    if (!settings.enableHistoryContext) {
      logger.info('History context is disabled in settings');
      return null;
    }

    // Get stored context
    const context = await getHistoryContext();
    if (!context) {
      logger.info('No history context available');
      return null;
    }

    // Check if stale (older than 48 hours)
    if (isHistoryContextStale(context, 48)) {
      logger.info('History context is stale (>48h old), skipping');
      return null;
    }

    // Format and return as HumanMessage
    const contextText = formatHistoryContextAsMessage(context);
    logger.info('Injecting history context into agent messages');
    
    return new HumanMessage(contextText);
  } catch (error) {
    logger.error('Failed to get history context message:', error);
    return null;
  }
}

/**
 * Check if history context is available and enabled
 * Useful for UI indicators
 */
export async function isHistoryContextActive(): Promise<boolean> {
  try {
    const settings = await generalSettingsStore.getSettings();
    if (!settings.enableHistoryContext) {
      return false;
    }

    const context = await getHistoryContext();
    if (!context) {
      return false;
    }

    return !isHistoryContextStale(context, 48);
  } catch {
    return false;
  }
}

