import type { PuppeteerAdapter } from './puppeteer-adapter';
import type { PageState, BrowserContextConfig } from '../views';
import { createLogger } from '@src/log';
import { getSearchEngine } from '@src/search-engines';
import { extractSerpResults } from '@src/search-engines/serp-extractor';

const logger = createLogger('ScreenshotService');

export class ScreenshotService {
  private _serpCache: { url: string; ts: number; items: Array<{ title: string; url: string }> } | null = null;

  constructor(
    private _adapter: PuppeteerAdapter,
    private _getState: () => PageState | null,
    private _config: BrowserContextConfig,
    private _waitForPageLoad: () => Promise<void>,
  ) {}

  async capture(fullPage = false, freezeAnimations = true): Promise<string | null> {
    const page = this._adapter.page;
    if (!page) return null;

    try {
      if (freezeAnimations) {
        await page.evaluate(() => {
          if (!document.getElementById('pptr-no-anim') && document.head) {
            const s = document.createElement('style');
            s.id = 'pptr-no-anim';
            s.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
            document.head.appendChild(s);
          }
        });
      }

      const state = this._getState();
      const quality = this._computeQuality(state);

      const screenshot = await page.screenshot({
        fullPage: fullPage ?? this._config.viewportExpansion === -1,
        encoding: 'base64',
        type: 'jpeg',
        quality,
      });

      if (freezeAnimations) {
        await page.evaluate(() => document.getElementById('pptr-no-anim')?.remove());
      }
      return screenshot as string;
    } catch (error: any) {
      // Transient CDP errors during navigation are expected - log at debug level
      const msg = String(error?.message || error || '');
      const isTransient =
        msg.includes('Cannot find context') ||
        msg.includes('Execution context was destroyed') ||
        msg.includes('Target closed') ||
        msg.includes('Session closed') ||
        msg.includes('frame was detached') ||
        msg.includes('Page crashed') ||
        msg.includes('No tab with') ||
        msg.includes('Protocol error') ||
        msg.includes('Invalid tab');
      if (isTransient) {
        logger.debug('Screenshot skipped (page navigating or tab closed):', msg.slice(0, 100));
      } else {
        logger.error('Screenshot failed:', error);
      }
      return null;
    }
  }

  async getSearchResults(maxResults = 10, engineId = 'google'): Promise<Array<{ title: string; url: string }>> {
    const meta = await this.getSearchResultsWithMeta(maxResults, engineId);
    return meta.items;
  }

  async getSearchResultsWithMeta(
    maxResults = 10,
    engineId = 'google',
  ): Promise<{ items: Array<{ title: string; url: string }>; fromCache: boolean }> {
    const page = this._adapter.page;
    if (!page) return { items: [], fromCache: false };

    try {
      const currentUrl = page.url();
      const cacheKey = `${engineId}:${currentUrl}`;
      if (this._serpCache?.url === cacheKey && Date.now() - this._serpCache.ts <= 8000) {
        return {
          items: this._serpCache.items.slice(0, Math.max(1, Math.min(20, maxResults))),
          fromCache: true,
        };
      }

      await this._waitForPageLoad();

      const engine = getSearchEngine(engineId);
      const items = await extractSerpResults(page, engine, maxResults);

      const list = Array.isArray(items) ? items : [];
      this._serpCache = { url: cacheKey, ts: Date.now(), items: list.slice(0, 20) };
      return { items: list, fromCache: false };
    } catch (error) {
      logger.debug('SERP extraction failed:', error);
      return { items: [], fromCache: false };
    }
  }

  // Backwards compatibility aliases
  async getGoogleSearchResults(maxResults = 10): Promise<Array<{ title: string; url: string }>> {
    return this.getSearchResults(maxResults, 'google');
  }

  async getGoogleSearchResultsWithMeta(
    maxResults = 10,
  ): Promise<{ items: Array<{ title: string; url: string }>; fromCache: boolean }> {
    return this.getSearchResultsWithMeta(maxResults, 'google');
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
