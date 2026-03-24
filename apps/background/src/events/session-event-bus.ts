import { safePostMessage } from '@extension/shared/lib/utils';

export interface Subscriber {
  id: string;
  port: chrome.runtime.Port;
  sessionId: string;
}

export class SessionEventBus {
  private subscribers = new Map<string, Subscriber>();
  private sessionIndex = new Map<string, Set<string>>();
  private eventBufferBySession = new Map<string, any[]>();
  private maxBufferSize: number;
  private legacyPort?: chrome.runtime.Port;

  constructor(maxBufferSize = 500) {
    this.maxBufferSize = Math.max(0, maxBufferSize);
  }

  setLegacyPort(port: chrome.runtime.Port | undefined): void {
    this.legacyPort = port;
  }

  subscribe(sub: Subscriber): void {
    // Unsubscribe existing subscriber with same ID to avoid duplicates
    if (this.subscribers.has(sub.id)) {
      this.unsubscribe(sub.id);
    }
    this.subscribers.set(sub.id, sub);
    const subs = this.sessionIndex.get(sub.sessionId) || new Set();
    subs.add(sub.id);
    this.sessionIndex.set(sub.sessionId, subs);
  }

  unsubscribe(subscriberId: string): void {
    const sub = this.subscribers.get(subscriberId);
    if (!sub) return;
    this.subscribers.delete(subscriberId);
    const subs = this.sessionIndex.get(sub.sessionId);
    if (subs) {
      subs.delete(subscriberId);
      if (subs.size === 0) this.sessionIndex.delete(sub.sessionId);
    }
  }

  unsubscribePort(port: chrome.runtime.Port): void {
    const toRemove: string[] = [];
    for (const [id, sub] of this.subscribers) {
      if (sub.port === port) toRemove.push(id);
    }
    for (const id of toRemove) {
      this.unsubscribe(id);
    }
  }

  publish(sessionId: string, event: any): void {
    const subs = this.sessionIndex.get(sessionId);
    if (subs && subs.size > 0) {
      for (const id of subs) {
        const sub = this.subscribers.get(id);
        if (!sub) continue;
        try {
          sub.port.postMessage(event);
        } catch {
          this.unsubscribe(id);
        }
      }
    } else if (this.legacyPort) {
      // Backward compat: forward to legacy side panel port when no subscribers
      try {
        this.legacyPort.postMessage(event);
      } catch {}
    }
  }

  hasSubscribers(sessionId: string): boolean {
    const subs = this.sessionIndex.get(sessionId);
    return !!subs && subs.size > 0;
  }

  bufferEvent(sessionId: string, event: any): void {
    if (this.maxBufferSize <= 0) return;
    const sid = String(sessionId || '');
    if (!sid) return;
    const list = this.eventBufferBySession.get(sid) || [];
    const eventId = String(event?.eventId || event?.data?.eventId || '');
    if (eventId && list.some(e => String(e?.eventId || e?.data?.eventId || '') === eventId)) {
      return;
    }
    list.push(event);
    if (list.length > this.maxBufferSize) {
      list.splice(0, list.length - this.maxBufferSize);
    }
    this.eventBufferBySession.set(sid, list);
  }

  getBufferedEvents(sessionId: string, afterEventId?: string | null): any[] {
    const sid = String(sessionId || '');
    if (!sid) return [];
    const list = this.eventBufferBySession.get(sid) || [];
    if (!afterEventId) return [...list];
    const idx = list.findIndex(e => String(e?.eventId || e?.data?.eventId || '') === String(afterEventId));
    return idx >= 0 ? list.slice(idx + 1) : [...list];
  }

  clearEventBuffer(sessionId?: string): void {
    if (!sessionId) {
      this.eventBufferBySession.clear();
      return;
    }
    this.eventBufferBySession.delete(String(sessionId));
  }
}
