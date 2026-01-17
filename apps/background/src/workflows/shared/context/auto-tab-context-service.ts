import { createLogger } from '@src/log';
import { generalSettingsStore, warningsSettingsStore } from '@extension/storage';
import { isUrlAllowedByFirewall, extractMultipleTabs } from './context-tab-extractor';

const logger = createLogger('AutoTabContext');

const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'about:', 'data:', 'javascript:'];

/**
 * Check if a URL is restricted (chrome internal pages, etc.)
 */
function isRestrictedUrl(url: string): boolean {
  return RESTRICTED_PREFIXES.some(prefix => url.startsWith(prefix));
}

/**
 * Get tab IDs that should be automatically included as context.
 * Returns empty array if feature is disabled or privacy not accepted.
 * All valid tabs are returned - the model's context budget determines actual content limits.
 *
 * @returns Array of valid tab IDs for auto-context
 */
export async function getAutoContextTabIds(): Promise<number[]> {
  try {
    const settings = await generalSettingsStore.getSettings();
    const warnings = await warningsSettingsStore.getWarnings();

    // Check if feature is enabled and privacy accepted
    if (!settings.enableAutoTabContext || !warnings.hasAcceptedAutoTabContextPrivacyWarning) {
      return [];
    }

    // Query all tabs in current window
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const validTabIds: number[] = [];

    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;

      // Skip restricted URLs
      if (isRestrictedUrl(tab.url)) continue;

      // Check firewall
      const allowed = await isUrlAllowedByFirewall(tab.url);
      if (!allowed) {
        logger.debug(`Tab ${tab.id} blocked by firewall: ${tab.url}`);
        continue;
      }

      validTabIds.push(tab.id);
    }

    logger.info(`Auto-context: ${validTabIds.length} valid tabs of ${tabs.length} total`);
    return validTabIds;
  } catch (error) {
    logger.error('Failed to get auto-context tab IDs:', error);
    return [];
  }
}

/**
 * Pre-extract content from auto-context tabs to warm the cache.
 * Call this proactively to reduce latency when task is submitted.
 */
export async function warmAutoContextCache(): Promise<void> {
  try {
    const tabIds = await getAutoContextTabIds();
    if (tabIds.length > 0) {
      logger.info(`Warming cache for ${tabIds.length} auto-context tabs`);
      await extractMultipleTabs(tabIds);
    }
  } catch (error) {
    logger.warning('Failed to warm auto-context cache:', error);
  }
}

/**
 * Merge manually selected context tabs with auto-context tabs.
 * Deduplicates and respects the configured limits.
 *
 * @param manualTabIds - Tab IDs manually selected by the user
 * @param currentTabId - Optional current tab ID (for exclude setting)
 * @returns Merged array of unique tab IDs
 */
export async function mergeContextTabIds(manualTabIds: number[]): Promise<number[]> {
  const autoTabIds = await getAutoContextTabIds();

  if (autoTabIds.length === 0) {
    return manualTabIds;
  }

  // Merge with manual selections, avoiding duplicates
  const merged = [...new Set([...manualTabIds, ...autoTabIds])];

  logger.info(
    `Merged context tabs: ${manualTabIds.length} manual + ${autoTabIds.length} auto = ${merged.length} total`,
  );

  return merged;
}
