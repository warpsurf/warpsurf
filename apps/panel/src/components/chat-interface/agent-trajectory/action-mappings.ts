import type { ActionMapping } from './types';
import {
  FaSearch,
  FaGlobe,
  FaArrowLeft,
  FaExternalLinkAlt,
  FaExchangeAlt,
  FaTimes,
  FaMousePointer,
  FaKeyboard,
  FaListUl,
  FaArrowsAltV,
  FaArrowUp,
  FaArrowDown,
  FaFileAlt,
  FaEye,
  FaSave,
  FaClock,
  FaHandPaper,
  FaCheckCircle,
  FaBolt,
  FaAlignLeft,
} from 'react-icons/fa';
import { FiCommand } from 'react-icons/fi';

const truncate = (str: string, max: number) => (str.length <= max ? str : str.slice(0, max - 1) + '…');

const extractDomain = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/** Complete action mappings registry */
export const ACTION_MAPPINGS: Record<string, ActionMapping> = {
  // Navigation
  search_web: {
    actionName: 'search_web',
    category: 'search',
    display: {
      icon: '🔍',
      IconComponent: FaSearch,
      iconColor: { light: '#4285F4', dark: '#8AB4F8' },
      categoryLabel: 'Search',
      causesNavigation: true,
      priority: 90,
    },
    formatLabel: (args, intent) =>
      args.query ? `Searched "${truncate(String(args.query), 50)}"` : intent || 'Web search',
    extractDetails: args => ({ primary: String(args.query || '') }),
  },
  // Backwards compatibility alias
  search_google: {
    actionName: 'search_google',
    category: 'search',
    display: {
      icon: '🔍',
      IconComponent: FaSearch,
      iconColor: { light: '#4285F4', dark: '#8AB4F8' },
      categoryLabel: 'Search',
      causesNavigation: true,
      priority: 90,
    },
    formatLabel: (args, intent) =>
      args.query ? `Searched "${truncate(String(args.query), 50)}"` : intent || 'Web search',
    extractDetails: args => ({ primary: String(args.query || '') }),
  },
  go_to_url: {
    actionName: 'go_to_url',
    category: 'navigation',
    display: {
      icon: '🌐',
      IconComponent: FaGlobe,
      iconColor: { light: '#1A73E8', dark: '#8AB4F8' },
      categoryLabel: 'Navigate',
      causesNavigation: true,
      priority: 95,
    },
    formatLabel: (args, intent) =>
      intent?.trim() ||
      (extractDomain(String(args.url || '')) ? `Navigated to ${extractDomain(String(args.url))}` : 'Navigated'),
    extractDetails: args => ({ primary: String(args.url || '') }),
  },
  go_back: {
    actionName: 'go_back',
    category: 'navigation',
    display: {
      icon: '◀️',
      IconComponent: FaArrowLeft,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Navigate',
      causesNavigation: true,
      priority: 70,
    },
    formatLabel: (_, intent) => intent || 'Navigated back',
    extractDetails: () => null,
  },

  // Tab management
  open_tab: {
    actionName: 'open_tab',
    category: 'tab',
    display: {
      icon: '➕',
      IconComponent: FaExternalLinkAlt,
      iconColor: { light: '#34A853', dark: '#81C995' },
      categoryLabel: 'Tab',
      causesNavigation: true,
      priority: 85,
    },
    formatLabel: (args, intent) =>
      intent?.trim() ||
      (extractDomain(String(args.url || '')) ? `Opened tab: ${extractDomain(String(args.url))}` : 'Opened tab'),
    extractDetails: args => ({ primary: String(args.url || '') }),
  },
  switch_tab: {
    actionName: 'switch_tab',
    category: 'tab',
    display: {
      icon: '🔀',
      IconComponent: FaExchangeAlt,
      iconColor: { light: '#FBBC04', dark: '#FDD663' },
      categoryLabel: 'Tab',
      causesNavigation: false,
      priority: 60,
    },
    formatLabel: (args, intent) => intent?.trim() || `Switched to tab ${args.tab_id ?? ''}`,
    extractDetails: args => ({ primary: `Tab ${args.tab_id}` }),
  },
  close_tab: {
    actionName: 'close_tab',
    category: 'tab',
    display: {
      icon: '✖️',
      IconComponent: FaTimes,
      iconColor: { light: '#EA4335', dark: '#F28B82' },
      categoryLabel: 'Tab',
      causesNavigation: false,
      priority: 50,
    },
    formatLabel: (args, intent) => intent?.trim() || `Closed tab ${args.tab_id ?? ''}`,
    extractDetails: args => ({ primary: `Tab ${args.tab_id}` }),
  },

  // Click actions
  click_element: {
    actionName: 'click_element',
    category: 'click',
    display: {
      icon: '👆',
      IconComponent: FaMousePointer,
      iconColor: { light: '#E37400', dark: '#FBBC04' },
      categoryLabel: 'Click',
      causesNavigation: false,
      priority: 80,
    },
    formatLabel: (args, intent) => intent?.trim() || `Clicked element [${args.index}]`,
    extractDetails: args => ({ secondary: `Index: ${args.index}` }),
  },
  click_selector: {
    actionName: 'click_selector',
    category: 'click',
    display: {
      icon: '👆',
      IconComponent: FaMousePointer,
      iconColor: { light: '#E37400', dark: '#FBBC04' },
      categoryLabel: 'Click',
      causesNavigation: false,
      priority: 80,
    },
    formatLabel: (args, intent) => intent?.trim() || `Clicked "${truncate(String(args.selector || ''), 30)}"`,
    extractDetails: args => ({ primary: String(args.selector || '') }),
  },
  find_and_click_text: {
    actionName: 'find_and_click_text',
    category: 'click',
    display: {
      icon: '👆',
      IconComponent: FaMousePointer,
      iconColor: { light: '#E37400', dark: '#FBBC04' },
      categoryLabel: 'Click',
      causesNavigation: false,
      priority: 80,
    },
    formatLabel: (args, intent) => intent?.trim() || `Clicked "${truncate(String(args.text || ''), 30)}"`,
    extractDetails: args => ({ primary: String(args.text || '') }),
  },

  // Input actions
  input_text: {
    actionName: 'input_text',
    category: 'input',
    display: {
      icon: '✏️',
      IconComponent: FaKeyboard,
      iconColor: { light: '#185ABC', dark: '#8AB4F8' },
      categoryLabel: 'Input',
      causesNavigation: false,
      priority: 85,
    },
    formatLabel: (args, intent) => intent?.trim() || `Entered "${truncate(String(args.text || ''), 40)}"`,
    extractDetails: args => ({ primary: String(args.text || '') }),
  },
  send_keys: {
    actionName: 'send_keys',
    category: 'input',
    display: {
      icon: '⌨️',
      IconComponent: FiCommand,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Keyboard',
      causesNavigation: false,
      priority: 70,
    },
    formatLabel: (args, intent) => intent?.trim() || `Pressed ${args.keys}`,
    extractDetails: args => ({ primary: String(args.keys || '') }),
  },
  select_dropdown_option: {
    actionName: 'select_dropdown_option',
    category: 'input',
    display: {
      icon: '📋',
      IconComponent: FaListUl,
      iconColor: { light: '#1A73E8', dark: '#8AB4F8' },
      categoryLabel: 'Select',
      causesNavigation: false,
      priority: 75,
    },
    formatLabel: (args, intent) => intent?.trim() || `Selected "${truncate(String(args.text || ''), 30)}"`,
    extractDetails: args => ({ primary: String(args.text || '') }),
  },
  get_dropdown_options: {
    actionName: 'get_dropdown_options',
    category: 'input',
    display: {
      icon: '📋',
      IconComponent: FaListUl,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Inspect',
      causesNavigation: false,
      priority: 40,
    },
    formatLabel: (_, intent) => intent || 'Retrieved dropdown options',
    extractDetails: () => null,
  },

  // Scroll actions
  scroll_to_percent: {
    actionName: 'scroll_to_percent',
    category: 'scroll',
    display: {
      icon: '↕️',
      IconComponent: FaArrowsAltV,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Scroll',
      causesNavigation: false,
      priority: 30,
    },
    formatLabel: (args, intent) =>
      intent?.trim() ||
      (args.yPercent === 0
        ? 'Scrolled to top'
        : args.yPercent === 100
          ? 'Scrolled to bottom'
          : `Scrolled to ${args.yPercent}%`),
    extractDetails: args => ({ primary: `${args.yPercent}%` }),
  },
  scroll_to_top: {
    actionName: 'scroll_to_top',
    category: 'scroll',
    display: {
      icon: '⬆️',
      IconComponent: FaArrowUp,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Scroll',
      causesNavigation: false,
      priority: 30,
    },
    formatLabel: (_, intent) => intent || 'Scrolled to top',
    extractDetails: () => null,
  },
  scroll_to_bottom: {
    actionName: 'scroll_to_bottom',
    category: 'scroll',
    display: {
      icon: '⬇️',
      IconComponent: FaArrowDown,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Scroll',
      causesNavigation: false,
      priority: 30,
    },
    formatLabel: (_, intent) => intent || 'Scrolled to bottom',
    extractDetails: () => null,
  },
  scroll_to_text: {
    actionName: 'scroll_to_text',
    category: 'scroll',
    display: {
      icon: '🔎',
      IconComponent: FaSearch,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Scroll',
      causesNavigation: false,
      priority: 35,
    },
    formatLabel: (args, intent) => intent?.trim() || `Scrolled to "${truncate(String(args.text || ''), 30)}"`,
    extractDetails: args => ({ primary: String(args.text || '') }),
  },
  scroll_to_selector: {
    actionName: 'scroll_to_selector',
    category: 'scroll',
    display: {
      icon: '🎯',
      IconComponent: FaArrowsAltV,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Scroll',
      causesNavigation: false,
      priority: 35,
    },
    formatLabel: (args, intent) => intent?.trim() || `Scrolled to ${truncate(String(args.selector || ''), 25)}`,
    extractDetails: args => ({ primary: String(args.selector || '') }),
  },
  previous_page: {
    actionName: 'previous_page',
    category: 'scroll',
    display: {
      icon: '⏫',
      IconComponent: FaArrowUp,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Scroll',
      causesNavigation: false,
      priority: 25,
    },
    formatLabel: (_, intent) => intent || 'Scrolled up',
    extractDetails: () => null,
  },
  next_page: {
    actionName: 'next_page',
    category: 'scroll',
    display: {
      icon: '⏬',
      IconComponent: FaArrowDown,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Scroll',
      causesNavigation: false,
      priority: 25,
    },
    formatLabel: (_, intent) => intent || 'Scrolled down',
    extractDetails: () => null,
  },

  // Extraction actions
  extract_search_results: {
    actionName: 'extract_search_results',
    category: 'extract',
    display: {
      icon: '📜',
      IconComponent: FaAlignLeft,
      iconColor: { light: '#34A853', dark: '#81C995' },
      categoryLabel: 'Extract',
      causesNavigation: false,
      priority: 75,
    },
    formatLabel: (args, intent) => intent?.trim() || `Extracted ${args.max_results || 10} search results`,
    extractDetails: args => ({ primary: `${args.max_results || 10} results` }),
  },
  // Backwards compatibility alias
  extract_google_results: {
    actionName: 'extract_google_results',
    category: 'extract',
    display: {
      icon: '📜',
      IconComponent: FaAlignLeft,
      iconColor: { light: '#34A853', dark: '#81C995' },
      categoryLabel: 'Extract',
      causesNavigation: false,
      priority: 75,
    },
    formatLabel: (args, intent) => intent?.trim() || `Extracted ${args.max_results || 10} search results`,
    extractDetails: args => ({ primary: `${args.max_results || 10} results` }),
  },
  extract_page_markdown: {
    actionName: 'extract_page_markdown',
    category: 'extract',
    display: {
      icon: '📄',
      IconComponent: FaFileAlt,
      iconColor: { light: '#1A73E8', dark: '#8AB4F8' },
      categoryLabel: 'Read',
      causesNavigation: false,
      priority: 70,
    },
    formatLabel: (args, intent) => intent?.trim() || `Read page content`,
    extractDetails: args => ({ primary: args.selector ? `Selector: ${args.selector}` : 'Full page' }),
  },
  quick_text_scan: {
    actionName: 'quick_text_scan',
    category: 'extract',
    display: {
      icon: '👁️',
      IconComponent: FaEye,
      iconColor: { light: '#5F6368', dark: '#9AA0A6' },
      categoryLabel: 'Scan',
      causesNavigation: false,
      priority: 45,
    },
    formatLabel: (_, intent) => intent || 'Scanned page',
    extractDetails: () => null,
  },

  // Cache
  cache_content: {
    actionName: 'cache_content',
    category: 'cache',
    display: {
      icon: '💾',
      IconComponent: FaSave,
      iconColor: { light: '#9334E6', dark: '#C58AF9' },
      categoryLabel: 'Cache',
      causesNavigation: false,
      priority: 65,
    },
    formatLabel: (args, intent) => intent?.trim() || `Cached: "${truncate(String(args.content || ''), 40)}"`,
    extractDetails: args => ({ primary: truncate(String(args.content || ''), 100) }),
  },

  // Control
  wait: {
    actionName: 'wait',
    category: 'wait',
    display: {
      icon: '⏳',
      IconComponent: FaClock,
      iconColor: { light: '#FBBC04', dark: '#FDD663' },
      categoryLabel: 'Wait',
      causesNavigation: false,
      priority: 20,
    },
    formatLabel: (args, intent) => intent?.trim() || `Waited ${args.seconds || 3}s`,
    extractDetails: args => ({ primary: `${args.seconds || 3} seconds` }),
  },
  request_user_control: {
    actionName: 'request_user_control',
    category: 'control',
    display: {
      icon: '🖐️',
      IconComponent: FaHandPaper,
      iconColor: { light: '#EA4335', dark: '#F28B82' },
      categoryLabel: 'Handoff',
      causesNavigation: false,
      priority: 100,
    },
    formatLabel: (args, intent) =>
      intent?.trim() || `Requested control: ${truncate(String(args.reason || 'User input needed'), 50)}`,
    extractDetails: args => ({ primary: String(args.reason || '') }),
  },
  done: {
    actionName: 'done',
    category: 'complete',
    display: {
      icon: '✅',
      IconComponent: FaCheckCircle,
      iconColor: { light: '#34A853', dark: '#81C995' },
      categoryLabel: 'Complete',
      causesNavigation: false,
      priority: 100,
    },
    formatLabel: args => {
      const text = truncate(String(args.text || 'Task completed'), 60);
      return args.success !== false ? `Completed: ${text}` : `Failed: ${text}`;
    },
    extractDetails: args => ({ primary: String(args.text || '') }),
  },
};

const UNKNOWN_MAPPING: ActionMapping = {
  actionName: 'unknown',
  category: 'system',
  display: {
    icon: '⚡',
    IconComponent: FaBolt,
    iconColor: { light: '#5F6368', dark: '#9AA0A6' },
    categoryLabel: 'Action',
    causesNavigation: false,
    priority: 10,
  },
  formatLabel: (_, intent) => intent || 'Action performed',
  extractDetails: () => null,
};

export const getActionMapping = (name: string): ActionMapping => ACTION_MAPPINGS[name] || UNKNOWN_MAPPING;
