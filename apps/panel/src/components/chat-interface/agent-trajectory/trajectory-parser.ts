import type { TraceItem } from '../types';
import type { ParsedAction, DisplayAction, SiteGroup } from './types';
import { getActionMapping } from './action-mappings';
import { extractDomain, getFaviconUrl, generateId } from './utils';

/** Strip "(Web Agent X)" suffix from content */
const stripWorkerSuffix = (content: string): string => content.replace(/\s*\(Web Agent(?:\s+\d+)?\)\s*$/i, '').trim();

/** Extract URL from content */
const extractUrl = (content: string): string | undefined => {
  const match = content.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
  return match?.[0];
};

/** Messages to completely skip */
const SKIP_PATTERNS = [
  /^Initializing/i,
  /^Starting browser/i,
  /^Navigation done/i,
  /^Navigating\.\.\.$/i,
  /^Action (started|completed|failed)$/i,
  /^Workflow completed$/i,
  /^(Creating|Processing|Refining) plan/i,
  /^(Navigator|Planner|Validator) (started|failed)/i,
  /^Task cancelled$/i,
  /^Resumed by user$/i,
];

/** Intent patterns - describe WHAT agent wants to do (skip these, show results instead) */
const INTENT_PATTERNS = [
  /^Search(?:ing)? for /i,
  /^Click(?:ing)? (?:on |the )/i,
  /^Extract(?:ing)? (?:the|page|content)/i,
  /^Cach(?:e|ing) the /i,
  /^Navigat(?:e|ing) to /i,
  /^Open(?:ing)? (?!https?:\/\/)/i, // "Open X" but not "Opened https://..."
  /^Typ(?:e|ing) /i,
  /^Enter(?:ing)? (?:the |a |")/i,
  /^Scroll(?:ing)? /i,
  /^Wait(?:ing)? for /i,
  /^Past(?:e|ing) /i,
  /^Verify(?:ing)? /i,
  /^Renam(?:e|ing) /i,
  /^Sav(?:e|ing) /i,
  /^Submit(?:ting)? /i,
  /^Fill(?:ing)? (?:in |out |the )/i,
  /^Select(?:ing)? (?:the |a |an )/i,
  /^Download(?:ing)? /i,
  /^Upload(?:ing)? /i,
  /^Copy(?:ing)? /i,
  /^Find(?:ing)? (?:the |a |an )/i,
  /^Look(?:ing)? for /i,
  /^Check(?:ing)? /i,
  /^Read(?:ing)? the /i,
  /^Get(?:ting)? the /i,
  /^Go(?:ing)? to /i,
  /^Creat(?:e|ing) (?:a |the )/i,
  /^Add(?:ing)? (?:a |the )/i,
  /^Writ(?:e|ing) /i,
  /^Set(?:ting)? /i,
  /^Input(?:ting)? (?:the |a |")/i,
];

/** Result patterns - map content to action type */
const RESULT_PATTERNS: Array<{
  pattern: RegExp;
  action: string;
  siteUrl?: string; // Implicit site URL for this action
  extract?: (m: RegExpMatchArray, content: string) => Record<string, unknown>;
  label?: (m: RegExpMatchArray, content: string) => string;
}> = [
  // Search - sets site to google.com
  {
    pattern: /^Searched (?:for )?"?([^"]+)"?(?:\s+in Google)?$/i,
    action: 'search_google',
    siteUrl: 'https://www.google.com',
    extract: m => ({ query: m[1].trim() }),
  },
  // Navigation
  {
    pattern: /^Navigated to (.+)$/i,
    action: 'go_to_url',
    extract: (m, content) => ({ url: extractUrl(content) || m[1].trim() }),
  },
  { pattern: /^Navigated back$/i, action: 'go_back' },
  {
    pattern: /^Opened (https?:\/\/[^\s]+)/i,
    action: 'open_tab',
    extract: m => ({ url: m[1] }),
    label: m => {
      try {
        return `Opened new tab: ${new URL(m[1]).hostname.replace(/^www\./, '')}`;
      } catch {
        return 'Opened new tab';
      }
    },
  },
  // Created tab (from TAB_CREATED events)
  {
    pattern: /^Created tab (\d+)/i,
    action: 'open_tab',
    extract: m => ({ tabId: parseInt(m[1]) }),
    label: () => 'Opened new tab',
  },
  // Clicks
  {
    pattern: /^Clicked (?:button |element |link )?(?:with index )?(\d+)[:\s]*(.*)$/i,
    action: 'click_element',
    extract: m => ({ index: parseInt(m[1]), text: m[2]?.trim() }),
    label: m => (m[2]?.trim() ? `Clicked "${m[2].trim().slice(0, 50)}"` : `Clicked element [${m[1]}]`),
  },
  {
    pattern: /^Clicked "([^"]+)"$/i,
    action: 'find_and_click_text',
    extract: m => ({ text: m[1] }),
  },
  // Input - with quotes
  {
    pattern: /^(?:Entered|Typed|Input(?:ted)?) "([^"]+)"/i,
    action: 'input_text',
    extract: m => ({ text: m[1] }),
    label: m => `Entered "${m[1].slice(0, 40)}${m[1].length > 40 ? '…' : ''}"`,
  },
  // Input - without quotes (Input X into index Y) - use greedy match
  {
    pattern: /^Input(?:ted)? (.+) into (?:index |element )?(\d+)$/i,
    action: 'input_text',
    extract: m => ({ text: m[1], index: parseInt(m[2]) }),
    label: m => {
      const text = m[1].trim().replace(/\s+/g, ' ');
      return `Entered "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`;
    },
  },
  {
    pattern: /^Selected "([^"]+)"$/i,
    action: 'select_dropdown_option',
    extract: m => ({ text: m[1] }),
  },
  { pattern: /^Pressed (.+)$/i, action: 'send_keys', extract: m => ({ keys: m[1] }) },
  // Extraction
  {
    pattern: /^Extracted (\d+) (?:Google )?(?:search )?results?/i,
    action: 'extract_google_results',
    extract: m => ({ max_results: parseInt(m[1]) }),
  },
  {
    pattern: /^Extracted (\d+) chars/i,
    action: 'extract_page_markdown',
    extract: m => ({ chars: parseInt(m[1]) }),
    label: m => `Read page (${parseInt(m[1]).toLocaleString()} chars)`,
  },
  { pattern: /^(?:Read|Extracted) page content/i, action: 'extract_page_markdown' },
  { pattern: /^Scanned page/i, action: 'quick_text_scan' },
  // Cache - flexible pattern (no $ anchor for multiline)
  {
    pattern: /^Cached?\s*(?:findings|content|data)?[:\s]+/i,
    action: 'cache_content',
    extract: (_, content) => ({ content: content.replace(/^Cached?\s*(?:findings|content|data)?[:\s]+/i, '') }),
    label: (_, content) => {
      const text = content.replace(/^Cached?\s*(?:findings|content|data)?[:\s]+/i, '').trim();
      const preview = text.replace(/\s+/g, ' ').slice(0, 45);
      return `Cached: "${preview}${text.length > 45 ? '…' : ''}"`;
    },
  },
  // Scroll
  { pattern: /^Scrolled to (\d+)%/i, action: 'scroll_to_percent', extract: m => ({ yPercent: parseInt(m[1]) }) },
  { pattern: /^Scrolled to top/i, action: 'scroll_to_top' },
  { pattern: /^Scrolled to bottom/i, action: 'scroll_to_bottom' },
  { pattern: /^Scrolled (up|down)/i, action: 'next_page' },
  // Wait
  { pattern: /^(?:Waited|Wait) (?:for )?(\d+)/i, action: 'wait', extract: m => ({ seconds: parseInt(m[1]) }) },
  // Control
  { pattern: /^Request(?:ed)? (?:user )?control/i, action: 'request_user_control' },
  // Done
  {
    pattern: /^(?:Task )?[Cc]omplet(?:ed|e)[:\s]*(.*)$/i,
    action: 'done',
    extract: m => ({ text: m[1]?.trim() || 'Task completed', success: true }),
  },
  { pattern: /^Failed[:\s]+(.+)$/i, action: 'done', extract: m => ({ text: m[1], success: false }) },
  // Tab management
  { pattern: /^Switched to tab (\d+)/i, action: 'switch_tab', extract: m => ({ tab_id: parseInt(m[1]) }) },
  { pattern: /^Closed tab (\d+)/i, action: 'close_tab', extract: m => ({ tab_id: parseInt(m[1]) }) },
];

interface ParsedWithSite extends ParsedAction {
  siteUrl?: string;
}

/** Parse a single trace item */
const parseTrace = (trace: TraceItem): ParsedWithSite | null => {
  const raw = trace.content || '';
  const content = stripWorkerSuffix(raw);

  if (SKIP_PATTERNS.some(p => p.test(content))) return null;
  if (content.length < 3) return null;
  if (INTENT_PATTERNS.some(p => p.test(content))) return null;

  // Use pageUrl from trace item if available (from backend)
  const tracePageUrl = trace.pageUrl;

  for (const { pattern, action, siteUrl, extract, label } of RESULT_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      const args = extract?.(match, content) || {};
      // Priority: tracePageUrl (from backend) > siteUrl (implicit) > extracted URL > args URL
      const effectiveSiteUrl = tracePageUrl || siteUrl || extractUrl(content) || (args.url as string) || undefined;
      return {
        actionName: action,
        args,
        intent: label?.(match, content) || undefined,
        timestamp: trace.timestamp,
        url: extractUrl(content) || (args.url as string) || undefined,
        siteUrl: effectiveSiteUrl,
        pageTitle: trace.pageTitle,
        success: !content.toLowerCase().includes('failed'),
      };
    }
  }

  // Unmatched but meaningful
  if (!/^[•\-\s]+$/.test(content)) {
    return {
      actionName: 'unknown',
      args: {},
      intent: content,
      timestamp: trace.timestamp,
      url: extractUrl(content),
      siteUrl: tracePageUrl, // Use backend-provided URL
      pageTitle: trace.pageTitle,
      success: !content.toLowerCase().includes('failed'),
    };
  }

  return null;
};

/** Truncate label to single line */
const truncateLabel = (text: string, maxLen = 60): string => {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLen ? singleLine.slice(0, maxLen - 1) + '…' : singleLine;
};

/** Convert to display format */
const toDisplay = (parsed: ParsedAction, isDarkMode: boolean): DisplayAction => {
  const mapping = getActionMapping(parsed.actionName);
  const rawLabel = parsed.intent || mapping.formatLabel(parsed.args);
  return {
    id: generateId(),
    actionName: parsed.actionName,
    category: mapping.category,
    icon: mapping.display.icon,
    iconColor: isDarkMode ? mapping.display.iconColor.dark : mapping.display.iconColor.light,
    label: truncateLabel(rawLabel),
    details: mapping.extractDetails(parsed.args) || undefined,
    timestamp: parsed.timestamp,
    success: parsed.success ?? true,
  };
};

/** Collapse consecutive similar actions */
const collapseActions = <T extends ParsedAction>(actions: T[]): Array<T & { collapsedCount?: number }> => {
  const result: Array<T & { collapsedCount?: number }> = [];
  const scrollActions = ['scroll_to_percent', 'scroll_to_top', 'scroll_to_bottom', 'previous_page', 'next_page'];

  for (const action of actions) {
    const prev = result[result.length - 1];
    const shouldCollapse =
      prev &&
      ((scrollActions.includes(action.actionName) &&
        scrollActions.includes(prev.actionName) &&
        action.timestamp - prev.timestamp < 5000) ||
        (action.actionName === prev.actionName &&
          JSON.stringify(action.args) === JSON.stringify(prev.args) &&
          action.timestamp - prev.timestamp < 2000));

    if (shouldCollapse) {
      prev.collapsedCount = (prev.collapsedCount || 1) + 1;
      prev.timestamp = action.timestamp;
    } else {
      result.push({ ...action });
    }
  }
  return result;
};

/** Deduplicate intent+result pairs */
const deduplicateActions = <T extends ParsedAction>(actions: T[]): T[] => {
  const result: T[] = [];
  for (const curr of actions) {
    const prev = result[result.length - 1];
    if (prev && curr.actionName === prev.actionName && curr.timestamp - prev.timestamp < 10000) {
      if (Object.keys(curr.args).length > Object.keys(prev.args).length) {
        result[result.length - 1] = curr;
      }
      continue;
    }
    result.push(curr);
  }
  return result;
};

/** Group actions by site */
export const groupActionsBySite = (traces: TraceItem[], isDarkMode: boolean): SiteGroup[] => {
  let parsed = traces.map(parseTrace).filter((a): a is ParsedWithSite => a !== null);
  if (parsed.length === 0) return [];

  parsed = deduplicateActions(parsed);
  const collapsed = collapseActions(parsed);

  const groups: SiteGroup[] = [];
  let currentSite = '';

  for (const action of collapsed) {
    const mapping = getActionMapping(action.actionName);

    // Determine the site for this action
    // Priority: backend pageUrl > action siteUrl > navigation URL
    let actionSite = action.siteUrl || '';
    if (!actionSite && mapping.display.causesNavigation && action.url) {
      actionSite = action.url;
    }

    // Normalize to domain for comparison
    const actionDomain = actionSite ? extractDomain(actionSite) : '';
    const currentDomain = currentSite ? extractDomain(currentSite) : '';

    // Start new group if domain changed (and we have a valid new domain)
    if (actionDomain && actionDomain !== currentDomain) {
      currentSite = actionSite;
      groups.push({
        id: generateId(),
        url: actionSite,
        domain: actionDomain,
        title: action.pageTitle || '',
        favicon: getFaviconUrl(actionSite),
        firstTimestamp: action.timestamp,
        lastTimestamp: action.timestamp,
        actions: [],
      });
    }

    // Get or create current group
    let group = groups[groups.length - 1];
    if (!group) {
      // No site yet - create initial group
      const initialSite = actionSite || '';
      const initialDomain = actionDomain || 'Browser';
      currentSite = initialSite;
      group = {
        id: generateId(),
        url: initialSite,
        domain: initialDomain,
        title: action.pageTitle || '',
        favicon: initialSite ? getFaviconUrl(initialSite) : '',
        firstTimestamp: action.timestamp,
        lastTimestamp: action.timestamp,
        actions: [],
      };
      groups.push(group);
    }

    const display = toDisplay(action, isDarkMode);
    if (action.collapsedCount && action.collapsedCount > 1) {
      display.collapsed = action.collapsedCount;
    }
    group.actions.push(display);
    group.lastTimestamp = action.timestamp;
  }

  // Remove empty groups
  return groups.filter(g => g.actions.length > 0);
};

/** Flatten to simple action list */
export const flattenToActions = (traces: TraceItem[], isDarkMode: boolean): DisplayAction[] => {
  let parsed = traces.map(parseTrace).filter((a): a is ParsedWithSite => a !== null);
  parsed = deduplicateActions(parsed);
  const collapsed = collapseActions(parsed);

  return collapsed.map(p => {
    const d = toDisplay(p, isDarkMode);
    if (p.collapsedCount && p.collapsedCount > 1) d.collapsed = p.collapsedCount;
    return d;
  });
};
