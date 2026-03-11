import { SEARCH_ENGINES } from './engines';
import type { SearchEngine } from './types';

export type { SearchEngine, SerpSelectors } from './types';
export { SEARCH_ENGINES } from './engines';

export function getSearchEngine(id: string): SearchEngine {
  return SEARCH_ENGINES[id] ?? SEARCH_ENGINES.google;
}

export function getAvailableEngines(): Array<{ id: string; name: string }> {
  return Object.values(SEARCH_ENGINES).map(e => ({ id: e.id, name: e.name }));
}

export function buildSearchUrl(engine: SearchEngine, query: string): string {
  const encoded = query.trim().split(/\s+/).join('+');
  return engine.searchUrlTemplate.replace('{q}', encoded);
}

export function isSerpPage(engine: SearchEngine, url: string): boolean {
  return engine.serpPattern.test(url);
}

export function getNextSerpUrl(engine: SearchEngine, currentUrl: string): string | null {
  if (!engine.nextPageParam) return null;
  try {
    const u = new URL(currentUrl);
    if (!engine.serpPattern.test(u.href)) return null;
    const current = parseInt(u.searchParams.get(engine.nextPageParam.name) || '0', 10);
    const next = Number.isFinite(current) ? current + engine.nextPageParam.increment : engine.nextPageParam.increment;
    u.searchParams.set(engine.nextPageParam.name, String(next));
    return u.toString();
  } catch {
    return null;
  }
}
