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

export function formatUsd(cost: number): string {
  if (isNaN(cost) || cost === null || cost === undefined || cost < 0) return '—';
  const rounded = cost.toFixed(3);
  return rounded === '0.000' ? '<$0.001' : `$${rounded}`;
}

export function sanitizeMessageContent(content: string): string | null {
  if (!content || typeof content !== 'string') return content;
  if (/^Failed to invoke .+ with structured output:/i.test(content)) {
    return /abort/i.test(content) ? 'Model request was cancelled.' : 'Model request failed.';
  }
  if (content.includes('<untrusted_content>') || content.includes('</untrusted_content>')) {
    const chars = content.match(/Length:\s*(\d+)\s*characters/i)?.[1];
    return chars ? `Page content extracted (${Number(chars).toLocaleString()} characters).` : null;
  }
  if (/^Extraction completed successfully\./i.test(content)) {
    const chars = content.match(/Length:\s*(\d+)\s*characters/i)?.[1];
    return chars ? `Page content extracted (${Number(chars).toLocaleString()} characters).` : 'Page content extracted.';
  }
  return content;
}

export function hasMarkdownSyntax(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return (
    /(?:^|\n)#{1,6}\s/.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /(?:^|\n)\s*[-*+]\s+\S/.test(text) ||
    /(?:^|\n)\s*\d+\.\s+\S/.test(text) ||
    /\[[^\]]+\]\([^)]+\)/.test(text) ||
    /(?:^|\n)```/.test(text) ||
    /(?:^|\n)>\s+\S/.test(text) ||
    /(?:^|\n)\|.+\|/.test(text)
  );
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  return `rgba(${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}, ${alpha})`;
}

export function stripWorkerSuffix(text: string): string {
  return text
    .replace(/\s*\[[\w-]+\]\s*(?:\(Crew(?:\s+\d+)?\))?\s*$/i, '')
    .replace(/\s*\(Crew(?:\s+\d+)?\)\s*$/i, '')
    .trim();
}

export function isTransientSystemMessage(actor: string, content: string): boolean {
  const c = content.toLowerCase();
  if (c === 'showing progress...' || c === 'estimating workflow...') return true;
  if (actor.toLowerCase() !== 'system') return false;
  return c.startsWith('processing as ');
}
