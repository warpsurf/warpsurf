import 'webextension-polyfill';
import type { KeyInput } from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';
import type { Frame } from 'puppeteer-core/lib/esm/puppeteer/api/Frame.js';
import { removeHighlights as _removeHighlights } from './dom/service';
import { DOMElementNode, type DOMState } from './dom/views';
import { type BrowserContextConfig, DEFAULT_BROWSER_CONTEXT_CONFIG, type PageState, URLNotAllowedError } from './views';
import { createLogger } from '@src/log';
import { isUrlAllowed } from './util';
import { PuppeteerAdapter } from './page/puppeteer-adapter';
import { StateCache } from './page/state-cache';
import { ScreenshotService } from './page/screenshot-service';
import { ScrollManager } from './page/scroll-manager';
import { NetworkWaiter } from './page/network-waiter';
import { getClickableElements as _getClickableElements } from './dom/service';

const logger = createLogger('Page');

export function build_initial_state(tabId?: number, url?: string, title?: string): PageState {
  return {
    elementTree: new DOMElementNode({
      tagName: 'root',
      isVisible: true,
      parent: null,
      xpath: '',
      attributes: {},
      children: [],
    }),
    selectorMap: new Map(),
    tabId: tabId || 0,
    url: url || '',
    title: title || '',
    screenshot: null,
    scrollY: 0,
    scrollHeight: 0,
    visualViewportHeight: 0,
  };
}

export default class Page {
  private _adapter: PuppeteerAdapter;
  private _cache: StateCache;
  private _screenshots: ScreenshotService;
  private _scroll: ScrollManager;
  private _network: NetworkWaiter;

  private _tabId: number;
  private _config: BrowserContextConfig;
  private _state: PageState;
  private _validWebPage = false;

  constructor(tabId: number, url: string, title: string, config: Partial<BrowserContextConfig> = {}) {
    this._tabId = tabId;
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
    this._state = build_initial_state(tabId, url, title);

    const lowerCaseUrl = url.trim().toLowerCase();
    this._validWebPage =
      (tabId &&
        lowerCaseUrl &&
        lowerCaseUrl.startsWith('http') &&
        !lowerCaseUrl.startsWith('https://chromewebstore.google.com')) ||
      false;

    this._adapter = new PuppeteerAdapter(tabId);
    this._network = new NetworkWaiter(this._adapter, this._config);
    this._scroll = new ScrollManager(this._adapter, tabId, node => this.locateElement(node));
    this._screenshots = new ScreenshotService(
      this._adapter,
      () => this._cache?.cached || null,
      this._config,
      () => this._network.waitForPageLoad(),
    );
    this._cache = new StateCache(
      tabId,
      this._config,
      () => this._adapter.page,
      () => this._scroll.getScrollInfo(),
      () => this.removeHighlight(),
      fullPage => this._screenshots.capture(fullPage),
    );
  }

  get tabId(): number {
    return this._tabId;
  }
  get validWebPage(): boolean {
    return this._validWebPage;
  }
  get attached(): boolean {
    return this._validWebPage && this._adapter.attached;
  }
  get state(): PageState {
    return this._state;
  }
  get config(): BrowserContextConfig {
    return this._config;
  }

  updateConfig(config: Partial<BrowserContextConfig>): void {
    this._config = { ...this._config, ...config };
  }

  attachPuppeteer = () => this._adapter.attach();
  detachPuppeteer = async () => {
    await this._adapter.detach();
    this._state = build_initial_state(this._tabId);
    this._cache.invalidate();
  };

  async removeHighlight(): Promise<void> {
    if (!this._validWebPage) return;
    try {
      await _removeHighlights(this._tabId);
    } catch (error: any) {
      // Silently handle tab-not-found errors - tab may have been closed
      const msg = String(error?.message || '');
      if (msg.includes('No tab with') || msg.includes('Invalid tab')) {
        // Tab no longer exists, mark as invalid
        this._validWebPage = false;
        return;
      }
      logger.debug(`Failed to remove highlights for tab ${this._tabId}:`, error.message);
    }
  }

  async getClickableElements(showHighlightElements: boolean, focusElement: number): Promise<DOMState | null> {
    if (!this._validWebPage) return null;
    return _getClickableElements(
      this._tabId,
      this.url(),
      showHighlightElements,
      focusElement,
      this._config.viewportExpansion,
    );
  }

  getScrollInfo = () => this._scroll.getScrollInfo();
  getElementScrollInfo = (el: DOMElementNode) => this._scroll.getScrollInfo(el);
  getCachedState = () => this._cache.cached;

  async getState(useVision = false, cacheClickableElementsHashes = false): Promise<PageState> {
    if (!this._validWebPage) return build_initial_state(this._tabId);

    try {
      await this.waitForPageAndFramesLoad();
    } catch (e) {
      logger.warning('waitForPageAndFramesLoad failed:', e);
      return this._cache.cached || build_initial_state(this._tabId);
    }

    const state = await this._cache.update(useVision, cacheClickableElementsHashes);
    this._state = state;
    return state;
  }

  async getContent(): Promise<string> {
    const page = this._adapter.page;
    if (!page) throw new Error('Puppeteer page is not connected');
    return await page.content();
  }

  takeScreenshot = (fullPage?: boolean) => this._screenshots.capture(fullPage);
  getGoogleSearchResults = (max?: number) => this._screenshots.getGoogleSearchResults(max);
  getGoogleSearchResultsWithMeta = (max?: number) => this._screenshots.getGoogleSearchResultsWithMeta(max);

  url(): string {
    return this._adapter.page?.url() || this._state.url;
  }

  async title(): Promise<string> {
    return this._adapter.page?.title() || this._state.title;
  }

  async navigateTo(url: string): Promise<void> {
    const page = this._adapter.page;
    if (!page) return;

    logger.debug('navigateTo', url);
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    try {
      await Promise.all([this._network.waitForPageLoad(), page.goto(url)]);
      logger.debug('navigateTo complete');
    } catch (error) {
      if (error instanceof URLNotAllowedError) throw error;
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Navigation timeout, but page might still be usable:', error);
        return;
      }
      logger.error('Navigation failed:', error);
      throw error;
    }
  }

  async refreshPage(): Promise<void> {
    const page = this._adapter.page;
    if (!page) return;

    try {
      await Promise.all([this._network.waitForPageLoad(), page.reload()]);
      logger.debug('Page refresh complete');
    } catch (error) {
      if (error instanceof URLNotAllowedError) throw error;
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Refresh timeout, but page might still be usable:', error);
        return;
      }
      logger.error('Page refresh failed:', error);
      throw error;
    }
  }

  async goBack(): Promise<void> {
    const page = this._adapter.page;
    if (!page) return;

    try {
      await Promise.all([this._network.waitForPageLoad(), page.goBack()]);
      logger.debug('Navigation back completed');
    } catch (error) {
      if (error instanceof URLNotAllowedError) throw error;
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Back navigation timeout, but page might still be usable:', error);
        return;
      }
      logger.error('Could not navigate back:', error);
      throw error;
    }
  }

  async goForward(): Promise<void> {
    const page = this._adapter.page;
    if (!page) return;

    try {
      await Promise.all([this._network.waitForPageLoad(), page.goForward()]);
      logger.debug('Navigation forward completed');
    } catch (error) {
      if (error instanceof URLNotAllowedError) throw error;
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Forward navigation timeout, but page might still be usable:', error);
        return;
      }
      logger.error('Could not navigate forward:', error);
      throw error;
    }
  }

  scrollToPercent = (yPercent: number, el?: DOMElementNode) => this._scroll.scroll({ percent: yPercent }, el);
  scrollBy = (y: number, el?: DOMElementNode) => this._scroll.scroll({ delta: y }, el);
  scrollToPreviousPage = (el?: DOMElementNode) => this._scroll.scroll({ pages: -1 }, el);
  scrollToNextPage = (el?: DOMElementNode) => this._scroll.scroll({ pages: 1 }, el);
  scrollToSelector = (selector: string, nth?: number) => this._scroll.scrollToSelector(selector, nth);
  scrollToText = (text: string, nth?: number) => this._scroll.scrollToText(text, nth);

  async sendKeys(keys: string): Promise<void> {
    const page = this._adapter.page;
    if (!page) throw new Error('Puppeteer page is not connected');

    const keyParts = keys.split('+');
    const modifiers = keyParts.slice(0, -1);
    const mainKey = keyParts[keyParts.length - 1];

    try {
      for (const modifier of modifiers) {
        await page.keyboard.down(this._convertKey(modifier));
      }
      await Promise.all([page.keyboard.press(this._convertKey(mainKey)), this._network.waitForPageLoad()]);
      logger.debug('sendKeys complete', keys);
    } catch (error) {
      logger.error('Failed to send keys:', error);
      throw new Error(`Failed to send keys: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      for (const modifier of [...modifiers].reverse()) {
        try {
          await page.keyboard.up(this._convertKey(modifier));
        } catch (releaseError) {
          logger.error('Failed to release modifier:', modifier, releaseError);
        }
      }
    }
  }

  private _convertKey(key: string): KeyInput {
    const lowerKey = key.trim().toLowerCase();
    const isMac = navigator.userAgent.toLowerCase().includes('mac os x');

    if (isMac) {
      if (lowerKey === 'control' || lowerKey === 'ctrl') return 'Meta' as KeyInput;
      if (lowerKey === 'command' || lowerKey === 'cmd') return 'Meta' as KeyInput;
      if (lowerKey === 'option' || lowerKey === 'opt') return 'Alt' as KeyInput;
    }

    const keyMap: { [key: string]: string } = {
      a: 'KeyA',
      b: 'KeyB',
      c: 'KeyC',
      d: 'KeyD',
      e: 'KeyE',
      f: 'KeyF',
      g: 'KeyG',
      h: 'KeyH',
      i: 'KeyI',
      j: 'KeyJ',
      k: 'KeyK',
      l: 'KeyL',
      m: 'KeyM',
      n: 'KeyN',
      o: 'KeyO',
      p: 'KeyP',
      q: 'KeyQ',
      r: 'KeyR',
      s: 'KeyS',
      t: 'KeyT',
      u: 'KeyU',
      v: 'KeyV',
      w: 'KeyW',
      x: 'KeyX',
      y: 'KeyY',
      z: 'KeyZ',
      '0': 'Digit0',
      '1': 'Digit1',
      '2': 'Digit2',
      '3': 'Digit3',
      '4': 'Digit4',
      '5': 'Digit5',
      '6': 'Digit6',
      '7': 'Digit7',
      '8': 'Digit8',
      '9': 'Digit9',
      control: 'Control',
      shift: 'Shift',
      alt: 'Alt',
      meta: 'Meta',
      enter: 'Enter',
      backspace: 'Backspace',
      delete: 'Delete',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
      escape: 'Escape',
      tab: 'Tab',
      space: 'Space',
    };

    const convertedKey = keyMap[lowerKey] || key;
    logger.debug('convertedKey', convertedKey);
    return convertedKey as KeyInput;
  }

  async getDropdownOptions(index: number): Promise<Array<{ index: number; text: string; value: string }>> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);
    const page = this._adapter.page;

    if (!element || !page) throw new Error('Element not found or puppeteer not connected');

    const elementHandle = await this.locateElement(element);
    if (!elementHandle) throw new Error('Dropdown element not found');

    const options = await elementHandle.evaluate(select => {
      if (!(select instanceof HTMLSelectElement)) throw new Error('Element is not a select element');
      return Array.from(select.options).map(option => ({
        index: option.index,
        text: option.text,
        value: option.value,
      }));
    });

    if (!options.length) throw new Error('No options found in dropdown');
    return options;
  }

  async selectDropdownOption(index: number, text: string): Promise<string> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);
    const page = this._adapter.page;

    if (!element || !page) throw new Error('Element not found or puppeteer not connected');

    logger.debug(`Attempting to select '${text}' from dropdown`);

    if (element.tagName?.toLowerCase() !== 'select') {
      const msg = `Cannot select option: Element with index ${index} is a ${element.tagName}, not a SELECT`;
      logger.error(msg);
      throw new Error(msg);
    }

    const elementHandle = await this.locateElement(element);
    if (!elementHandle) throw new Error(`Dropdown element with index ${index} not found`);

    const result = await elementHandle.evaluate(
      (select, optionText, elementIndex) => {
        if (!(select instanceof HTMLSelectElement)) {
          return { found: false, message: `Element with index ${elementIndex} is not a SELECT` };
        }

        const options = Array.from(select.options);
        const option = options.find(opt => opt.text.trim() === optionText);

        if (!option) {
          const availableOptions = options.map(o => o.text.trim()).join('", "');
          return {
            found: false,
            message: `Option "${optionText}" not found in dropdown element with index ${elementIndex}. Available options: "${availableOptions}"`,
          };
        }

        const previousValue = select.value;
        select.value = option.value;

        if (previousValue !== option.value) {
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.dispatchEvent(new Event('input', { bubbles: true }));
        }

        return { found: true, message: `Selected option "${optionText}" with value "${option.value}"` };
      },
      text,
      index,
    );

    logger.debug('Selection result:', result);
    return result.message;
  }

  async locateElement(element: DOMElementNode): Promise<ElementHandle | null> {
    const page = this._adapter.page;
    if (!page) {
      logger.warning('Puppeteer is not connected');
      return null;
    }

    let currentFrame: any = page;

    const parents: DOMElementNode[] = [];
    let current = element;
    while (current.parent) {
      parents.push(current.parent);
      current = current.parent;
    }

    const iframes = parents.reverse().filter(item => item.tagName === 'iframe');
    for (const parent of iframes) {
      const cssSelector = parent.enhancedCssSelectorForElement(this._config.includeDynamicAttributes);
      const frameElement: ElementHandle | null = await currentFrame.$(cssSelector);
      if (!frameElement) {
        logger.warning(`Could not find iframe with selector: ${cssSelector}`);
        return null;
      }
      const frame: Frame | null = await frameElement.contentFrame();
      if (!frame) {
        logger.warning(`Could not access frame content for selector: ${cssSelector}`);
        return null;
      }
      currentFrame = frame;
      logger.debug('currentFrame changed', currentFrame);
    }

    const cssSelector = element.enhancedCssSelectorForElement(this._config.includeDynamicAttributes);

    try {
      let elementHandle: ElementHandle | null = await currentFrame.$(cssSelector);

      if (!elementHandle) {
        const xpath = element.xpath;
        if (xpath) {
          try {
            logger.debug('Trying XPath selector:', xpath);
            const fullXpath = xpath.startsWith('/') ? xpath : `/${xpath}`;
            const xpathSelector = `::-p-xpath(${fullXpath})`;
            elementHandle = await currentFrame.$(xpathSelector);
          } catch (xpathError) {
            logger.error('Failed to locate element using XPath:', xpathError);
          }
        }
      }

      if (elementHandle) {
        const isHidden = await elementHandle.isHidden();
        if (!isHidden) {
          await this._scroll.scrollIntoView(elementHandle);
        }
        return elementHandle;
      }

      logger.debug('elementHandle not located');
    } catch (error) {
      logger.error('Failed to locate element:', error);
    }

    return null;
  }

  async inputTextElementNode(useVision: boolean, elementNode: DOMElementNode, text: string): Promise<void> {
    const page = this._adapter.page;
    if (!page) throw new Error('Puppeteer is not connected');

    try {
      const element = await this.locateElement(elementNode);
      if (!element) throw new Error(`Element: ${elementNode} not found`);

      try {
        await this._waitForElementStability(element);
        const isHidden = await element.isHidden();
        if (!isHidden) {
          await this._scroll.scrollIntoView(element, 1500);
        }
      } catch (e) {
        logger.debug(`Non-critical error preparing element: ${e}`);
      }

      const tagName = await element.evaluate(el => el.tagName.toLowerCase());
      const isContentEditable = await element.evaluate(el => el instanceof HTMLElement && el.isContentEditable);

      if (isContentEditable) {
        // For contenteditable (Google Docs, rich editors), click to focus then type
        await element.click();
        // Select all existing content and delete it
        const isMac = navigator.userAgent.toLowerCase().includes('mac os x');
        const modifier = isMac ? 'Meta' : 'Control';
        await page.keyboard.down(modifier);
        await page.keyboard.press('KeyA');
        await page.keyboard.up(modifier);
        await page.keyboard.press('Backspace');
        // Type with reasonable delay for editors to process
        await page.keyboard.type(text, { delay: 1 });
      } else {
        // For form inputs and other elements, set value directly
        await element.evaluate((el, value) => {
          if (el instanceof HTMLElement) el.focus();
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el instanceof HTMLElement) {
            el.textContent = value;
          }
        }, text);
      }

      await this._network.waitForPageLoad();

      // Verify text was actually entered
      await this._verifyInputText(element, text, tagName);
    } catch (error) {
      const errorMsg = `Failed to input text into element: ${elementNode}. Error: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  private async _waitForElementStability(element: ElementHandle, timeout = 1000): Promise<void> {
    const startTime = Date.now();
    let lastRect = await element.boundingBox();

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const currentRect = await element.boundingBox();
      if (!currentRect) break;

      if (
        lastRect &&
        Math.abs(lastRect.x - currentRect.x) < 2 &&
        Math.abs(lastRect.y - currentRect.y) < 2 &&
        Math.abs(lastRect.width - currentRect.width) < 2 &&
        Math.abs(lastRect.height - currentRect.height) < 2
      ) {
        await new Promise(resolve => setTimeout(resolve, 50));
        return;
      }

      lastRect = currentRect;
    }

    logger.debug('Element stability check completed');
  }

  private async _verifyInputText(element: ElementHandle, text: string, tagName: string): Promise<void> {
    // Brief delay for DOM to settle
    await new Promise(resolve => setTimeout(resolve, 50));

    const result = await element.evaluate((el, expected) => {
      let actual = '';
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        actual = el.value;
      } else if (el instanceof HTMLElement) {
        actual = (el.innerText || el.textContent || '').trim();
      }
      const prefix = expected.slice(0, 50);
      return {
        verified: actual.length > 0 && actual.includes(prefix),
        length: actual.length,
        preview: actual.slice(0, 100),
      };
    }, text);

    if (!result.verified) {
      const preview = result.preview ? `"${result.preview}"` : '(empty)';
      throw new Error(
        `Input verification failed for ${tagName}: text not found. ` +
          `Element contains ${result.length} chars: ${preview}`,
      );
    }

    logger.debug(`Input verified: ${result.length} chars in ${tagName}`);
  }

  async clickElementNode(useVision: boolean, elementNode: DOMElementNode): Promise<void> {
    const page = this._adapter.page;
    if (!page) throw new Error('Puppeteer is not connected');

    try {
      const element = await this.locateElement(elementNode);
      if (!element) throw new Error(`Element: ${elementNode} not found`);

      await this._scroll.scrollIntoView(element);

      try {
        await Promise.race([
          element.click(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 2000)),
        ]);
        await this._checkAndHandleNavigation();
      } catch (error) {
        if (error instanceof URLNotAllowedError) throw error;
        logger.debug('Failed to click element, trying again', error);
        try {
          await element.evaluate(el => (el as HTMLElement).click());
        } catch (secondError) {
          if (secondError instanceof URLNotAllowedError) throw secondError;
          throw new Error(
            `Failed to click element: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
          );
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to click element: ${elementNode}. Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async _checkAndHandleNavigation(): Promise<void> {
    this._network.checkAndHandleNavigation();
  }

  getSelectorMap(): Map<number, DOMElementNode> {
    return this._cache.cached?.selectorMap || new Map();
  }

  async getElementByIndex(index: number): Promise<ElementHandle | null> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap.get(index);
    if (!element) return null;
    return await this.locateElement(element);
  }

  getDomElementByIndex(index: number): DOMElementNode | null {
    const selectorMap = this.getSelectorMap();
    return selectorMap.get(index) || null;
  }

  isFileUploader(elementNode: DOMElementNode, maxDepth = 3, currentDepth = 0): boolean {
    if (currentDepth > maxDepth) return false;

    if (elementNode.tagName === 'input') {
      const attributes = elementNode.attributes;
      if (attributes['type']?.toLowerCase() === 'file' || !!attributes['accept']) {
        return true;
      }
    }

    if (elementNode.children && currentDepth < maxDepth) {
      for (const child of elementNode.children) {
        if ('tagName' in child) {
          if (this.isFileUploader(child as DOMElementNode, maxDepth, currentDepth + 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  async waitForPageLoadState(timeout?: number) {
    const timeoutValue = timeout || 8000;
    await this._adapter.page?.waitForNavigation({ timeout: timeoutValue });
  }

  waitForPageAndFramesLoad = (t?: number) => this._network.waitForPageLoad(t);

  async getVisiblePlainText(): Promise<string> {
    const page = this._adapter.page;
    if (!page) throw new Error('Puppeteer is not connected');

    try {
      const text = await page.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script, style, noscript').forEach(n => n.remove());
        const isHidden = (el: Element) => {
          const style = window.getComputedStyle(el as HTMLElement);
          return style.display === 'none' || style.visibility === 'hidden';
        };
        clone.querySelectorAll('*').forEach(el => {
          if (isHidden(el)) (el as HTMLElement).remove();
        });
        return (clone.innerText || '').trim();
      });
      return text || '';
    } catch (error) {
      logger.debug('getVisiblePlainText failed:', error);
      return '';
    }
  }

  async clickSelector(selector: string, nth: number = 1, useVision = false): Promise<boolean> {
    const page = this._adapter.page;
    if (!page) throw new Error('Puppeteer is not connected');

    try {
      const ok = await page.evaluate(
        (sel: string, nth: number) => {
          const all = Array.from(document.querySelectorAll(sel));
          const idx = Math.max(1, nth) - 1;
          const el = all[idx] as HTMLElement | undefined;
          if (!el) return false;
          try {
            el.scrollIntoView({ block: 'center', inline: 'center' });
          } catch {}
          try {
            (el as HTMLElement).click();
            return true;
          } catch {
            return false;
          }
        },
        selector,
        nth,
      );
      return !!ok;
    } catch (error) {
      logger.debug('clickSelector failed:', error);
      return false;
    }
  }

  async findAndClickText(
    text: string,
    opts: { exact?: boolean; caseSensitive?: boolean; nth?: number; useVision?: boolean } = {},
  ): Promise<boolean> {
    const page = this._adapter.page;
    if (!page) throw new Error('Puppeteer is not connected');

    const { exact = false, caseSensitive = false } = opts;
    const nth = typeof opts.nth === 'number' && opts.nth > 0 ? opts.nth : 1;

    try {
      const ok = await page.evaluate(
        (needle: string, exact: boolean, caseSensitive: boolean, nth: number) => {
          const norm = (s: string) => (caseSensitive ? s : s.toLowerCase());
          const target = norm(needle);
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          const matches: HTMLElement[] = [];
          while (walker.nextNode()) {
            const el = walker.currentNode as HTMLElement;
            const role = (el.getAttribute && (el.getAttribute('role') || '')) || '';
            const tag = el.tagName.toLowerCase();
            const clickable =
              el instanceof HTMLAnchorElement ||
              el instanceof HTMLButtonElement ||
              el.onclick != null ||
              role === 'button' ||
              role === 'link';
            if (!clickable) continue;
            const textContent = norm((el.innerText || '').trim());
            if (!textContent) continue;
            const matched = exact ? textContent === target : textContent.includes(target);
            if (matched) matches.push(el);
          }
          const idx = Math.max(1, nth) - 1;
          const el = matches[idx];
          if (!el) return false;
          try {
            el.scrollIntoView({ block: 'center', inline: 'center' });
          } catch {}
          try {
            el.click();
            return true;
          } catch {
            return false;
          }
        },
        text,
        exact,
        caseSensitive,
        nth,
      );
      return !!ok;
    } catch (error) {
      logger.debug('findAndClickText failed:', error);
      return false;
    }
  }
}
