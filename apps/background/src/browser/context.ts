import 'webextension-polyfill';
import {
  type BrowserContextConfig,
  type BrowserState,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  type TabInfo,
  URLNotAllowedError,
} from './views';
import Page, { build_initial_state } from './page';
import { createLogger } from '@src/log';
import { isUrlAllowed } from './util';
import { tabExists } from '@src/utils';

const logger = createLogger('BrowserContext');
export default class BrowserContext {
  private _config: BrowserContextConfig;
  private _currentTabId: number | null = null;
  private _attachedPages: Map<number, Page> = new Map();
  private _forceNewTab: boolean = false;
  private _newTabCreated: number | null = null;
  private _visibleGroupId: number | null = null;
  // Track tab ownership per BrowserContext when running in worker mode
  private _ownedTabIds: Set<number> = new Set();
  private _rootTabId: number | null = null;
  // Optional preferred tab group id for immediate grouping of newly created tabs
  private _preferredGroupId: number | null = null;
  // Context tabs provided by user to be added to agent's tab group
  private _contextTabIds: number[] = [];

  constructor(config: Partial<BrowserContextConfig> & { forceNewTab?: boolean } = {}) {
    const { forceNewTab, ...browserConfig } = config;
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...browserConfig };
    this._forceNewTab = forceNewTab || false;
  }

  /** Expose whether this context is running in worker mode (isolated tab behavior). */
  public isWorkerMode(): boolean {
    return !!this._forceNewTab;
  }

  public getConfig(): BrowserContextConfig {
    return this._config;
  }

  public updateConfig(config: Partial<BrowserContextConfig>): void {
    this._config = { ...this._config, ...config };
    // Propagate config updates to all attached pages
    for (const page of this._attachedPages.values()) {
      page.updateConfig(config);
    }
  }

  public updateCurrentTabId(tabId: number): void {
    // only update tab id, but don't attach it.
    this._currentTabId = tabId;
  }

  /**
   * Hint the context to place newly created tabs into the specified Chrome tab group.
   * Passing null clears the hint.
   * Also moves any context tabs into this group.
   */
  public setPreferredGroupId(groupId: number | null | undefined): void {
    if (typeof groupId === 'number' && groupId >= 0) {
      this._preferredGroupId = groupId;
      // Move context tabs into the group
      this.moveContextTabsToGroup(groupId);
    } else {
      this._preferredGroupId = null;
    }
  }

  /**
   * Set context tabs that should be added to the agent's tab group.
   * These tabs are registered as owned and the first one is set as the current tab
   * so the agent starts working there instead of creating a new tab.
   */
  public setContextTabs(tabIds: number[]): void {
    this._contextTabIds = tabIds.filter(id => typeof id === 'number' && id > 0);
    // Register context tabs as owned so the agent can interact with them
    for (const tabId of this._contextTabIds) {
      this.registerOwnedTab(tabId);
    }
    // Set the first context tab as the current tab so the agent starts there
    if (this._contextTabIds.length > 0) {
      this._currentTabId = this._contextTabIds[0];
      logger.info(`Set current tab to first context tab: ${this._currentTabId}`);
    }
    logger.debug(`Set ${this._contextTabIds.length} context tabs:`, this._contextTabIds);
  }

  /**
   * Get the context tab IDs.
   */
  public getContextTabIds(): number[] {
    return [...this._contextTabIds];
  }

  /**
   * Move context tabs into the specified group.
   */
  private async moveContextTabsToGroup(groupId: number): Promise<void> {
    if (this._contextTabIds.length === 0) return;

    try {
      // Filter to tabs that still exist
      const validTabIds: number[] = [];
      for (const tabId of this._contextTabIds) {
        if (await tabExists(tabId)) {
          validTabIds.push(tabId);
        }
      }

      if (validTabIds.length > 0) {
        await chrome.tabs.group({ tabIds: validTabIds, groupId });
        logger.info(`Moved ${validTabIds.length} context tabs to group ${groupId}`);
      }
    } catch (e) {
      logger.error('Failed to move context tabs to group:', e);
    }
  }

  /**
   * Resolve and cache the visible group id based on the current tab.
   * Returns the group id or null if the current tab is not in a group.
   */
  private async resolveVisibleGroupId(): Promise<number | null> {
    try {
      if (!this._currentTabId) return null;
      const tab = await chrome.tabs.get(this._currentTabId);
      const gid = (tab as any)?.groupId;
      this._visibleGroupId = typeof gid === 'number' && gid >= 0 ? gid : null;
      return this._visibleGroupId;
    } catch {
      this._visibleGroupId = null;
      return null;
    }
  }

  /**
   * Query tabs but restrict results to the current task's tab group when available.
   * If no group is set, returns only the current tab (if any).
   */
  private async queryScopedTabs(): Promise<chrome.tabs.Tab[]> {
    try {
      if (!this._currentTabId) return [];
      const current = await chrome.tabs.get(this._currentTabId);
      const gid = (current as any)?.groupId;
      if (typeof gid === 'number' && gid >= 0) {
        this._visibleGroupId = gid;
        return await chrome.tabs.query({ groupId: gid });
      }
      return [current];
    } catch {
      return [];
    }
  }

  private async _getOrCreatePage(tab: chrome.tabs.Tab, forceUpdate = false): Promise<Page> {
    if (!tab.id) {
      throw new Error('Tab ID is not available');
    }

    const existingPage = this._attachedPages.get(tab.id);
    if (existingPage) {
      logger.debug('getOrCreatePage', tab.id, 'already attached');
      if (!forceUpdate) {
        return existingPage;
      }
      // detach the page and remove it from the attached pages if forceUpdate is true
      await existingPage.detachPuppeteer();
      this._attachedPages.delete(tab.id);
    }
    logger.debug('getOrCreatePage', tab.id, 'creating new page');
    return new Page(tab.id, tab.url || '', tab.title || '', this._config);
  }

  public async cleanup(): Promise<void> {
    logger.debug(`cleanup called - detaching from ${this._attachedPages.size} pages`);
    try {
      // Only try to remove highlights if we have a valid current tab
      if (this._currentTabId && (await tabExists(this._currentTabId))) {
        const currentPage = await this.getCurrentPage();
        await currentPage?.removeHighlight();
      }
    } catch (error: any) {
      // Silently ignore tab-not-found errors during cleanup
      const msg = String(error?.message || '');
      if (!msg.includes('No tab with') && !msg.includes('No worker tab')) {
        logger.warning('Error removing highlight during cleanup:', error.message);
      }
    }

    // detach all pages
    for (const page of this._attachedPages.values()) {
      try {
        // Check if tab still exists before detaching
        const tab = await tabExists(page.tabId);
        if (tab) {
          logger.debug(`Detaching puppeteer from tab ${page.tabId}`);
          await page.detachPuppeteer();
        } else {
          logger.debug(`Tab ${page.tabId} no longer exists, skipping detach`);
        }
      } catch (error: any) {
        // Log but continue cleanup for other pages (ignore tab-not-found)
        const msg = String(error?.message || '');
        if (!msg.includes('No tab with') && !msg.includes('Invalid tab')) {
          logger.warning('Error detaching puppeteer during cleanup:', error.message);
        }
      }
    }

    // Always clear the maps even if detaching fails
    this._attachedPages.clear();
    this._currentTabId = null;
    this._ownedTabIds.clear();
    logger.debug('cleanup complete - tabs remain open');
  }

  public async attachPage(page: Page): Promise<boolean> {
    // check if page is already attached
    if (this._attachedPages.has(page.tabId)) {
      logger.debug('attachPage', page.tabId, 'already attached');
      return true;
    }

    if (await page.attachPuppeteer()) {
      logger.debug('attachPage', page.tabId, 'attached');
      // add page to managed pages
      this._attachedPages.set(page.tabId, page);
      return true;
    }
    return false;
  }

  public async detachPage(tabId: number): Promise<void> {
    // detach page
    const page = this._attachedPages.get(tabId);
    if (page) {
      try {
        await page.detachPuppeteer();
      } catch (error: any) {
        logger.warning(`Error detaching puppeteer for tab ${tabId}:`, error.message);
      } finally {
        // Always remove page from managed pages even if detach fails
        this._attachedPages.delete(tabId);
      }
    }
  }

  public async getCurrentPage(): Promise<Page> {
    // 1. If _currentTabId not set
    if (this._currentTabId === null || this._currentTabId === undefined) {
      // In worker mode (forceNewTab), do NOT auto-create any tab here; let navigate/openTab do it
      if (this._forceNewTab) {
        throw new Error('No worker tab bound yet');
      }
      // Single-agent mode: attach to active/any http(s) tab
      let activeTab: chrome.tabs.Tab | undefined;
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id) activeTab = tab;
      if (!activeTab) {
        const tabs = await chrome.tabs.query({});
        activeTab = tabs.find(t => !!t.id && !!t.url && /^https?:/i.test(t.url || ''));
      }
      if (!activeTab?.id) throw new Error('No suitable active tab found');
      logger.debug('active tab', activeTab.id, activeTab.url, activeTab.title);
      const page = await this._getOrCreatePage(activeTab);
      await this.attachPage(page);
      this._currentTabId = activeTab.id || null;
      try {
        await this.resolveVisibleGroupId();
      } catch {}
      return page;
    }

    // 2. If _currentTabId is set but not in attachedPages, attach the tab
    const existingPage = this._attachedPages.get(this._currentTabId);
    if (!existingPage) {
      // Verify tab still exists before trying to attach
      const tab = await tabExists(this._currentTabId);
      if (!tab) {
        // Tab no longer exists - clear state
        logger.debug(`getCurrentPage: Tab ${this._currentTabId} no longer exists`);
        this._attachedPages.delete(this._currentTabId);
        this._currentTabId = null;
        if (this._forceNewTab) {
          throw new Error('No worker tab bound yet');
        }
        throw new Error('Current tab no longer exists');
      }
      const page = await this._getOrCreatePage(tab);
      const attached = await this.attachPage(page);
      if (!attached) {
        // Could not attach (likely another debugger already attached). In worker mode,
        // clear current tab hint and signal upstream to open a fresh tab.
        this._currentTabId = null;
        if (this._forceNewTab) {
          throw new Error('No worker tab bound yet');
        }
        // Non-worker mode: return the page object without attachment (will use chrome.tabs.update flows)
        return page;
      }
      try {
        await this.resolveVisibleGroupId();
      } catch {}
      return page;
    }

    // 3. Return existing page from attachedPages (but verify tab still exists)
    const verifyTab = await tabExists(this._currentTabId);
    if (!verifyTab) {
      // Tab was closed while we had it attached - clean up
      logger.debug(`getCurrentPage: Cached tab ${this._currentTabId} no longer exists, cleaning up`);
      await this.detachPage(this._currentTabId);
      this._currentTabId = null;
      if (this._forceNewTab) {
        throw new Error('No worker tab bound yet');
      }
      throw new Error('Current tab no longer exists');
    }

    return existingPage;
  }

  /**
   * Get all tab IDs from the browser and the current window.
   * @returns A set of tab IDs.
   */
  public async getAllTabIds(): Promise<Set<number>> {
    const tabs = await this.queryScopedTabs();
    return new Set(tabs.map(tab => tab.id).filter(id => id !== undefined));
  }

  /**
   * Wait for tab events to occur after a tab is created or updated.
   * @param tabId - The ID of the tab to wait for events on.
   * @param options - An object containing options for the wait.
   * @returns A promise that resolves when the tab events occur.
   */
  private async waitForTabEvents(
    tabId: number,
    options: {
      waitForUpdate?: boolean;
      waitForActivation?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<void> {
    // Increase timeout and relax conditions for background tabs
    const { waitForUpdate = true, waitForActivation = true, timeoutMs = 15000 } = options;

    const promises: Promise<void>[] = [];

    if (waitForUpdate) {
      const updatePromise = new Promise<void>(resolve => {
        let hasUrl = false;
        let isComplete = false;

        const onUpdatedHandler = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (updatedTabId !== tabId) return;

          if (changeInfo.url) hasUrl = true;
          if (changeInfo.status === 'complete') isComplete = true;

          // Resolve when URL is known or load completed (title can lag for bg tabs)
          if (isComplete || hasUrl) {
            chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdatedHandler);

        // Check current state
        chrome.tabs.get(tabId).then(tab => {
          if (tab.url) hasUrl = true;
          if (tab.status === 'complete') isComplete = true;

          if (isComplete || hasUrl) {
            chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
            resolve();
          }
        });
      });
      promises.push(updatePromise);
    }

    if (waitForActivation) {
      const activatedPromise = new Promise<void>(resolve => {
        const onActivatedHandler = (activeInfo: chrome.tabs.TabActiveInfo) => {
          if (activeInfo.tabId === tabId) {
            chrome.tabs.onActivated.removeListener(onActivatedHandler);
            resolve();
          }
        };
        chrome.tabs.onActivated.addListener(onActivatedHandler);

        // Check current state
        chrome.tabs.get(tabId).then(tab => {
          if (tab.active) {
            chrome.tabs.onActivated.removeListener(onActivatedHandler);
            resolve();
          }
        });
      });
      promises.push(activatedPromise);
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tab operation timed out after ${timeoutMs} ms`)), timeoutMs),
    );

    await Promise.race([Promise.all(promises), timeoutPromise]);
  }

  public async switchTab(tabId: number): Promise<Page> {
    logger.debug('switchTab', tabId);
    // DO NOT switch tabs - removed to prevent forced tab switching
    // Enforce ownership in worker mode: a worker can only interact with tabs it owns
    if (this._forceNewTab) {
      if (!this._ownedTabIds.has(tabId)) {
        throw new Error(`Tab ${tabId} is not owned by this worker context`);
      }
    }

    // Verify tab exists before proceeding
    const tab = await tabExists(tabId);
    if (!tab) {
      throw new Error(`No tab with id: ${tabId}`);
    }

    await this.waitForTabEvents(tabId, { waitForUpdate: false, waitForActivation: false });

    const page = await this._getOrCreatePage(tab);
    await this.attachPage(page);
    this._currentTabId = tabId;
    return page;
  }

  /**
   * Get or attach a Page instance for a specific tab ID without changing the current tab.
   * Throws if the tab doesn't exist.
   */
  public async getPageByTabId(tabId: number): Promise<Page> {
    const tab = await tabExists(tabId);
    if (!tab) {
      throw new Error(`No tab with id: ${tabId}`);
    }
    const page = await this._getOrCreatePage(tab);
    await this.attachPage(page);
    return page;
  }

  public async navigateTo(url: string): Promise<void> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }
    // In worker mode with no bound tab yet, create a new tab with the target URL
    if (this._forceNewTab && (this._currentTabId === null || this._currentTabId === undefined)) {
      await this.openTab(url);
      return;
    }

    // Try to get current page, but handle worker mode gracefully
    let page: Page | null = null;
    try {
      page = await this.getCurrentPage();
    } catch (error: any) {
      // If in worker mode and no tab bound, create one
      if (error.message === 'No worker tab bound yet') {
        await this.openTab(url);
        return;
      }
      // Re-throw other errors
      throw error;
    }

    if (!page) {
      await this.openTab(url);
      return;
    }
    // if page is attached, use puppeteer to navigate to the url
    if (page.attached) {
      await page.navigateTo(url);
      return;
    }
    //  Use chrome.tabs.update only if the page is not attached
    const tabId = page.tabId;
    // Update tab and wait for events (best-effort)
    await chrome.tabs.update(tabId, { url }); // Do not force focus
    try {
      await this.waitForTabEvents(tabId, { waitForUpdate: true, waitForActivation: false });
    } catch (e) {
      logger.debug(`[BrowserContext] navigateTo waitForTabEvents timed out for tab ${tabId}, proceeding`);
    }

    // Reattach the page after navigation completes
    const updatedTab = await tabExists(tabId);
    if (!updatedTab) {
      throw new Error(`Tab ${tabId} no longer exists after navigation`);
    }
    const updatedPage = await this._getOrCreatePage(updatedTab, true);
    await this.attachPage(updatedPage);
    this._currentTabId = tabId;
    try {
      await this.resolveVisibleGroupId();
    } catch {}
  }

  public async openTab(url: string): Promise<Page> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`Open tab failed. URL: ${url} is not allowed`);
    }

    // Tab created in current window (user is always in a valid window via side panel)
    const tab = await chrome.tabs.create({ url, active: false });
    if (!tab.id) throw new Error('No tab ID available');

    // Add to preferred/current group if known
    if (typeof this._preferredGroupId === 'number') {
      try {
        await chrome.tabs.group({ tabIds: [tab.id], groupId: this._preferredGroupId });
        this._visibleGroupId = this._preferredGroupId;
      } catch {}
    } else if (this._currentTabId) {
      try {
        const current = await chrome.tabs.get(this._currentTabId);
        const gid = (current as any)?.groupId;
        if (typeof gid === 'number' && gid >= 0) {
          await chrome.tabs.group({ tabIds: [tab.id], groupId: gid });
          this._visibleGroupId = gid;
        }
      } catch {}
    }

    try {
      this._newTabCreated = tab.id;
    } catch {}
    if (this._forceNewTab) this._ownedTabIds.add(tab.id);

    try {
      await this.waitForTabEvents(tab.id, { waitForUpdate: true, waitForActivation: false });
    } catch {}

    const updatedTab = await chrome.tabs.get(tab.id);
    const page = await this._getOrCreatePage(updatedTab);
    await this.attachPage(page);
    this._currentTabId = tab.id;
    try {
      await this.resolveVisibleGroupId();
    } catch {}

    return page;
  }

  public async closeTab(tabId: number): Promise<void> {
    logger.debug(`closeTab called for tab ${tabId}`);
    await this.detachPage(tabId);
    await chrome.tabs.remove(tabId);
    logger.debug(`Tab ${tabId} removed`);
    // update current tab id if needed
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  /**
   * Remove a tab from the attached pages map. This will not run detachPuppeteer.
   * @param tabId - The ID of the tab to remove.
   */
  public removeAttachedPage(tabId: number): void {
    this._attachedPages.delete(tabId);
    // update current tab id if needed
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  public async getTabInfos(): Promise<TabInfo[]> {
    const tabs = await this.queryScopedTabs();
    const tabInfos: TabInfo[] = [];

    for (const tab of tabs) {
      if (tab.id && tab.url && tab.title) {
        tabInfos.push({
          id: tab.id,
          url: tab.url,
          title: tab.title,
        });
      }
    }
    return tabInfos;
  }

  public async getCachedState(useVision = false, cacheClickableElementsHashes = false): Promise<BrowserState> {
    // In worker mode without a bound tab, return a placeholder state to allow planning
    if (this._forceNewTab && (this._currentTabId === null || this._currentTabId === undefined)) {
      const blank = build_initial_state();
      return { ...blank, tabs: [] } as BrowserState;
    }

    try {
      const currentPage = await this.getCurrentPage();
      let pageState = !currentPage ? build_initial_state() : currentPage.getCachedState();
      if (!pageState) {
        pageState = await currentPage.getState(useVision, cacheClickableElementsHashes);
      }
      const tabInfos = await this.getTabInfos();
      const browserState: BrowserState = { ...pageState, tabs: tabInfos };
      return browserState;
    } catch (e) {
      // Fallback to placeholder in any failure case
      const blank = build_initial_state();
      return { ...blank, tabs: [] } as BrowserState;
    }
  }

  public async getState(useVision = false, cacheClickableElementsHashes = false): Promise<BrowserState> {
    // In worker mode without a bound tab, return a placeholder state to allow planning
    if (this._forceNewTab && (this._currentTabId === null || this._currentTabId === undefined)) {
      const blank = build_initial_state();
      return { ...blank, tabs: [] } as BrowserState;
    }

    try {
      const currentPage = await this.getCurrentPage();
      const pageState = !currentPage
        ? build_initial_state()
        : await currentPage.getState(useVision, cacheClickableElementsHashes);
      const tabInfos = await this.getTabInfos();
      const browserState: BrowserState = { ...pageState, tabs: tabInfos };
      return browserState;
    } catch (e) {
      const blank = build_initial_state();
      return { ...blank, tabs: [] } as BrowserState;
    }
  }

  /**
   * Get browser state with minimal DOM work: reuse cached state when URL unchanged;
   * refresh only when URL changed or cache is empty.
   */
  public async getSmartState(useVision = false, cacheClickableElementsHashes = false): Promise<BrowserState> {
    // In worker mode without a bound tab, return a placeholder state to allow planning
    if (this._forceNewTab && (this._currentTabId === null || this._currentTabId === undefined)) {
      const blank = build_initial_state();
      return { ...blank, tabs: [] } as BrowserState;
    }

    try {
      const currentPage = await this.getCurrentPage();
      let pageState = currentPage.getCachedState();
      try {
        const tab = await chrome.tabs.get(currentPage.tabId);
        const currentUrl = tab.url || '';
        if (!pageState || (pageState.url || '') !== currentUrl) {
          pageState = await currentPage.getState(useVision, cacheClickableElementsHashes);
        }
      } catch {
        // Fallback: compute fresh state
        pageState = await currentPage.getState(useVision, cacheClickableElementsHashes);
      }
      const tabInfos = await this.getTabInfos();
      const browserState: BrowserState = { ...pageState, tabs: tabInfos } as BrowserState;
      return browserState;
    } catch (e) {
      const blank = build_initial_state();
      return { ...blank, tabs: [] } as BrowserState;
    }
  }

  public async removeHighlight(): Promise<void> {
    try {
      const page = await this.getCurrentPage();
      if (page) {
        await page.removeHighlight();
      }
    } catch (error: any) {
      // In worker mode before any tab is bound, ignore this gracefully
      if (error?.message === 'No worker tab bound yet') return;
      throw error;
    }
  }

  public getAndClearNewTabCreated(): number | null {
    const tabId = this._newTabCreated;
    this._newTabCreated = null;
    return tabId;
  }

  /**
   * Register a tab as owned by this BrowserContext (used when clicks open new tabs).
   */
  public registerOwnedTab(tabId: number): void {
    try {
      if (this._forceNewTab && typeof tabId === 'number') {
        this._ownedTabIds.add(tabId);
      }
    } catch {}
  }
}
