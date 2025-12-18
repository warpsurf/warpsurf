import type { PageState } from '../views';
import { DOMElementNode } from '../dom/views';
import { ClickableElementProcessor } from '../dom/clickable/service';
import { getClickableElements as _getClickableElements } from '../dom/service';
import { createLogger } from '@src/log';
import type { BrowserContextConfig } from '../views';

const logger = createLogger('StateCache');

export class CachedStateClickableElementsHashes {
  constructor(
    public url: string,
    public hashes: Set<string>
  ) {}
}

export class StateCache {
  private _state: PageState | null = null;
  private _hashes: CachedStateClickableElementsHashes | null = null;

  constructor(
    private _tabId: number,
    private _config: BrowserContextConfig,
    private _getPage: () => any,
    private _getScrollInfo: () => Promise<[number, number, number]>,
    private _removeHighlight: () => Promise<void>,
    private _takeScreenshot: (fullPage: boolean) => Promise<string | null>
  ) {}

  get cached(): PageState | null {
    return this._state;
  }

  async update(useVision = false, trackNew = false): Promise<PageState> {
    const page = this._getPage();
    if (!page) {
      logger.warning('Cannot update state: page not attached');
      return this._state || this._buildEmptyState();
    }

    try {
      await page.evaluate('1');
    } catch (error) {
      logger.warning('Page no longer accessible:', error);
      return this._state || this._buildEmptyState();
    }

    try {
      await this._removeHighlight();

      const displayHighlights = this._config.displayHighlights || useVision;
      const content = await _getClickableElements(this._tabId, page.url(), displayHighlights, -1, this._config.viewportExpansion);
      
      if (!content) {
        logger.warning('Failed to get clickable elements');
        return this._state || this._buildEmptyState();
      }

      const screenshot = useVision ? await this._takeScreenshot(this._config.viewportExpansion === -1) : null;
      const [scrollY, visualViewportHeight, scrollHeight] = await this._getScrollInfo();

      const newState: PageState = {
        elementTree: content.elementTree,
        selectorMap: content.selectorMap,
        tabId: this._tabId,
        url: page.url(),
        title: await page.title(),
        screenshot,
        scrollY,
        visualViewportHeight,
        scrollHeight,
      };

      if (trackNew && this._hashes?.url === newState.url) {
        await this._markNewElements(newState);
      }

      if (trackNew) {
        const hashes = await ClickableElementProcessor.getClickableElementsHashes(newState.elementTree);
        this._hashes = new CachedStateClickableElementsHashes(newState.url, hashes);
      }

      this._state = newState;
      return newState;
    } catch (error) {
      logger.error('Failed to update state:', error);
      return this._state || this._buildEmptyState();
    }
  }

  invalidate(): void {
    this._state = null;
    this._hashes = null;
  }

  private async _markNewElements(state: PageState): Promise<void> {
    if (!this._hashes) return;

    const elements = ClickableElementProcessor.getClickableElements(state.elementTree);
    for (const el of elements) {
      const hash = await ClickableElementProcessor.hashDomElement(el);
      el.isNew = !this._hashes.hashes.has(hash);
    }
  }

  private _buildEmptyState(): PageState {
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
      tabId: this._tabId,
      url: '',
      title: '',
      screenshot: null,
      scrollY: 0,
      scrollHeight: 0,
      visualViewportHeight: 0,
    };
  }
}

