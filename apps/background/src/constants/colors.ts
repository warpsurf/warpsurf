/**
 * Tab group colors for multi-agent visualization
 */
export const TAB_GROUP_COLORS = [
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'
] as const;

export type TabGroupColor = typeof TAB_GROUP_COLORS[number];

/**
 * Hex color codes for tab groups
 */
export const TAB_GROUP_COLOR_HEX: Record<TabGroupColor, string> = {
  grey: '#9CA3AF',
  blue: '#60A5FA',
  red: '#F87171',
  yellow: '#FBBF24',
  green: '#34D399',
  pink: '#F472B6',
  purple: '#A78BFA',
  cyan: '#22D3EE',
  orange: '#FB923C',
};

/**
 * Default color for workflow graph lanes
 */
export const DEFAULT_LANE_COLOR = '#A78BFA'; // purple

