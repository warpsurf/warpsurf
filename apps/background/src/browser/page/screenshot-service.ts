import type { PuppeteerAdapter } from './puppeteer-adapter';
import type { PageState, BrowserContextConfig } from '../views';
import { createLogger } from '@src/log';

const logger = createLogger('ScreenshotService');

export class ScreenshotService {
  private _serpCache: { url: string; ts: number; items: Array<{ title: string; url: string }> } | null = null;

  constructor(
    private _adapter: PuppeteerAdapter,
    private _getState: () => PageState | null,
    private _config: BrowserContextConfig,
    private _waitForPageLoad: () => Promise<void>
  ) {}

  async capture(fullPage = false): Promise<string | null> {
    const page = this._adapter.page;
    if (!page) return null;

    try {
      await page.evaluate(() => {
        if (!document.getElementById('pptr-no-anim') && document.head) {
          const s = document.createElement('style');
          s.id = 'pptr-no-anim';
          s.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
          document.head.appendChild(s);
        }
      });

      const state = this._getState();
      const quality = this._computeQuality(state);
      
      const screenshot = await page.screenshot({
        fullPage: fullPage ?? (this._config.viewportExpansion === -1),
        encoding: 'base64',
        type: 'jpeg',
        quality,
      });

      await page.evaluate(() => document.getElementById('pptr-no-anim')?.remove());
      return screenshot as string;
    } catch (error: any) {
      // Transient CDP errors during navigation are expected - log at debug level
      const msg = String(error?.message || error || '');
      const isTransient = (
        msg.includes('Cannot find context') ||
        msg.includes('Execution context was destroyed') ||
        msg.includes('Target closed') ||
        msg.includes('Session closed') ||
        msg.includes('frame was detached') ||
        msg.includes('Page crashed') ||
        msg.includes('No tab with') ||
        msg.includes('Protocol error') ||
        msg.includes('Invalid tab')
      );
      if (isTransient) {
        logger.debug('Screenshot skipped (page navigating or tab closed):', msg.slice(0, 100));
      } else {
        logger.error('Screenshot failed:', error);
      }
      return null;
    }
  }

  async getGoogleSearchResults(maxResults = 10): Promise<Array<{ title: string; url: string }>> {
    const meta = await this.getGoogleSearchResultsWithMeta(maxResults);
    return meta.items;
  }

  async getGoogleSearchResultsWithMeta(maxResults = 10): Promise<{ items: Array<{ title: string; url: string }>; fromCache: boolean }> {
    const page = this._adapter.page;
    if (!page) return { items: [], fromCache: false };

    try {
      const currentUrl = page.url();
      if (this._serpCache?.url === currentUrl && Date.now() - this._serpCache.ts <= 8000) {
        return {
          items: this._serpCache.items.slice(0, Math.max(1, Math.min(20, maxResults))),
          fromCache: true,
        };
      }

      await this._waitForPageLoad();

      const items = await page.evaluate((max: number) => {
        const results: Array<{ title: string; url: string }> = [];
        const seen = new Set<string>();

        const cleanUrl = (href: string): string => {
          try {
            if (href.startsWith('/url?') || href.startsWith('https://www.google.com/url?')) {
              const u = new URL(href, location.origin);
              const q = u.searchParams.get('q');
              if (q) return q;
            }
          } catch {}
          return href;
        };

        const isGoogleDomain = (u: string) => /^https?:\/\/([^.]+\.)?google\./i.test(u);

        const addResult = (titleRaw: string | null | undefined, hrefRaw: string | null | undefined) => {
          const title = (titleRaw || '').trim().replace(/[\t\n\r ]+/g, ' ');
          let url = (hrefRaw || '').trim();
          if (!title || !url) return;
          url = cleanUrl(url);
          if (!/^https?:/i.test(url)) return;
          if (isGoogleDomain(url)) return;
          if (seen.has(url)) return;
          seen.add(url);
          results.push({ title, url });
        };

        const scope: ParentNode = (document.getElementById('search') || document.body);

        const anchorsWithH3 = Array.from(scope.querySelectorAll('a[href] h3')) as HTMLElement[];
        for (const h3 of anchorsWithH3) {
          if (results.length >= max) break;
          const a = h3.closest('a');
          if (!a) continue;
          addResult(h3.textContent, a.getAttribute('href'));
        }

        if (results.length < max) {
          const containers = Array.from(scope.querySelectorAll('div.yuRUbf > a[href]')) as HTMLAnchorElement[];
          for (const a of containers) {
            if (results.length >= max) break;
            const h3 = a.querySelector('h3');
            addResult(h3?.textContent || a.getAttribute('aria-label') || a.textContent, a.getAttribute('href'));
          }
        }

        if (results.length < max) {
          const generic = Array.from(scope.querySelectorAll('div.MjjYud a[href], div.g a[href]')) as HTMLAnchorElement[];
          for (const a of generic) {
            if (results.length >= max) break;
            const h3 = a.querySelector('h3') || a.parentElement?.querySelector?.('h3');
            if (!h3) continue;
            addResult(h3.textContent || a.getAttribute('aria-label') || a.textContent, a.getAttribute('href'));
          }
        }

        return results.slice(0, max);
      }, Math.max(1, Math.min(20, maxResults)));

      const list = Array.isArray(items) ? items : [];
      this._serpCache = { url: page.url(), ts: Date.now(), items: list.slice(0, 20) };
      return { items: list, fromCache: false };
    } catch (error) {
      logger.debug('SERP extraction failed:', error);
      return { items: [], fromCache: false };
    }
  }

  private _computeQuality(state: PageState | null): number {
    try {
      const vh = state?.visualViewportHeight || 800;
      const sh = state?.scrollHeight || 2000;
      const ratio = Math.min(1, Math.max(0.4, vh / Math.max(1, sh)));
      return Math.max(60, Math.min(90, Math.round(70 + ratio * 20)));
    } catch {
      return 80;
    }
  }
}

