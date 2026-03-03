import { Actors } from '@extension/storage';
import { isTransientSystemMessage, sanitizeMessageContent } from './formatting';

/**
 * Normalize content for deduplication: strip leading status icons and trailing
 * punctuation/ellipsis so minor formatting differences don't create duplicates.
 */
function normalizeForDedupe(content: string): string {
  return content
    .replace(/^[✓✗]\s*/, '')
    .replace(/\.{2,}$/, '')
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSettingName(content: string): string | null {
  const normalized = normalizeForDedupe(content);
  const match = normalized.match(/^(\w+)\s+set\s+to\s+/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Comprehensive message deduplication used across session load, restore, and
 * view-state recovery paths. This is the single source of truth for removing
 * duplicate chat messages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dedupeMessages(messages: any[] | undefined | null): any[] {
  const list = Array.isArray(messages) ? messages : [];
  const WINDOW_MS = 5000;
  const seenEventIds = new Set<string>();
  const lastByActorContent = new Map<string, number>();
  const lastNonSystemByContent = new Map<string, number>();
  const systemIndexByContent = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];

  const removeSystemAt = (idx: number) => {
    out.splice(idx, 1);
    for (const [key, val] of systemIndexByContent.entries()) {
      if (val === idx) systemIndexByContent.delete(key);
      else if (val > idx) systemIndexByContent.set(key, val - 1);
    }
    for (const [key, val] of settingChanges.entries()) {
      if (val.index === idx) settingChanges.delete(key);
      else if (val.index > idx) settingChanges.set(key, { index: val.index - 1, ts: val.ts });
    }
  };

  const seenContent = new Set<string>();
  const seenActorTimestamp = new Set<string>();
  const settingChanges = new Map<string, { index: number; ts: number }>();

  for (let msg of list) {
    const actor = String((msg as any)?.actor || '');
    let content = String((msg as any)?.content ?? '').trim();

    if (isTransientSystemMessage(actor, content)) {
      continue;
    }

    const sanitized = sanitizeMessageContent(content);
    if (sanitized === null) continue;
    if (sanitized !== content) {
      msg = { ...msg, content: sanitized };
      content = sanitized;
    }

    const eventId = String((msg as any)?.eventId || '').trim();
    if (eventId) {
      if (seenEventIds.has(eventId)) continue;
      seenEventIds.add(eventId);
    }
    const isSystem = actor === Actors.SYSTEM || actor.toLowerCase() === 'system';
    const ts = Number((msg as any)?.timestamp || 0);
    if (!content) {
      out.push(msg);
      continue;
    }

    if (!isSystem && ts) {
      const atKey = `${actor}|${ts}`;
      if (seenActorTimestamp.has(atKey)) continue;
      seenActorTimestamp.add(atKey);
    }

    const normalizedContent = normalizeForDedupe(content);
    const contentKey = `${actor}|${normalizedContent}`;
    if (seenContent.has(contentKey)) {
      continue;
    }
    seenContent.add(contentKey);

    const key = `${actor}|${content}`;
    const last = lastByActorContent.get(key);
    if (last != null && (last === ts || Math.abs(ts - last) <= WINDOW_MS)) {
      continue;
    }

    if (isSystem) {
      const lastNon = lastNonSystemByContent.get(content);
      if (lastNon != null && Math.abs(ts - lastNon) <= WINDOW_MS) {
        continue;
      }
      const sysIdx = systemIndexByContent.get(content);
      if (sysIdx != null) {
        const prevTs = Number((out[sysIdx] as any)?.timestamp || 0);
        if (Math.abs(ts - prevTs) <= WINDOW_MS) continue;
      }
      systemIndexByContent.set(content, out.length);
    } else {
      const sysIdx = systemIndexByContent.get(content);
      if (sysIdx != null) {
        const prevTs = Number((out[sysIdx] as any)?.timestamp || 0);
        if (Math.abs(ts - prevTs) <= WINDOW_MS) {
          removeSystemAt(sysIdx);
        }
      }
      lastNonSystemByContent.set(content, ts);
    }

    const settingName = extractSettingName(content);
    if (settingName && actor.toLowerCase() === 'tool') {
      const prev = settingChanges.get(settingName);
      if (prev && Math.abs(ts - prev.ts) <= WINDOW_MS) {
        out.splice(prev.index, 1);
        for (const [k, val] of settingChanges.entries()) {
          if (val.index > prev.index) {
            settingChanges.set(k, { index: val.index - 1, ts: val.ts });
          }
        }
      }
      settingChanges.set(settingName, { index: out.length, ts });
    }

    lastByActorContent.set(key, ts);
    out.push(msg);
  }
  return out;
}
