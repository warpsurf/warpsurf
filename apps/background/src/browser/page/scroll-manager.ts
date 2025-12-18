import type { PuppeteerAdapter } from './puppeteer-adapter';
import type { DOMElementNode } from '../dom/views';
import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';
import { getScrollInfo as _getScrollInfo } from '../dom/service';
import { createLogger } from '@src/log';

const logger = createLogger('ScrollManager');

export class ScrollManager {
  constructor(
    private _adapter: PuppeteerAdapter,
    private _tabId: number,
    private _locateElement: (node: DOMElementNode) => Promise<ElementHandle | null>
  ) {}

  async getScrollInfo(elementNode?: DOMElementNode): Promise<[number, number, number]> {
    const page = this._adapter.page;
    if (!page) return [0, 0, 0];

    if (!elementNode) {
      return _getScrollInfo(this._tabId);
    }

    const element = await this._locateElement(elementNode);
    if (!element) throw new Error(`Element not found`);

    const scrollableElement = await this._findScrollable(element);
    if (!scrollableElement) throw new Error(`No scrollable ancestor found`);

    const scrollInfo = await scrollableElement.evaluate(el => ({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));

    return [scrollInfo.scrollTop, scrollInfo.clientHeight, scrollInfo.scrollHeight];
  }

  async scroll(
    target: { percent?: number; delta?: number; pages?: number },
    elementNode?: DOMElementNode
  ): Promise<void> {
    const page = this._adapter.page;
    if (!page) throw new Error('Puppeteer not connected');

    if (!elementNode) {
      await page.evaluate((t: any) => {
        const vh = window.visualViewport?.height || window.innerHeight;
        const sh = document.documentElement.scrollHeight;
        const top = t.percent !== undefined
          ? (sh - vh) * (t.percent / 100)
          : t.delta !== undefined
            ? window.scrollY + t.delta
            : window.scrollY + (vh * t.pages);
        window.scrollTo({ top, left: window.scrollX, behavior: 'smooth' });
      }, target);
    } else {
      const element = await this._locateElement(elementNode);
      if (!element) throw new Error(`Element not found`);

      const scrollableElement = await this._findScrollable(element);
      if (!scrollableElement) throw new Error(`No scrollable ancestor found`);

      await scrollableElement.evaluate((el, t: any) => {
        const top = t.percent !== undefined
          ? (el.scrollHeight - el.clientHeight) * (t.percent / 100)
          : t.delta !== undefined
            ? el.scrollTop + t.delta
            : el.scrollTop + (el.clientHeight * t.pages);
        el.scrollTo({ top, left: el.scrollLeft, behavior: 'smooth' });
      }, target);
    }
  }

  async scrollToSelector(selector: string, nth = 1): Promise<boolean> {
    const page = this._adapter.page;
    if (!page) throw new Error('Puppeteer not connected');

    try {
      const result = await page.evaluate(async (sel: string, nth: number) => {
        const all = Array.from(document.querySelectorAll(sel));
        const idx = Math.max(1, nth) - 1;
        const el = all[idx] as HTMLElement | undefined;
        if (!el) return false;
        try {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        } catch {}
        return true;
      }, selector, nth);
      return !!result;
    } catch (error) {
      logger.debug('scrollToSelector failed:', error);
      return false;
    }
  }

  async scrollToText(text: string, nth = 1): Promise<boolean> {
    const page = this._adapter.page;
    if (!page) return false;

    try {
      const lowerCaseText = text.toLowerCase();
      const selectors = [
        `::-p-text(${text})`,
        `::-p-xpath(//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${lowerCaseText}')])`,
      ];

      for (const selector of selectors) {
        const elements = await page.$$(selector);
        if (elements.length === 0) continue;

        try {
          const visibleElements = [];
          for (const element of elements) {
            const isVisible = await element.evaluate(el => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' &&
                style.opacity !== '0' && rect.width > 0 && rect.height > 0;
            });

            if (isVisible) visibleElements.push(element);
          }

          if (visibleElements.length >= nth) {
            await this._scrollIntoView(visibleElements[nth - 1]);
            await new Promise(resolve => setTimeout(resolve, 500));
            return true;
          }
        } catch (e) {
          logger.debug(`Locator attempt failed:`, e);
        } finally {
          await Promise.all(elements.map(el => el.dispose().catch(() => {})));
        }
      }
      return false;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  async scrollIntoView(element: ElementHandle, timeout = 1000): Promise<void> {
    await this._scrollIntoView(element, timeout);
  }

  private async _scrollIntoView(element: ElementHandle, timeout = 1000): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const isVisible = await element.evaluate(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;

        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
          return false;
        }

        const isInViewport =
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          rect.right <= (window.innerWidth || document.documentElement.clientWidth);

        if (!isInViewport) {
          el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
          return false;
        }

        return true;
      });

      if (isVisible) break;

      if (Date.now() - startTime > timeout) {
        logger.warning('Timed out scrolling element into view');
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async _findScrollable(element: ElementHandle): Promise<ElementHandle | null> {
    const page = this._adapter.page;
    if (!page) return null;

    const isScrollable = await element.evaluate((el: Element) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const hasVerticalScrollbar = el.scrollHeight > el.clientHeight;
      const canScrollVertically =
        style.overflowY === 'scroll' || style.overflowY === 'auto' ||
        style.overflow === 'scroll' || style.overflow === 'auto';
      return hasVerticalScrollbar && canScrollVertically;
    });

    if (isScrollable) return element;

    let currentElement: ElementHandle<Element> | null = element;

    try {
      while (currentElement) {
        const parentHandle = (await currentElement.evaluateHandle(
          (el: Element) => el.parentElement,
        )) as ElementHandle<Element> | null;

        const parentElement = parentHandle ? await parentHandle.asElement() : null;
        if (!parentElement) break;

        const parentIsScrollable = await parentElement.evaluate((el: Element) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          const hasVerticalScrollbar = el.scrollHeight > el.clientHeight;
          const canScrollVertically =
            ['scroll', 'auto'].includes(style.overflowY) || ['scroll', 'auto'].includes(style.overflow);
          return hasVerticalScrollbar && canScrollVertically;
        });

        if (parentIsScrollable) return parentElement;

        if (currentElement !== element) {
          try {
            await currentElement.dispose();
          } catch {}
        }

        currentElement = parentElement;
      }
    } catch (error) {
      logger.error('Error finding scrollable parent:', error);
    }

    try {
      const bodyElement = await page.$('body');
      if (bodyElement) {
        const bodyIsScrollable = await bodyElement.evaluate(el => {
          if (!(el instanceof HTMLElement)) return false;
          return el.scrollHeight > el.clientHeight;
        });
        if (bodyIsScrollable) return bodyElement;
      }

      const documentElement = await page.evaluateHandle(() => document.documentElement);
      const docElement = (await documentElement.asElement()) as ElementHandle<Element> | null;
      return docElement;
    } catch (error) {
      logger.error('Failed to find scrollable element:', error);
      return null;
    }
  }
}

