import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLogger } from '@src/log';
import { contextTabCache, extractTabContent, type TabContent } from './context-tab-extractor';
import {
  type ContextFormat,
  type ContextTabConfig,
  WORKFLOW_CONTEXT_CONFIG,
  WorkflowType,
} from '@extension/shared/lib/workflows/types';
import { wrapUntrustedContent } from '@src/workflows/shared/messages/utils';
import { calculateContextBudget, calculatePerTabLimit } from '@src/utils/context-budget';

const logger = createLogger('ContextTabInjector');

/** Escape special characters for XML attribute values */
function escapeXmlAttribute(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Format a single tab's content for injection using XML structure.
 * Content is always wrapped with untrusted content markers to prevent prompt injection.
 */
function formatTabContent(content: TabContent, format: ContextFormat, maxChars: number): string {
  const raw = format === 'markdown' ? content.markdown : content.domTree;
  const truncated = raw.length > maxChars ? raw.slice(0, maxChars) + '\n...[truncated]' : raw;

  const safeTitle = escapeXmlAttribute(content.title);
  const safeUrl = escapeXmlAttribute(content.url);

  // Always wrap content as untrusted since it comes from user-provided tabs
  const wrappedContent = truncated.trim().length > 0 ? wrapUntrustedContent(truncated) : '';

  return `<tab id="${content.tabId}" title="${safeTitle}" url="${safeUrl}">
${wrappedContent}
</tab>`;
}

/**
 * Build context tabs message for a workflow (fallback when model unknown).
 * Returns null if no valid context tabs.
 * All tab content is wrapped with untrusted content markers to prevent prompt injection.
 */
export async function buildContextTabsMessage(
  tabIds: number[],
  workflowType: WorkflowType,
  configOverride?: Partial<ContextTabConfig>,
): Promise<HumanMessage | null> {
  if (!tabIds.length) return null;

  const config = { ...WORKFLOW_CONTEXT_CONFIG[workflowType], ...configOverride };
  const { format, maxCharsPerTab, maxTotalChars, maxTabs } = config;

  const limitedTabIds = tabIds.slice(0, maxTabs);

  // Extract all tabs in parallel, preserving original order
  const contentPromises = limitedTabIds.map(async (tabId): Promise<TabContent | null> => {
    const cached = contextTabCache.get(tabId);
    if (cached) return cached;
    try {
      return await extractTabContent(tabId);
    } catch {
      return null;
    }
  });

  const results = await Promise.all(contentPromises);
  const contents = results.filter((c): c is TabContent => c !== null);

  if (!contents.length) {
    logger.warning('No valid context tab content available');
    return null;
  }

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

  const fullText = parts.join('\n\n');
  logger.info(`Built context tabs message: ${contents.length} tabs, ${fullText.length} chars`);

  return new HumanMessage(fullText);
}

/**
 * Build context tabs message with dynamic budget based on model context length.
 * Removes the maxTabs limit and calculates character budget from model capabilities.
 */
export async function buildContextTabsMessageDynamic(
  tabIds: number[],
  workflowType: WorkflowType,
  modelName: string,
): Promise<HumanMessage | null> {
  if (!tabIds.length) return null;

  const budget = calculateContextBudget(modelName);
  const format = WORKFLOW_CONTEXT_CONFIG[workflowType].format;

  // Extract all tabs in parallel, preserving original order
  const contentPromises = tabIds.map(async (tabId): Promise<TabContent | null> => {
    const cached = contextTabCache.get(tabId);
    if (cached) return cached;
    try {
      return await extractTabContent(tabId);
    } catch {
      return null;
    }
  });

  const results = await Promise.all(contentPromises);
  const contents = results.filter((c): c is TabContent => c !== null);

  if (!contents.length) {
    logger.warning('No valid context tab content available');
    return null;
  }

  // Calculate per-tab limit based on available budget
  const perTabLimit = calculatePerTabLimit(budget.availableChars, contents.length);

  const parts: string[] = [];
  let totalChars = 0;

  for (const content of contents) {
    const remaining = budget.availableChars - totalChars;
    if (remaining <= 0) break;

    const limit = Math.min(perTabLimit, remaining);
    const formatted = formatTabContent(content, format, limit);
    parts.push(formatted);
    totalChars += formatted.length;
  }

  const fullText = parts.join('\n\n');
  logger.info(
    `Built dynamic context tabs: ${contents.length} tabs, ${fullText.length}/${budget.availableChars} chars` +
      (budget.isFallback ? ' (fallback budget)' : ` (${budget.contextLength} token model)`),
  );

  return new HumanMessage(fullText);
}

/**
 * Build context tabs as a SystemMessage block (for Chat/Search/Multiagent).
 */
export async function buildContextTabsSystemMessage(
  tabIds: number[],
  workflowType: WorkflowType,
  modelName?: string,
): Promise<SystemMessage | null> {
  const humanMsg = modelName
    ? await buildContextTabsMessageDynamic(tabIds, workflowType, modelName)
    : await buildContextTabsMessage(tabIds, workflowType);
  if (!humanMsg) return null;

  const content = typeof humanMsg.content === 'string' ? humanMsg.content : JSON.stringify(humanMsg.content);

  return new SystemMessage(`<context_tabs>\n${content}\n</context_tabs>`);
}

// Default limits derived from WORKFLOW_CONTEXT_CONFIG (markdown workflows have smaller limits)
const DEFAULT_MAX_CHARS_PER_TAB = WORKFLOW_CONTEXT_CONFIG[WorkflowType.CHAT].maxCharsPerTab;
const DEFAULT_MAX_TOTAL_CHARS = WORKFLOW_CONTEXT_CONFIG[WorkflowType.CHAT].maxTotalChars;

/**
 * Get raw content string for a specific format (useful for building custom prompts).
 * All content is wrapped with untrusted markers.
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
