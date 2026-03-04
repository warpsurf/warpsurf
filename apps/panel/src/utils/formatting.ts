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
  return num
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    .replace(',', '');
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
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  return `rgba(${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}, ${alpha})`;
}

export function isTransientSystemMessage(actor: string, content: string): boolean {
  const c = content.toLowerCase();
  if (c === 'showing progress...' || c === 'estimating workflow...') return true;
  if (actor.toLowerCase() !== 'system') return false;
  return c.startsWith('processing as ');
}

/**
 * Sanitizes a message's content for user-facing display. Returns `null` if the
 * message should be hidden entirely, or a rewritten string otherwise.
 *
 * Handles:
 * - Internal "Failed to invoke <model> with structured output: ..." error messages
 * - Extraction content containing untrusted_content prompt-injection fences
 * - Raw "Extraction completed successfully..." metadata headers
 */
export function sanitizeMessageContent(content: string): string | null {
  if (!content || typeof content !== 'string') return content;

  // (a) Internal model invocation errors
  if (/^Failed to invoke .+ with structured output:/i.test(content)) {
    const aborted = /abort/i.test(content);
    return aborted ? 'Model request was cancelled.' : 'Model request failed.';
  }

  // (b) Extraction content with untrusted_content fences -- hide entirely
  if (content.includes('<untrusted_content>') || content.includes('</untrusted_content>')) {
    const lengthMatch = content.match(/Length:\s*(\d+)\s*characters/i);
    const chars = lengthMatch?.[1];
    return chars ? `Page content extracted (${Number(chars).toLocaleString()} characters).` : null;
  }

  // (c) Raw extraction metadata header shown as standalone message
  if (/^Extraction completed successfully\./i.test(content)) {
    const lengthMatch = content.match(/Length:\s*(\d+)\s*characters/i);
    const chars = lengthMatch?.[1];
    return chars ? `Page content extracted (${Number(chars).toLocaleString()} characters).` : 'Page content extracted.';
  }

  return content;
}

/**
 * Heuristic check for whether a string contains markdown formatting.
 * Used to decide whether final agent output should be rendered via
 * MarkdownRenderer or as plain text.
 */
export function hasMarkdownSyntax(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return (
    /(?:^|\n)#{1,6}\s/.test(text) || // headings
    /\*\*[^*]+\*\*/.test(text) || // bold
    /(?:^|\n)\s*[-*+]\s+\S/.test(text) || // unordered list
    /(?:^|\n)\s*\d+\.\s+\S/.test(text) || // ordered list
    /\[[^\]]+\]\([^)]+\)/.test(text) || // links
    /(?:^|\n)```/.test(text) || // fenced code blocks
    /(?:^|\n)>\s+\S/.test(text) || // blockquotes
    /(?:^|\n)\|.+\|/.test(text)
  ); // tables
}

/**
 * Strips "(Crew N)" and "[workerId]" suffixes from agent status text
 * so user-visible labels stay clean.
 */
export function stripWorkerSuffix(text: string): string {
  return text
    .replace(/\s*\[[\w-]+\]\s*(?:\(Crew(?:\s+\d+)?\))?\s*$/i, '')
    .replace(/\s*\(Crew(?:\s+\d+)?\)\s*$/i, '')
    .trim();
}
