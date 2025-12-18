export const formatLastActivity = (lastActivity: number | undefined): string => {
  if (!lastActivity) return 'never';
  const now = Date.now();
  const diff = now - lastActivity;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  if (seconds > 0) return `${seconds} sec${seconds > 1 ? 's' : ''} ago`;
  return 'just now';
};

export const formatTime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

export const pluralize = (count: number, singular: string, plural?: string): string => {
  return count === 1 ? singular : plural || `${singular}s`;
};

export function formatNumber(num: number): string {
  return num.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(',', '');
}

export function formatUsd(cost: number): string {
  // Handle NaN/null/undefined/negative - negative sentinel means no pricing available
  if (isNaN(cost) || cost === null || cost === undefined || cost < 0) return '—';
  const rounded = cost.toFixed(3);
  return rounded === '0.000' ? '<$0.001' : `$${rounded}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  // Handle null/undefined/NaN (NaN becomes null when JSON serialized)
  if (seconds == null || isNaN(seconds)) {
    return '—';
  }
  let rounded: number;
  if (seconds < 10) rounded = Math.round(seconds);
  else if (seconds < 60) rounded = Math.round(seconds / 5) * 5;
  else if (seconds < 300) rounded = Math.round(seconds / 15) * 15;
  else if (seconds < 1800) rounded = Math.round(seconds / 60) * 60;
  else rounded = Math.round(seconds / 300) * 300;
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const rem = rounded % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return timeStr;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${timeStr}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }
  return `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ${timeStr}`;
}

export function formatDay(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  return `rgba(${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}, ${alpha})`;
}

