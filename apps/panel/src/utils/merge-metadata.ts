/**
 * Merges stored metadata with live metadata (from trajectory_state).
 * Storage data is used as the base; live trace items are deduped and appended.
 * This is order-independent — produces the same result regardless of which
 * data source arrives first.
 */
export function mergeMetadata(stored: Record<string, any>, live: Record<string, any>): Record<string, any> {
  const merged: any = { ...stored };
  for (const [key, val] of Object.entries(live)) {
    if (!val || typeof val !== 'object') continue;
    const existing = merged[key];
    if (existing && typeof existing === 'object' && Array.isArray((val as any).traceItems)) {
      const storedItems: any[] = existing.traceItems || [];
      const liveItems: any[] = (val as any).traceItems || [];
      const storedIds = new Set(storedItems.map((t: any) => String(t?.eventId || '')).filter(Boolean));
      const newItems = liveItems.filter((t: any) => {
        const eid = String(t?.eventId || '');
        return eid
          ? !storedIds.has(eid)
          : !storedItems.some((s: any) => s.timestamp === t.timestamp && s.actor === t.actor);
      });
      merged[key] = {
        ...existing,
        ...(val as any),
        traceItems: [...storedItems, ...newItems].sort((a: any, b: any) => a.timestamp - b.timestamp),
      };
    } else if (!existing) {
      merged[key] = val;
    }
  }
  return merged;
}
