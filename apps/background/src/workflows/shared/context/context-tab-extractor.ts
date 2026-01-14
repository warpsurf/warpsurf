import { createLogger } from '@src/log';
import { getMarkdownContent, getClickableElements } from '@src/browser/dom/service';
import { isUrlAllowed } from '@src/browser/util';
import { firewallStore } from '@extension/storage';

const logger = createLogger('ContextTabExtractor');

export interface TabContent {
  tabId: number;
  url: string;
  title: string;
  markdown: string;
  domTree: string;
  contentHash: string;
  extractedAt: number;
}

/** Simple hash for change detection */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(content.length, 5000); i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** Session-scoped cache for extracted tab content */
class ContextTabCache {
  private cache = new Map<number, TabContent>();

  get(tabId: number): TabContent | undefined {
    return this.cache.get(tabId);
  }

  set(tabId: number, content: TabContent): void {
    this.cache.set(tabId, content);
  }

  delete(tabId: number): void {
    this.cache.delete(tabId);
  }

  clear(): void {
    this.cache.clear();
  }

  has(tabId: number): boolean {
    return this.cache.has(tabId);
  }
}

export const contextTabCache = new ContextTabCache();

/**
 * Check if a URL is allowed by the firewall settings.
 */
export async function isUrlAllowedByFirewall(url: string): Promise<boolean> {
  try {
    const firewall = await firewallStore.getFirewall();
    if (!firewall.enabled) return true;
    return isUrlAllowed(url, firewall.allowList, firewall.denyList);
  } catch {
    return true; // If firewall check fails, allow by default
  }
}

/**
 * Extract both markdown and DOM content from a tab.
 * Results are cached for reuse across workflow switches.
 * Respects firewall settings - blocked URLs return null.
 */
export async function extractTabContent(tabId: number, forceRefresh = false): Promise<TabContent | null> {
  try {
    // Check cache unless forced refresh
    if (!forceRefresh && contextTabCache.has(tabId)) {
      const cached = contextTabCache.get(tabId)!;
      // Verify tab still exists and URL unchanged
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url === cached.url) {
          logger.debug(`Using cached content for tab ${tabId}`);
          return cached;
        }
      } catch {
        contextTabCache.delete(tabId);
        return null;
      }
    }

    // Get tab info
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !tab.title) {
      logger.warning(`Tab ${tabId} has no URL or title`);
      return null;
    }

    // Check firewall settings first
    const allowed = await isUrlAllowedByFirewall(tab.url);
    if (!allowed) {
      logger.warning(`Tab ${tabId} blocked by firewall: ${tab.url}`);
      return null;
    }

    // Check for restricted URLs (additional safety check)
    const RESTRICTED = ['chrome://', 'chrome-extension://', 'about:', 'data:', 'javascript:'];
    if (RESTRICTED.some(p => tab.url!.startsWith(p))) {
      logger.warning(`Tab ${tabId} has restricted URL: ${tab.url}`);
      return null;
    }

    // Extract markdown and DOM tree in parallel for better performance
    const [markdownResult, domResult] = await Promise.allSettled([
      getMarkdownContent(tabId),
      getClickableElements(tabId, tab.url!, false, -1, 0, false),
    ]);

    let markdown = '';
    if (markdownResult.status === 'fulfilled') {
      markdown = markdownResult.value;
    } else {
      logger.warning(`Failed to extract markdown from tab ${tabId}:`, markdownResult.reason);
    }

    let domTree = '';
    if (domResult.status === 'fulfilled') {
      // Use includeAllText=true to capture full page content for context tabs
      domTree = domResult.value.elementTree.clickableElementsToString([], true);
    } else {
      logger.warning(`Failed to extract DOM from tab ${tabId}:`, domResult.reason);
    }

    if (!markdown && !domTree) {
      logger.warning(`No content extracted from tab ${tabId}`);
      return null;
    }

    const content: TabContent = {
      tabId,
      url: tab.url!,
      title: tab.title!,
      markdown,
      domTree,
      contentHash: hashContent(markdown + domTree),
      extractedAt: Date.now(),
    };

    contextTabCache.set(tabId, content);
    logger.info(`Extracted content from tab ${tabId}: ${markdown.length} chars markdown, ${domTree.length} chars DOM`);
    return content;
  } catch (e) {
    logger.error(`Failed to extract content from tab ${tabId}:`, e);
    return null;
  }
}

/**
 * Check if tab content has changed since last extraction.
 */
export async function hasTabContentChanged(tabId: number): Promise<boolean> {
  const cached = contextTabCache.get(tabId);
  if (!cached) return true;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url !== cached.url) return true;

    // Quick content check via markdown (cheaper than full DOM)
    const markdown = await getMarkdownContent(tabId).catch(() => '');
    const newHash = hashContent(markdown);
    return newHash !== cached.contentHash;
  } catch {
    return true;
  }
}

/**
 * Get cached content for a tab, extracting if not cached.
 */
export async function getTabContent(tabId: number, format: 'markdown' | 'dom'): Promise<string | null> {
  let content = contextTabCache.get(tabId);
  if (!content) {
    content = await extractTabContent(tabId);
    if (!content) return null;
  }
  return format === 'markdown' ? content.markdown : content.domTree;
}

/**
 * Extract content from multiple tabs in parallel.
 */
export async function extractMultipleTabs(tabIds: number[]): Promise<Map<number, TabContent>> {
  const results = new Map<number, TabContent>();
  const extractions = await Promise.allSettled(tabIds.map(id => extractTabContent(id)));

  for (let i = 0; i < tabIds.length; i++) {
    const result = extractions[i];
    if (result.status === 'fulfilled' && result.value) {
      results.set(tabIds[i], result.value);
    }
  }

  return results;
}
