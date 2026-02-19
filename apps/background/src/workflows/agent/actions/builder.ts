import { ActionResult, type AgentContext } from '@src/workflows/shared/agent-types';
import {
  clickElementActionSchema,
  doneActionSchema,
  goBackActionSchema,
  goToUrlActionSchema,
  inputTextActionSchema,
  openTabActionSchema,
  extractPageMarkdownActionSchema,
  scrollToSelectorActionSchema,
  clickSelectorActionSchema,
  findAndClickTextActionSchema,
  quickTextScanActionSchema,
  searchGoogleActionSchema,
  extractGoogleResultsActionSchema,
  switchTabActionSchema,
  type ActionSchema,
  sendKeysActionSchema,
  scrollToTextActionSchema,
  cacheContentActionSchema,
  selectDropdownOptionActionSchema,
  getDropdownOptionsActionSchema,
  closeTabActionSchema,
  waitActionSchema,
  previousPageActionSchema,
  scrollToPercentActionSchema,
  nextPageActionSchema,
  scrollToTopActionSchema,
  scrollToBottomActionSchema,
  requestUserControlActionSchema,
} from './schemas';
import { resolveSearchUrl } from '@src/utils/search-pattern-resolver';

const isLegacyNavigation = process.env.__LEGACY_NAVIGATION__ === 'true';
import { z } from 'zod';
import { createLogger } from '@src/log';
import { ExecutionState, Actors } from '@src/workflows/shared/event/types';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { wrapUntrustedContent } from '@src/workflows/shared/messages/utils';
import { getMarkdownContent, getReadabilityContent } from '@src/browser/dom/service';
import { RequestCancelledError } from '@src/workflows/shared/agent-errors';

const logger = createLogger('Action');

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/**
 * An action is a function that takes an input and returns an ActionResult
 */
export class Action {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handler: (input: any) => Promise<ActionResult>,
    public readonly schema: ActionSchema,
    // Whether this action has an index argument
    public readonly hasIndex: boolean = false,
  ) {}

  async call(input: unknown): Promise<ActionResult> {
    // Validate input before calling the handler
    const schema = this.schema.schema;

    // check if the schema is schema: z.object({}), if so, ignore the input
    const isEmptySchema =
      schema instanceof z.ZodObject &&
      Object.keys((schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape || {}).length === 0;

    if (isEmptySchema) {
      return await this.handler({});
    }

    const parsedArgs = this.schema.schema.safeParse(input);
    if (!parsedArgs.success) {
      const errorMessage = parsedArgs.error.message;
      throw new InvalidInputError(errorMessage);
    }
    return await this.handler(parsedArgs.data);
  }

  name() {
    return this.schema.name;
  }

  /**
   * Returns the prompt for the action
   * @returns {string} The prompt for the action
   */
  prompt() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemaShape = (this.schema.schema as z.ZodObject<any>).shape || {};
    const schemaProperties = Object.entries(schemaShape).map(([key, value]) => {
      const zodValue = value as z.ZodTypeAny;
      return `'${key}': {'type': '${zodValue.description}', ${zodValue.isOptional() ? "'optional': true" : "'required': true"}}`;
    });

    const schemaStr =
      schemaProperties.length > 0 ? `{${this.name()}: {${schemaProperties.join(', ')}}}` : `{${this.name()}: {}}`;

    return `${this.schema.description}:\n${schemaStr}`;
  }

  /**
   * Get the index argument from the input if this action has an index
   * @param input The input to extract the index from
   * @returns The index value if found, null otherwise
   */
  getIndexArg(input: unknown): number | null {
    if (!this.hasIndex) {
      return null;
    }
    if (input && typeof input === 'object' && 'index' in input) {
      return (input as { index: number }).index;
    }
    return null;
  }

  /**
   * Set the index argument in the input if this action has an index
   * @param input The input to update the index in
   * @param newIndex The new index value to set
   * @returns Whether the index was set successfully
   */
  setIndexArg(input: unknown, newIndex: number): boolean {
    if (!this.hasIndex) {
      return false;
    }
    if (input && typeof input === 'object') {
      (input as { index: number }).index = newIndex;
      return true;
    }
    return false;
  }
}

export function buildDynamicActionSchema(actions: Action[]): z.ZodType {
  let schema = z.object({});
  for (const action of actions) {
    // create a schema for the action, it could be action.schema.schema or null
    // but don't use default: null as it causes issues with Google Generative AI
    const actionSchema = action.schema.schema;
    schema = schema.extend({
      [action.name()]: actionSchema.nullable().optional().describe(action.schema.description),
    });
  }
  return schema;
}

export class ActionBuilder {
  private readonly context: AgentContext;
  private readonly extractorLLM: BaseChatModel;

  constructor(context: AgentContext, extractorLLM: BaseChatModel) {
    this.context = context;
    this.extractorLLM = extractorLLM;
  }

  private checkCancelled(): void {
    if (this.context.stopped) {
      throw new RequestCancelledError('AbortError: request was aborted');
    }
  }

  buildDefaultActions() {
    const actions = [];

    const done = new Action(async (input: z.infer<typeof doneActionSchema.schema>) => {
      this.checkCancelled();
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, doneActionSchema.name);
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, input.text);
      return new ActionResult({
        isDone: true,
        extractedContent: input.text,
      });
    }, doneActionSchema);
    actions.push(done);

    const searchGoogle = new Action(async (input: z.infer<typeof searchGoogleActionSchema.schema>) => {
      this.checkCancelled();
      const context = this.context;
      const intent = input.intent || `Searching for "${input.query}" in Google`;
      context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      // Perform a direct Google search navigation without opening a blank/neutral page first
      const encoded = String(input.query || '')
        .trim()
        .split(/\s+/g)
        .join('+');
      const searchUrl = `https://www.google.com/search?q=${encoded}`;
      await context.browserContext.navigateTo(searchUrl);
      this.checkCancelled();
      // If this created a new tab (first navigation in worker mode), emit TAB_CREATED so grouping/mirroring starts
      try {
        const createdId = context.browserContext.getAndClearNewTabCreated();
        if (typeof createdId === 'number' && createdId > 0) {
          context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.TAB_CREATED, `Created tab ${createdId}`, {
            tabId: createdId,
            taskId: context.taskId,
          });
        }
      } catch {}

      // Track URL for site skill injection
      context.addSkillUrl(searchUrl);

      const msg2 = `Searched for "${input.query}" in Google`;
      context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.STEP_OK, msg2);
      return new ActionResult({ extractedContent: msg2, includeInMemory: true });
    }, searchGoogleActionSchema);
    actions.push(searchGoogle);

    const extractGoogleResults = new Action(async (input: z.infer<typeof extractGoogleResultsActionSchema.schema>) => {
      this.checkCancelled();
      const context = this.context;
      const intent = input.intent || `Extracting top Google results`;
      context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      let list: Array<{ title: string; url: string }> = [];
      let fromCache = false;
      try {
        const page = await context.browserContext.getCurrentPage();
        const url = page.url().toLowerCase();
        if (!/google\.[^/]+\/search/.test(url) && !/tbm=/.test(url)) {
          // Not obviously on a Google SERP
          context.emitEvent(
            Actors.AGENT_NAVIGATOR,
            ExecutionState.ACT_FAIL,
            'Current page does not appear to be a Google results page; perform search first',
          );
          return new ActionResult({
            error: 'Not on a Google SERP. Use search_google or navigate to Google results before extraction.',
            includeInMemory: true,
          });
        }

        const meta = (await (page as any).getGoogleSearchResultsWithMeta?.(
          Math.max(1, Math.min(20, input.max_results || 10)),
        )) ?? {
          items: await page.getGoogleSearchResults(Math.max(1, Math.min(20, input.max_results || 10))),
          fromCache: false,
        };
        list = meta.items;
        fromCache = !!meta.fromCache;
      } catch (e) {
        const msg = `Failed to extract Google results: ${e instanceof Error ? e.message : String(e)}`;
        context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }

      // Canonical strict JSON payload for downstream workers - wrap as untrusted
      const payload = {
        type: 'search_links',
        links: list.map(({ title, url }) => ({ title, url })),
        urls: list.map(({ url }) => url),
      };
      const formatted = JSON.stringify(payload);
      const wrappedContent = wrapUntrustedContent(formatted);

      const msg = `Extracted ${list.length} Google results${fromCache ? ' (cached)' : ''}`;
      context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: wrappedContent, includeInMemory: !fromCache, success: true });
    }, extractGoogleResultsActionSchema);
    actions.push(extractGoogleResults);

    const goToUrl = new Action(async (input: z.infer<typeof goToUrlActionSchema.schema>) => {
      this.checkCancelled();

      let finalUrl: string;
      let msg: string;

      if (isLegacyNavigation) {
        // Legacy mode: simple navigation without search pattern resolution
        const intent = input.intent || `Navigating to ${input.url}`;
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

        await this.context.browserContext.navigateTo(input.url);
        finalUrl = input.url;
        msg = `Navigated to ${input.url}`;
      } else {
        // New mode: resolve URL with search pattern if search_query provided
        const resolved = resolveSearchUrl(input.url, input.search_query);

        const intent =
          input.intent ||
          (resolved.patternApplied
            ? `Searching "${input.search_query}" on ${resolved.domain}`
            : `Navigating to ${input.url}`);
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

        finalUrl = resolved.url;
        try {
          await this.context.browserContext.navigateTo(finalUrl);
        } catch (err) {
          // If search URL failed, fall back to base URL
          if (resolved.patternApplied) {
            finalUrl = input.url.startsWith('http') ? input.url : `https://${input.url}`;
            await this.context.browserContext.navigateTo(finalUrl);
          } else {
            throw err;
          }
        }

        msg = resolved.patternApplied
          ? `Navigated to ${resolved.domain} search results for "${input.search_query}"`
          : `Navigated to ${finalUrl}`;
      }

      this.checkCancelled();
      // If this created a new tab (first navigation in worker mode), emit TAB_CREATED so grouping/mirroring starts
      try {
        const created = this.context.browserContext.getAndClearNewTabCreated();
        if (typeof created === 'number' && created > 0) {
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.TAB_CREATED, `Created tab ${created}`, {
            tabId: created,
            taskId: this.context.taskId,
          });
        }
      } catch {}

      // Track URL for site skill injection
      this.context.addSkillUrl(finalUrl);

      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);

      return new ActionResult({
        extractedContent: msg,
        includeInMemory: true,
      });
    }, goToUrlActionSchema);
    actions.push(goToUrl);

    // Extract readable content to Markdown/Text (non-interactive fast path)
    const extractPageMarkdown = new Action(async (input: z.infer<typeof extractPageMarkdownActionSchema.schema>) => {
      this.checkCancelled();
      const context = this.context;
      const intent = input.intent || 'Extracting readable page content';
      context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await context.browserContext.getCurrentPage();
      const tabId = page.tabId;

      const prefer = input.prefer || 'markdown';
      const selector = input.selector && input.selector.trim().length > 0 ? input.selector : undefined;
      const maxChars = typeof input.max_chars === 'number' ? input.max_chars : 20000;
      const format = input.format || 'markdown';

      let content = '';
      let strategyUsed: 'readability' | 'markdown' | 'fallback' = 'markdown';
      try {
        // Strategy 1: Direct markdown extraction (clean, structured)
        if (prefer === 'markdown' || prefer === 'auto') {
          try {
            const md = await getMarkdownContent(tabId, selector);
            content = md || '';
            if (content && content.trim().length > 100) {
              strategyUsed = 'markdown';
            }
          } catch {}
        }

        // Strategy 2: Readability fallback (if markdown insufficient)
        if ((!content || content.trim().length < 100) && (prefer === 'readability' || prefer === 'auto')) {
          try {
            const r = await getReadabilityContent(tabId);
            // Prefer textContent over HTML for readability
            content = (r && (r.textContent || r.content)) || '';
            if (content && content.trim().length > 0) {
              strategyUsed = 'readability';
            }
          } catch {}
        }
      } catch (e) {
        strategyUsed = 'fallback';
        content = e instanceof Error ? e.message : String(e);
      }

      if (format === 'text') {
        content = content
          .replace(/```[\s\S]*?```/g, '')
          .replace(/[\t ]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n');
      }

      let truncated = false;
      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + '\n\n…[truncated]';
        truncated = true;
      }

      // Check if extraction actually got content
      const gotContent = content.trim().length > 0;
      const summary = gotContent
        ? `Extracted ${content.length} chars (${strategyUsed}${truncated ? ', truncated' : ''})`
        : `Extraction returned 0 characters (${strategyUsed} - page may not be loaded or main content not found)`;

      context.emitEvent(Actors.AGENT_NAVIGATOR, gotContent ? ExecutionState.ACT_OK : ExecutionState.ACT_FAIL, summary);

      // Format the result with appropriate status
      if (!gotContent) {
        return new ActionResult({
          error: `Extraction failed: ${summary}. The page may still be loading, or no main content area was found. Try waiting for the page to load, scrolling to see content, or using a different extraction strategy.`,
          includeInMemory: true,
        });
      }

      // Format the extracted content with clear metadata header, wrap as untrusted
      const metadataHeader = `Extraction completed successfully. Format: ${format}. Strategy: ${strategyUsed}. Length: ${content.length} characters${truncated ? ' (truncated)' : ''}.`;
      const wrappedContent = wrapUntrustedContent(content);
      const formattedContent = `${metadataHeader}\n\nExtracted content (${format}):\n${wrappedContent}`;

      return new ActionResult({
        extractedContent: formattedContent,
        includeInMemory: false, // Don't persist in permanent memory - agent should process and use cache_content
      });
    }, extractPageMarkdownActionSchema);
    actions.push(extractPageMarkdown);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const goBack = new Action(async (input: z.infer<typeof goBackActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || 'Navigating back';
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      await page.goBack();
      const msg2 = 'Navigated back';
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, goBackActionSchema);
    actions.push(goBack);

    const wait = new Action(async (input: z.infer<typeof waitActionSchema.schema>) => {
      this.checkCancelled();
      const seconds = input.seconds || 3;
      const intent = input.intent || `Waiting for ${seconds} seconds`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);
      const totalMs = Math.max(0, Math.floor(seconds * 1000));
      const step = 100;
      for (let elapsed = 0; elapsed < totalMs; elapsed += step) {
        this.checkCancelled();
        await new Promise(resolve => setTimeout(resolve, step));
      }
      const msg = `${seconds} seconds elapsed`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, waitActionSchema);
    actions.push(wait);

    // Element Interaction Actions
    const clickElement = new Action(
      async (input: z.infer<typeof clickElementActionSchema.schema>) => {
        this.checkCancelled();
        const intent = input.intent || `Click element with index ${input.index}`;
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          throw new Error(`Element with index ${input.index} does not exist - retry or use alternative actions`);
        }

        // Check if element is a file uploader
        if (page.isFileUploader(elementNode)) {
          const msg = `Index ${input.index} - has an element which opens file upload dialog. To upload files please use a specific function to upload files`;
          logger.info(msg);
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        }

        try {
          const initialTabIds = await this.context.browserContext.getAllTabIds();
          this.checkCancelled();
          await page.clickElementNode(this.context.options.useVision, elementNode);
          this.checkCancelled();
          let msg = `Clicked button with index ${input.index}: ${elementNode.getAllTextTillNextClickableElement(2)}`;
          logger.info(msg);

          const currentTabIds = await this.context.browserContext.getAllTabIds();
          if (currentTabIds.size > initialTabIds.size) {
            const newTabMsg = 'New tab opened';
            msg += ` - ${newTabMsg}`;
            logger.info(newTabMsg);
            // DO NOT switch to new tab - let user control their browsing
            // find the tab id that is not in the initial tab ids
            const newTabId = Array.from(currentTabIds).find(id => !initialTabIds.has(id));
            if (newTabId) {
              // Inform TaskManager to group/mirror this new tab
              try {
                this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.TAB_CREATED, `Created tab ${newTabId}`, {
                  tabId: Number(newTabId),
                });
              } catch {}
              // Register ownership for worker contexts
              try {
                this.context.browserContext.registerOwnedTab(Number(newTabId));
              } catch {}
              // Just log it, don't switch
              logger.info(`New tab ${newTabId} opened but not switching to it`);
            }
          }
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        } catch (error) {
          const msg = `Element no longer available with index ${input.index} - most likely the page changed`;
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, msg);
          return new ActionResult({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      clickElementActionSchema,
      true,
    );
    actions.push(clickElement);

    const inputText = new Action(
      async (input: z.infer<typeof inputTextActionSchema.schema>) => {
        this.checkCancelled();
        const intent = input.intent || `Input text into index ${input.index}`;
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          throw new Error(`Element with index ${input.index} does not exist - retry or use alternative actions`);
        }

        await page.inputTextElementNode(this.context.options.useVision, elementNode, input.text);
        const msg = `Input ${input.text} into index ${input.index}`;
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      },
      inputTextActionSchema,
      true,
    );
    actions.push(inputText);

    // Tab Management Actions
    const switchTab = new Action(async (input: z.infer<typeof switchTabActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Switching to tab ${input.tab_id}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);
      await this.context.browserContext.switchTab(input.tab_id);
      const msg = `Switched to tab ${input.tab_id}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, switchTabActionSchema);
    actions.push(switchTab);

    const openTab = new Action(async (input: z.infer<typeof openTabActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Opening ${input.url}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      // Always open a new tab - that's the purpose of this action.
      // Use go_to_url if you want to navigate within the current tab.
      const page = await this.context.browserContext.openTab(input.url);
      this.checkCancelled();

      // Track URL for site skill injection
      this.context.addSkillUrl(input.url);

      const msg = `Opened ${input.url} in new tab`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.TAB_CREATED, `Created tab ${page.tabId}`, {
        tabId: page.tabId,
        taskId: this.context.taskId,
      });
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, openTabActionSchema);
    actions.push(openTab);

    // Jump-to-target: scroll_to_selector
    const scrollToSelector = new Action(async (input: z.infer<typeof scrollToSelectorActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Scroll to selector '${input.selector}'`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      const nth = typeof input.nth === 'number' && input.nth > 0 ? input.nth : 1;
      const ok = await page.scrollToSelector(input.selector, nth);
      const msg = ok
        ? `Scrolled to selector '${input.selector}'${nth > 1 ? ` (#${nth})` : ''}`
        : `Selector '${input.selector}' not found or not visible${nth > 1 ? ` (#${nth})` : ''}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ok ? ExecutionState.ACT_OK : ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true, success: ok });
    }, scrollToSelectorActionSchema);
    actions.push(scrollToSelector);

    // Jump-to-target: click_selector
    const clickSelector = new Action(async (input: z.infer<typeof clickSelectorActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Click selector '${input.selector}'`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      const nth = typeof input.nth === 'number' && input.nth > 0 ? input.nth : 1;
      const ok = await page.clickSelector(input.selector, nth, this.context.options.useVision);
      const msg = ok
        ? `Clicked selector '${input.selector}'${nth > 1 ? ` (#${nth})` : ''}`
        : `Selector '${input.selector}' not clickable${nth > 1 ? ` (#${nth})` : ''}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ok ? ExecutionState.ACT_OK : ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true, success: ok });
    }, clickSelectorActionSchema);
    actions.push(clickSelector);

    // Jump-to-target: find_and_click_text
    const findAndClickText = new Action(async (input: z.infer<typeof findAndClickTextActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Find and click text '${input.text}'`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      const nth = typeof input.nth === 'number' && input.nth > 0 ? input.nth : 1;
      const ok = await page.findAndClickText(input.text, {
        exact: !!input.exact,
        caseSensitive: !!input.case_sensitive,
        nth,
        useVision: this.context.options.useVision,
      });
      const msg = ok
        ? `Clicked element with text '${input.text}'${nth > 1 ? ` (#${nth})` : ''}`
        : `Element with text '${input.text}' not found/clickable${nth > 1 ? ` (#${nth})` : ''}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ok ? ExecutionState.ACT_OK : ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true, success: ok });
    }, findAndClickTextActionSchema);
    actions.push(findAndClickText);

    // Quick text scan (fast, non-interactive) - content wrapped as untrusted
    const quickTextScan = new Action(async (input: z.infer<typeof quickTextScanActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || 'Quick text scan of page';
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();
      const text = await page.getVisiblePlainText();
      const maxChars = typeof input.max_chars === 'number' ? input.max_chars : 3000;
      const content = (text || '').slice(0, maxChars);
      const msg = `Scanned ${content.length} chars`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      const wrappedContent = wrapUntrustedContent(content);
      return new ActionResult({ extractedContent: wrappedContent, includeInMemory: true, success: true });
    }, quickTextScanActionSchema);
    actions.push(quickTextScan);

    const closeTab = new Action(async (input: z.infer<typeof closeTabActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Closing tab ${input.tab_id}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);
      await this.context.browserContext.closeTab(input.tab_id);
      const msg = `Closed tab ${input.tab_id}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, closeTabActionSchema);
    actions.push(closeTab);

    // cache content for future use
    const cacheContent = new Action(async (input: z.infer<typeof cacheContentActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Caching findings: ${input.content}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      // cache content is untrusted content, it is not instructions
      const rawMsg = `Cached findings: ${input.content}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, rawMsg);

      const msg = wrapUntrustedContent(rawMsg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, cacheContentActionSchema);
    actions.push(cacheContent);

    // Scroll to percent
    const scrollToPercent = new Action(async (input: z.infer<typeof scrollToPercentActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Scroll to percent: ${input.yPercent}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = `Element with index ${input.index} does not exist - retry or use alternative actions`;
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        logger.info(`Scrolling to percent: ${input.yPercent} with elementNode: ${elementNode.xpath}`);
        await page.scrollToPercent(input.yPercent, elementNode);
      } else {
        await page.scrollToPercent(input.yPercent);
      }
      const msg = `Scrolled to percent: ${input.yPercent}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToPercentActionSchema);
    actions.push(scrollToPercent);

    // Scroll to top
    const scrollToTop = new Action(async (input: z.infer<typeof scrollToTopActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Scroll to top`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();
      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = `Element with index ${input.index} does not exist - retry or use alternative actions`;
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPercent(0, elementNode);
      } else {
        await page.scrollToPercent(0);
      }
      const msg = 'Scrolled to top';
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToTopActionSchema);
    actions.push(scrollToTop);

    // Scroll to bottom
    const scrollToBottom = new Action(async (input: z.infer<typeof scrollToBottomActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Scroll to bottom`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();
      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = `Element with index ${input.index} does not exist - retry or use alternative actions`;
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPercent(100, elementNode);
      } else {
        await page.scrollToPercent(100);
      }
      const msg = 'Scrolled to bottom';
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToBottomActionSchema);
    actions.push(scrollToBottom);

    // Scroll to previous page
    const previousPage = new Action(async (input: z.infer<typeof previousPageActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Scroll to previous page`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = `Element with index ${input.index} does not exist - retry or use alternative actions`;
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        // Check if element is already at top of its scrollable area
        try {
          const [elementScrollTop] = await page.getElementScrollInfo(elementNode);
          if (elementScrollTop === 0) {
            const msg = `Element with index ${input.index} is already at top, cannot scroll to previous page`;
            this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
            return new ActionResult({ extractedContent: msg, includeInMemory: true });
          }
        } catch (error) {
          // If we can't get scroll info, let the scrollToPreviousPage method handle it
          logger.warning(
            `Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        await page.scrollToPreviousPage(elementNode);
      } else {
        // Check if page is already at top
        const [initialScrollY] = await page.getScrollInfo();
        if (initialScrollY === 0) {
          const msg = 'Already at top of page, cannot scroll to previous page';
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }

        await page.scrollToPreviousPage();
      }
      const msg = 'Scrolled to previous page';
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, previousPageActionSchema);
    actions.push(previousPage);

    // Scroll to next page
    const nextPage = new Action(async (input: z.infer<typeof nextPageActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Scroll to next page`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = `Element with index ${input.index} does not exist - retry or use alternative actions`;
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        // Check if element is already at bottom of its scrollable area
        try {
          const [elementScrollTop, elementClientHeight, elementScrollHeight] =
            await page.getElementScrollInfo(elementNode);
          if (elementScrollTop + elementClientHeight >= elementScrollHeight) {
            const msg = `Element with index ${input.index} is already at bottom, cannot scroll to next page`;
            this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
            return new ActionResult({ extractedContent: msg, includeInMemory: true });
          }
        } catch (error) {
          // If we can't get scroll info, let the scrollToNextPage method handle it
          logger.warning(
            `Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        await page.scrollToNextPage(elementNode);
      } else {
        // Check if page is already at bottom
        const [initialScrollY, initialVisualViewportHeight, initialScrollHeight] = await page.getScrollInfo();
        if (initialScrollY + initialVisualViewportHeight >= initialScrollHeight) {
          const msg = 'Already at bottom of page, cannot scroll to next page';
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }

        await page.scrollToNextPage();
      }
      const msg = 'Scrolled to next page';
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, nextPageActionSchema);
    actions.push(nextPage);

    // Scroll to text
    const scrollToText = new Action(async (input: z.infer<typeof scrollToTextActionSchema.schema>) => {
      this.checkCancelled();
      const intent =
        input.intent ||
        `Scroll to text: ${input.text}${input.nth > 1 ? ` (${input.nth}${input.nth === 2 ? 'nd' : input.nth === 3 ? 'rd' : 'th'} occurrence)` : ''}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      try {
        const scrolled = await page.scrollToText(input.text, input.nth);
        const msg = scrolled
          ? `Scrolled to text: ${input.text}${input.nth > 1 ? ` (${input.nth}${input.nth === 2 ? 'nd' : input.nth === 3 ? 'rd' : 'th'} occurrence)` : ''}`
          : `Text '${input.text}' not found or not visible on page${input.nth > 1 ? ` (${input.nth}${input.nth === 2 ? 'nd' : input.nth === 3 ? 'rd' : 'th'} occurrence)` : ''}`;
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      } catch (error) {
        const msg = `Failed to scroll to text: ${error instanceof Error ? error.message : String(error)}`;
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
    }, scrollToTextActionSchema);
    actions.push(scrollToText);

    // Keyboard Actions
    const sendKeys = new Action(async (input: z.infer<typeof sendKeysActionSchema.schema>) => {
      this.checkCancelled();
      const intent = input.intent || `Send keys: ${input.keys}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      await page.sendKeys(input.keys);
      const msg = `Sent keys: ${input.keys}`;
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, sendKeysActionSchema);
    actions.push(sendKeys);

    // Get all options from a native dropdown
    const getDropdownOptions = new Action(
      async (input: z.infer<typeof getDropdownOptionsActionSchema.schema>) => {
        this.checkCancelled();
        const intent = input.intent || `Getting options from dropdown with index ${input.index}`;
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = `Element with index ${input.index} does not exist - retry or use alternative actions`;
          logger.error(errorMsg);
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        try {
          // Use the existing getDropdownOptions method
          const options = await page.getDropdownOptions(input.index);

          if (options && options.length > 0) {
            // Format options for display
            const formattedOptions: string[] = options.map(opt => {
              // Encoding ensures AI uses the exact string in select_dropdown_option
              const encodedText = JSON.stringify(opt.text);
              return `${opt.index}: text=${encodedText}`;
            });

            let msg = formattedOptions.join('\n');
            msg += '\nUse the exact text string in select_dropdown_option';
            logger.info(msg);
            this.context.emitEvent(
              Actors.AGENT_NAVIGATOR,
              ExecutionState.ACT_OK,
              `Got ${options.length} options from dropdown`,
            );
            return new ActionResult({
              extractedContent: msg,
              includeInMemory: true,
            });
          }

          // This code should not be reached as getDropdownOptions throws an error when no options found
          // But keeping as fallback
          const msg = 'No options found in dropdown';
          logger.info(msg);
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        } catch (error) {
          const errorMsg = `Failed to get dropdown options: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }
      },
      getDropdownOptionsActionSchema,
      true,
    );
    actions.push(getDropdownOptions);

    // Select dropdown option for interactive element index by the text of the option you want to select'
    const selectDropdownOption = new Action(
      async (input: z.infer<typeof selectDropdownOptionActionSchema.schema>) => {
        this.checkCancelled();
        const intent = input.intent || `Select option "${input.text}" from dropdown with index ${input.index}`;
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = `Element with index ${input.index} does not exist - retry or use alternative actions`;
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        // Validate that we're working with a select element
        if (!elementNode.tagName || elementNode.tagName.toLowerCase() !== 'select') {
          const errorMsg = `Cannot select option: Element with index ${input.index} is a ${elementNode.tagName || 'unknown'}, not a SELECT`;
          logger.error(errorMsg);
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        logger.debug(`Attempting to select '${input.text}' using xpath: ${elementNode.xpath}`);
        logger.debug(`Element attributes: ${JSON.stringify(elementNode.attributes)}`);
        logger.debug(`Element tag: ${elementNode.tagName}`);

        try {
          const result = await page.selectDropdownOption(input.index, input.text);
          const msg = `Selected option "${input.text}" from dropdown with index ${input.index}`;
          logger.info(msg);
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({
            extractedContent: result,
            includeInMemory: true,
          });
        } catch (error) {
          const errorMsg = `Failed to select option: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }
      },
      selectDropdownOptionActionSchema,
      true,
    );
    actions.push(selectDropdownOption);

    // Request user control (Human-in-the-loop) - disabled in API mode
    if (requestUserControlActionSchema) {
      const schema = requestUserControlActionSchema;
      const requestUserControl = new Action(async (input: z.infer<typeof schema.schema>) => {
        const intent = input.intent || 'Requesting human intervention';
        const reason = input.reason || 'User oversight requested';
        let tabId = input.tab_id ?? null;
        try {
          if (tabId === null) {
            const page = await this.context.browserContext.getCurrentPage();
            tabId = page?.tabId ?? null;
          }
        } catch {}

        // Emit pause event with message and optional tabId
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_PAUSE, intent, {
          message: JSON.stringify({ type: 'request_user_control', reason, tabId }),
          tabId: tabId ?? undefined,
        });

        // Actually pause the executor loop
        await this.context.pause();

        const msg = `Paused for human intervention${tabId ? ` on tab ${tabId}` : ''}: ${reason}`;
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }, requestUserControlActionSchema);
      actions.push(requestUserControl);
    }

    return actions;
  }
}
