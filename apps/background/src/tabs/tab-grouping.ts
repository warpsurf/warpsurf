// Shared tab grouping helpers to reduce duplication in TaskManager

export const TAB_GROUP_COLORS = [
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
  'grey',
  'black',
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
  const primary = TAB_GROUP_COLORS[workerNum % TAB_GROUP_COLORS.length];
  if (!used.has(primary)) {
    return { name: primary, hex: TAB_GROUP_COLOR_HEX[primary] };
  }
  const fallback = TAB_GROUP_COLORS.find(c => !used.has(c));
  const name = fallback ?? primary;
  return { name, hex: TAB_GROUP_COLOR_HEX[name] };
}

export function computeCrewGroupTitle(rawName: string, explicitIndex?: number): string {
  let index: number | null = null;
  if (typeof explicitIndex === 'number' && explicitIndex > 0) index = explicitIndex;
  if (index == null) {
    const m = String(rawName || '').match(/Crew\s+(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > 0) index = n;
    }
  }
  return `Crew ${index ?? 1}`;
}
