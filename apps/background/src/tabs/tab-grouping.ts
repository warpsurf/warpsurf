// Shared tab grouping helpers to reduce duplication in TaskManager

export const TAB_GROUP_COLORS = [
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'black',
] as unknown as Array<chrome.tabGroups.Color>;

export const TAB_GROUP_COLOR_HEX: Record<string, string> = {
  grey: '#9CA3AF',
  blue: '#60A5FA',
  red: '#F87171',
  yellow: '#FBBF24',
  green: '#34D399',
  pink: '#F472B6',
  purple: '#A78BFA',
  cyan: '#22D3EE',
  orange: '#FB923C',
  black: '#000000',
};

export function chooseAvailableGroupColor(
  used: Set<chrome.tabGroups.Color>,
  workerNum: number,
): { name: chrome.tabGroups.Color; hex: string } {
  const available = TAB_GROUP_COLORS.filter(c => !used.has(c));
  const pool = available.length > 0 ? available : TAB_GROUP_COLORS;
  const name = pool[workerNum % pool.length];
  const hex = TAB_GROUP_COLOR_HEX[name];
  return { name, hex };
}

export function computeWebAgentGroupTitle(rawName: string, explicitIndex?: number): string {
  let index: number | null = null;
  if (typeof explicitIndex === 'number' && explicitIndex > 0) index = explicitIndex;
  if (index == null) {
    const m = String(rawName || '').match(/Web Agent\s+(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > 0) index = n;
    }
  }
  return `Web Agent ${index ?? 1}`;
}


