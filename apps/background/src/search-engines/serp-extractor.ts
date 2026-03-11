import type { SearchEngine } from './types';
import type { Page } from 'puppeteer-core/lib/esm/puppeteer/api/Page';

export async function extractSerpResults(
  page: Page,
  engine: SearchEngine,
  maxResults: number,
): Promise<Array<{ title: string; url: string }>> {
  const { containers, resultAnchors, titleSelector } = engine.resultSelectors;
  const engineId = engine.id;

  return page.evaluate(
    (containerSels: string[], anchorSels: string[], titleSel: string | undefined, max: number, engId: string) => {
      const results: Array<{ title: string; url: string }> = [];
      const seen = new Set<string>();

      let scope: ParentNode = document.body;
      for (const sel of containerSels) {
        if (sel === 'body') break;
        const el = document.querySelector(sel);
        if (el) {
          scope = el;
          break;
        }
      }

      // Clean Google redirect URLs (e.g., /url?q=https://example.com)
      const cleanUrl = (href: string): string => {
        if (engId === 'google' && (href.startsWith('/url?') || href.includes('google.com/url?'))) {
          try {
            const u = new URL(href, location.origin);
            const q = u.searchParams.get('q');
            if (q) return q;
          } catch {}
        }
        return href;
      };

      // Filter out internal search engine links
      const isInternalLink = (url: string): boolean => {
        try {
          const host = new URL(url).hostname.toLowerCase();
          // Filter out same-domain links (internal navigation)
          if (engId === 'google' && /^([^.]+\.)?google\./i.test(host)) return true;
          if (engId === 'bing' && /^([^.]+\.)?bing\./i.test(host)) return true;
          if (engId === 'duckduckgo' && /duckduckgo\.com/i.test(host)) return true;
          if (engId === 'yahoo' && /yahoo\.com/i.test(host)) return true;
          if (engId === 'ecosia' && /ecosia\.org/i.test(host)) return true;
          if (engId === 'qwant' && /qwant\.com/i.test(host)) return true;
          if (engId === 'startpage' && /startpage\.com/i.test(host)) return true;
          if (engId === 'brave' && /brave\.com/i.test(host)) return true;
        } catch {}
        return false;
      };

      const addResult = (title: string | null, href: string | null) => {
        const t = (title || '').trim().replace(/[\t\n\r ]+/g, ' ');
        let u = (href || '').trim();
        if (!t || !u) return false;
        u = cleanUrl(u);
        if (!/^https?:/i.test(u) || seen.has(u) || isInternalLink(u)) return false;
        seen.add(u);
        results.push({ title: t, url: u });
        return true;
      };

      for (const anchorSel of anchorSels) {
        if (results.length >= max) break;
        const elements = Array.from(scope.querySelectorAll(anchorSel));
        for (const el of elements) {
          if (results.length >= max) break;
          const a = el.tagName === 'A' ? (el as HTMLAnchorElement) : el.closest('a');
          if (!a) continue;
          const titleEl = titleSel ? a.querySelector(titleSel) : null;
          const title = titleEl?.textContent || a.textContent || a.getAttribute('aria-label');
          addResult(title, a.getAttribute('href'));
        }
      }

      return results.slice(0, max);
    },
    containers,
    resultAnchors,
    titleSelector,
    Math.max(1, Math.min(20, maxResults)),
    engineId,
  );
}
