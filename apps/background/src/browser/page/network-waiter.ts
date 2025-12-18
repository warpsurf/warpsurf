import type { PuppeteerAdapter } from './puppeteer-adapter';
import type { BrowserContextConfig } from '../views';
import { URLNotAllowedError } from '../views';
import type { HTTPRequest } from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import type { HTTPResponse } from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import { isUrlAllowed } from '../util';

export class NetworkWaiter {
  constructor(
    private _adapter: PuppeteerAdapter,
    private _config: BrowserContextConfig
  ) {}

  async waitForStable(): Promise<void> {
    const page = this._adapter.page;
    if (!page) return;

    const RELEVANT_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'iframe']);
    const RELEVANT_CONTENT_TYPES = ['text/html', 'text/css', 'application/javascript', 'image/', 'font/', 'application/json'];
    const IGNORED_PATTERNS = [
      'analytics', 'tracking', 'telemetry', 'beacon', 'metrics',
      'doubleclick', 'adsystem', 'adserver', 'advertising',
      'facebook.com/plugins', 'platform.twitter', 'linkedin.com/embed',
      'livechat', 'zendesk', 'intercom', 'crisp.chat', 'hotjar',
      'push-notifications', 'onesignal', 'pushwoosh',
      'heartbeat', 'ping', 'alive',
      'webrtc', 'rtmp://', 'wss://',
      'cloudfront.net', 'fastly.net',
    ];

    const pendingRequests = new Set();
    let lastActivity = Date.now();

    const onRequest = (request: HTTPRequest) => {
      const resourceType = request.resourceType();
      if (!RELEVANT_RESOURCE_TYPES.has(resourceType)) return;
      if (['websocket', 'media', 'eventsource', 'manifest', 'other'].includes(resourceType)) return;

      const url = request.url().toLowerCase();
      if (IGNORED_PATTERNS.some(pattern => url.includes(pattern))) return;
      if (url.startsWith('data:') || url.startsWith('blob:')) return;

      const headers = request.headers();
      if (
        headers['purpose'] === 'prefetch' ||
        headers['sec-fetch-dest'] === 'video' ||
        headers['sec-fetch-dest'] === 'audio'
      ) return;

      pendingRequests.add(request);
      lastActivity = Date.now();
    };

    const onResponse = (response: HTTPResponse) => {
      const request = response.request();
      if (!pendingRequests.has(request)) return;

      const contentType = response.headers()['content-type']?.toLowerCase() || '';

      if (['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf'].some(t => contentType.includes(t))) {
        pendingRequests.delete(request);
        return;
      }

      if (!RELEVANT_CONTENT_TYPES.some(ct => contentType.includes(ct))) {
        pendingRequests.delete(request);
        return;
      }

      const contentLength = response.headers()['content-length'];
      if (contentLength && Number.parseInt(contentLength) > 5 * 1024 * 1024) {
        pendingRequests.delete(request);
        return;
      }

      pendingRequests.delete(request);
      lastActivity = Date.now();
    };

    page.on('request', onRequest);
    page.on('response', onResponse);

    try {
      const startTime = Date.now();

      while (true) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const now = Date.now();
        const timeSinceLastActivity = (now - lastActivity) / 1000;

        if (pendingRequests.size === 0 && timeSinceLastActivity >= this._config.waitForNetworkIdlePageLoadTime) {
          break;
        }

        const elapsedTime = (now - startTime) / 1000;
        if (elapsedTime > this._config.maximumWaitPageLoadTime) {
          console.debug(
            `Network timeout after ${this._config.maximumWaitPageLoadTime}s with ${pendingRequests.size} pending requests:`,
            Array.from(pendingRequests).map(r => (r as HTTPRequest).url()),
          );
          break;
        }
      }
    } finally {
      page.off('request', onRequest);
      page.off('response', onResponse);
    }
  }

  async waitForPageLoad(timeoutOverride?: number): Promise<void> {
    const startTime = Date.now();

    try {
      await this.waitForStable();

      const page = this._adapter.page;
      if (page) {
        await this.checkAndHandleNavigation();
      }
    } catch (error) {
      // Re-throw URLNotAllowedError
      if ((error as any).name === 'URLNotAllowedError') {
        throw error;
      }
      console.warn('Page load failed, continuing...', error);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const minWaitTime = timeoutOverride || this._config.minimumWaitPageLoadTime;
    const remaining = Math.max(minWaitTime - elapsed, 0);

    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining * 1000));
    }
  }

  checkAndHandleNavigation(): void {
    const page = this._adapter.page;
    if (!page) return;

    const currentUrl = page.url();
    if (!isUrlAllowed(currentUrl, this._config.allowedUrls, this._config.deniedUrls)) {
      const errorMessage = `URL: ${currentUrl} is not allowed`;
      console.error(errorMessage);

      const safeUrl = this._config.homePageUrl || 'about:blank';
      console.debug(`Redirecting to safe URL: ${safeUrl}`);

      try {
        page.goto(safeUrl);
      } catch (error) {
        console.error(`Failed to redirect to safe URL: ${error instanceof Error ? error.message : String(error)}`);
      }

      throw new URLNotAllowedError(errorMessage);
    }
  }
}

