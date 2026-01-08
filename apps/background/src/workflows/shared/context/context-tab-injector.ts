import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLogger } from '@src/log';
import { contextTabCache, extractTabContent, type TabContent } from './context-tab-extractor';
import {
  type ContextFormat,
  type ContextTabConfig,
  WORKFLOW_CONTEXT_CONFIG,
  WorkflowType,
} from '@extension/shared/lib/workflows/types';

const logger = createLogger('ContextTabInjector');

/**
 * Format a single tab's content for injection
 */
function formatTabContent(content: TabContent, format: ContextFormat, maxChars: number): string {
  const raw = format === 'markdown' ? content.markdown : content.domTree;
  const truncated = raw.length > maxChars ? raw.slice(0, maxChars) + '\n...[truncated]' : raw;

  return `[Tab: ${content.title}] (${content.url})\n${truncated}`;
}

/**
 * Build context tabs message for a workflow.
 * Returns null if no valid context tabs.
 */
export async function buildContextTabsMessage(
  tabIds: number[],
  workflowType: WorkflowType,
  configOverride?: Partial<ContextTabConfig>,
): Promise<HumanMessage | null> {
  if (!tabIds.length) return null;

  const config = { ...WORKFLOW_CONTEXT_CONFIG[workflowType], ...configOverride };
  const { format, maxCharsPerTab, maxTotalChars, maxTabs } = config;

  // Limit tabs
  const limitedTabIds = tabIds.slice(0, maxTabs);

  // Get content for each tab
  const contents: TabContent[] = [];
  for (const tabId of limitedTabIds) {
    let content = contextTabCache.get(tabId);
    if (!content) {
      content = await extractTabContent(tabId);
    }
    if (content) {
      contents.push(content);
    }
  }

  if (!contents.length) {
    logger.warn('No valid context tab content available');
    return null;
  }

  // Format and combine
  const parts: string[] = [];
  let totalChars = 0;

  for (const content of contents) {
    const remaining = maxTotalChars - totalChars;
    if (remaining <= 0) break;

    const perTabLimit = Math.min(maxCharsPerTab, remaining);
    const formatted = formatTabContent(content, format, perTabLimit);
    parts.push(formatted);
    totalChars += formatted.length;
  }

  const header =
    format === 'markdown'
      ? '[Reference Context - The user has provided the following tabs for reference:]'
      : '[Reference Context - Interactive elements from user-provided tabs:]';

  const fullText = `${header}\n\n${parts.join('\n\n')}`;
  logger.info(`Built context tabs message: ${contents.length} tabs, ${fullText.length} chars`);

  return new HumanMessage(fullText);
}

/**
 * Build context tabs as a SystemMessage block (for Chat/Search/Multiagent).
 */
export async function buildContextTabsSystemMessage(
  tabIds: number[],
  workflowType: WorkflowType,
): Promise<SystemMessage | null> {
  const humanMsg = await buildContextTabsMessage(tabIds, workflowType);
  if (!humanMsg) return null;

  const content = typeof humanMsg.content === 'string' ? humanMsg.content : JSON.stringify(humanMsg.content);

  return new SystemMessage(`<context_tabs>\n${content}\n</context_tabs>`);
}

// Default limits derived from WORKFLOW_CONTEXT_CONFIG (markdown workflows have smaller limits)
const DEFAULT_MAX_CHARS_PER_TAB = WORKFLOW_CONTEXT_CONFIG[WorkflowType.CHAT].maxCharsPerTab;
const DEFAULT_MAX_TOTAL_CHARS = WORKFLOW_CONTEXT_CONFIG[WorkflowType.CHAT].maxTotalChars;

/**
 * Get raw content string for a specific format (useful for building custom prompts).
 */
export async function getContextTabsContent(
  tabIds: number[],
  format: ContextFormat,
  maxCharsPerTab = DEFAULT_MAX_CHARS_PER_TAB,
  maxTotalChars = DEFAULT_MAX_TOTAL_CHARS,
): Promise<string | null> {
  if (!tabIds.length) return null;

  const parts: string[] = [];
  let totalChars = 0;

  for (const tabId of tabIds) {
    if (totalChars >= maxTotalChars) break;

    let content = contextTabCache.get(tabId);
    if (!content) {
      content = await extractTabContent(tabId);
    }
    if (!content) continue;

    const remaining = maxTotalChars - totalChars;
    const perTabLimit = Math.min(maxCharsPerTab, remaining);
    const formatted = formatTabContent(content, format, perTabLimit);
    parts.push(formatted);
    totalChars += formatted.length;
  }

  return parts.length ? parts.join('\n\n') : null;
}
