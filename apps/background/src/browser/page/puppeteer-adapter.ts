import {
  connect,
  ExtensionTransport,
  type ProtocolType,
} from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import type { Browser } from 'puppeteer-core/lib/esm/puppeteer/api/Browser.js';
import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import { createLogger } from '@src/log';

const logger = createLogger('PuppeteerAdapter');

export class PuppeteerAdapter {
  private static _backoff = new Map<number, number>();
  private _browser: Browser | null = null;
  private _page: PuppeteerPage | null = null;

  constructor(private _tabId: number) {}

  async attach(): Promise<boolean> {
    if ((PuppeteerAdapter._backoff.get(this._tabId) || 0) > Date.now()) return false;
    if (this._page) return true;

    try {
      logger.debug('attaching puppeteer', this._tabId);
      this._browser = await connect({
        transport: await ExtensionTransport.connectTab(this._tabId),
        defaultViewport: null,
        protocol: 'cdp' as ProtocolType,
      });

      const [page] = await this._browser.pages();
      this._page = page;

      await this._injectScripts();
      return true;
    } catch (error: any) {
      const isDebuggerAttached = error.message?.includes('Another debugger');
      if (isDebuggerAttached) {
        logger.debug(`Tab ${this._tabId}: Another debugger already attached`);
        PuppeteerAdapter._backoff.set(this._tabId, Date.now() + 30_000);
      } else {
        logger.error(`Failed to attach tab ${this._tabId}:`, error);
      }
      this._cleanup();
      return false;
    }
  }

  async detach(): Promise<void> {
    if (this._browser) {
      try {
        await this._browser.disconnect();
      } catch (error: any) {
        if (!error.message?.includes('Another debugger')) {
          logger.warning(`Error disconnecting tab ${this._tabId}:`, error.message);
        }
      } finally {
        this._cleanup();
      }
    }
    // Explicitly detach Chrome debugger to remove the yellow "debugging" banner
    try {
      await chrome.debugger.detach({ tabId: this._tabId });
    } catch {
      // Debugger may already be detached or tab closed
    }
  }

  get page(): PuppeteerPage | null {
    return this._page;
  }

  get browser(): Browser | null {
    return this._browser;
  }

  get attached(): boolean {
    return this._page !== null;
  }

  private _cleanup(): void {
    this._browser = null;
    this._page = null;
  }

  private async _injectScripts(): Promise<void> {
    if (!this._page) return;

    await this._page.evaluateOnNewDocument(`
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      (function () {
        const originalAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function attachShadow(options) {
          return originalAttachShadow.call(this, { ...options, mode: "open" });
        };
      })();
    `);
  }
}
