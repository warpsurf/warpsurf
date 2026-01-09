/** Semantic categories for grouping actions */
export type ActionCategory =
  | 'navigation'
  | 'search'
  | 'click'
  | 'input'
  | 'scroll'
  | 'extract'
  | 'cache'
  | 'tab'
  | 'wait'
  | 'control'
  | 'complete'
  | 'system';

/** Visual display config for an action */
export interface ActionDisplay {
  icon: string;
  iconColor: { light: string; dark: string };
  categoryLabel: string;
  causesNavigation: boolean;
  priority: number;
}

/** Action mapping entry */
export interface ActionMapping {
  actionName: string;
  category: ActionCategory;
  display: ActionDisplay;
  formatLabel: (args: Record<string, unknown>, intent?: string) => string;
  extractDetails: (args: Record<string, unknown>) => { primary?: string; secondary?: string } | null;
}

/** Parsed action from trace content */
export interface ParsedAction {
  actionName: string;
  args: Record<string, unknown>;
  intent?: string;
  timestamp: number;
  url?: string;
  pageUrl?: string;
  pageTitle?: string;
  success?: boolean;
  error?: string;
}

/** Formatted action for display */
export interface DisplayAction {
  id: string;
  actionName: string;
  category: ActionCategory;
  icon: string;
  iconColor: string;
  label: string;
  details?: { primary?: string; secondary?: string };
  timestamp: number;
  success: boolean;
  collapsed?: number; // Count of collapsed similar actions
}

/** Group of actions on a single site */
export interface SiteGroup {
  id: string;
  url: string;
  domain: string;
  title: string;
  favicon: string;
  firstTimestamp: number;
  lastTimestamp: number;
  actions: DisplayAction[];
}
