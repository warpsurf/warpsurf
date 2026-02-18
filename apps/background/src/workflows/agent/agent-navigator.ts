import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from '../shared/base-agent';
import { createLogger } from '@src/log';
import { ActionResult, type AgentOutput } from '../shared/agent-types';
import type { Action } from './actions/builder';
import { buildDynamicActionSchema } from './actions/builder';
import { agentBrainSchema } from '../shared/agent-types';
import { type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { Actors } from '@src/workflows/shared/event/types';
import { ExecutionState } from '@extension/shared/lib/utils';
import {
  EXTENSION_CONFLICT_ERROR_MESSAGE,
  ExtensionConflictError,
  isAbortedError,
  isExtensionConflictError,
  isTimeoutError,
  RequestCancelledError,
} from '../shared/agent-errors';
import { calcBranchPathHashSet } from '@src/browser/dom/views';
import { type BrowserState, BrowserStateHistory, URLNotAllowedError } from '@src/browser/views';
import { convertZodToJsonSchema, repairJsonString } from '@src/utils';
import { HistoryTreeProcessor } from '@src/browser/dom/history/service';
import { AgentStepRecord } from '@src/workflows/shared/step-history';
import { type DOMHistoryElement } from '@src/browser/dom/history/view';
import { globalTokenTracker } from '@src/utils/token-tracker';

const logger = createLogger('AgentNavigator');

/** Action-specific delays (ms) - fast actions use minimal delays, navigation actions use longer delays */
const ACTION_DELAYS: Record<string, number> = {
  go_to_url: 800,
  search_google: 800,
  open_tab: 600,
  click_element: 500,
  click_selector: 400,
  find_and_click_text: 400,
  input_text: 100,
  send_keys: 100,
  scroll_to_percent: 150,
  scroll_to_top: 100,
  scroll_to_bottom: 100,
  scroll_up: 100,
  scroll_down: 100,
  next_page: 150,
  previous_page: 150,
  cache_content: 50,
  extract_page_markdown: 200,
  extract_google_results: 200,
  quick_text_scan: 100,
  wait: 0, // wait action handles its own timing
  done: 0,
};

interface ParsedModelOutput {
  current_state?: {
    next_goal?: string;
  };
  action?: (Record<string, unknown> | null)[] | null;
}

export class NavigatorActionRegistry {
  private actions: Record<string, Action> = {};

  constructor(actions: Action[]) {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  registerAction(action: Action): void {
    this.actions[action.name()] = action;
  }

  unregisterAction(name: string): void {
    delete this.actions[name];
  }

  getAction(name: string): Action | undefined {
    return this.actions[name];
  }

  setupModelOutputSchema(): z.ZodType {
    const actionSchema = buildDynamicActionSchema(Object.values(this.actions));
    return z.object({
      current_state: agentBrainSchema,
      action: z.array(actionSchema),
    });
  }
}

export interface AgentNavigatorResult {
  done: boolean;
}

/**
 * Browser automation workflow for web interaction tasks.
 * Executes actions via Chrome DevTools Protocol to navigate, interact with pages, and extract data.
 */
export class AgentNavigator extends BaseAgent<z.ZodType, AgentNavigatorResult> {
  private actionRegistry: NavigatorActionRegistry;
  private jsonSchema: Record<string, unknown>;
  private _stateHistory: BrowserStateHistory | null = null;
  // Guardrails for repeated SERP extractions across steps
  private _lastSerpExtractSignature: string | null = null;

  constructor(
    actionRegistry: NavigatorActionRegistry,
    options: BaseAgentOptions,
    extraOptions?: Partial<ExtraAgentOptions>,
  ) {
    super(actionRegistry.setupModelOutputSchema(), options, { ...extraOptions, id: 'Navigator' });

    this.actionRegistry = actionRegistry;

    // The zod object is too complex to be used directly, so we need to convert it to json schema first for the model to use
    this.jsonSchema = convertZodToJsonSchema(this.modelOutputSchema, 'AgentNavigatorOutput', true);
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    try {
      // Stamp task and role for accurate logging
      const myTaskId = (this as any)?.context?.taskId;
      if (myTaskId) {
        globalTokenTracker.setCurrentTaskId(myTaskId);
        // Log action schema once per session for session logs
        // For workers, store under parent session so multi-agent logs include the schema
        const parentSession = globalTokenTracker.getCurrentParentSession() || myTaskId;
        globalTokenTracker.setSessionSchema(parentSession, this.jsonSchema);
      }
      const roleStamp = String(this.id || 'navigator').replace(/-/g, '_');
      globalTokenTracker.setCurrentRole(roleStamp);

      this.logger.debug('Navigator invoking', { model: this.modelName, messageCount: inputMessages.length });

      // Use structured output when available
      if (this.withStructuredOutput) {
        const structuredLlm = this.chatLLM.withStructuredOutput(this.jsonSchema, {
          includeRaw: true,
          name: this.modelOutputToolName,
        });

        let response = undefined;
        try {
          response = await structuredLlm.invoke(inputMessages, {
            signal: this.context.controller.signal,
            ...this.callOptions,
          });

          // Log token usage - navigator knows its own taskId
          this.logTokenUsage(response, inputMessages);

          if (response.parsed) {
            return response.parsed;
          }
        } catch (error) {
          if (isAbortedError(error)) {
            throw error;
          }
          const errorMessage = `Failed to invoke ${this.modelName} with structured output: ${error}`;
          throw new Error(errorMessage);
        }

        // Use type assertion to access the properties
        const rawResponse = response.raw as BaseMessage & {
          tool_calls?: Array<{
            args: {
              currentState: typeof agentBrainSchema._type;
              action: z.infer<ReturnType<typeof buildDynamicActionSchema>>;
            };
          }>;
        };

        // sometimes LLM returns an empty content, but with one or more tool calls, so we need to check the tool calls
        if (rawResponse.tool_calls && rawResponse.tool_calls.length > 0) {
          logger.info('Navigator structuredLlm tool call with empty content', rawResponse.tool_calls);
          // only use the first tool call
          const toolCall = rawResponse.tool_calls[0];
          return {
            current_state: toolCall.args.currentState,
            action: [...toolCall.args.action],
          };
        }
        throw new Error('Could not parse response');
      }

      // Fallback: delegate to BaseAgent manual JSON extraction when structured output is not available
      return await super.invoke(inputMessages);
    } finally {
      globalTokenTracker.setCurrentRole(null);
    }
  }

  async execute(): Promise<AgentOutput<AgentNavigatorResult>> {
    const agentOutput: AgentOutput<AgentNavigatorResult> = {
      id: this.id,
    };

    let cancelled = false;
    let modelOutputString: string | null = null;
    let browserStateHistory: BrowserStateHistory | null = null;
    let actionResults: ActionResult[] = [];

    try {
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.STEP_START, 'Navigating...');

      const messageManager = this.context.messageManager;
      // add the browser state message
      await this.addStateMessageToMemory();
      const currentState = await this.context.browserContext.getCachedState();
      browserStateHistory = new BrowserStateHistory(currentState);

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }

      // Inject site skills before getting messages (upsert on each step)
      const skillUrls = this.context.getSkillUrls();
      console.log(`[Skills] Navigator execute: skillUrls = [${skillUrls.join(', ')}]`);
      if (skillUrls.length > 0) {
        try {
          const { shouldInjectSkills, buildSkillsSystemMessage } = await import('@src/skills');
          if (await shouldInjectSkills()) {
            messageManager.removeSiteSkillsBlocks();
            const skillsMsg = buildSkillsSystemMessage(skillUrls);
            if (skillsMsg) {
              messageManager.addMessageWithTokens(skillsMsg, 'skills', 1);
              console.log(`[Skills] Site skills injected for ${skillUrls.length} URLs`);
            }
          }
        } catch (err) {
          console.log('[Skills] Failed to inject site skills:', err);
        }
      }

      // call the model to get the actions to take
      let inputMessages = messageManager.getMessages();

      // Inject history context if available (for single agent workflow)
      try {
        const { getHistoryContextMessage } = await import('@src/workflows/shared/context/history-injector');
        const historyContextMsg = await getHistoryContextMessage();
        if (historyContextMsg) {
          // Insert after system message (index 0), before other messages
          const messages = [...inputMessages];
          messages.splice(1, 0, historyContextMsg);
          inputMessages = messages;
          logger.info('History context injected into Navigator messages');
        }
      } catch (err) {
        logger.error('Failed to inject history context:', err);
      }

      // logger.info('Navigator input message', inputMessages[inputMessages.length - 1]);

      const modelOutput = await this.invoke(inputMessages);

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }

      let actions = this.fixActions(modelOutput);
      actions = await this.preprocessActions(actions, currentState);
      modelOutput.action = actions;
      modelOutputString = JSON.stringify(modelOutput);

      // remove the last state message from memory before adding the model output
      this.removeLastStateMessageFromMemory();
      this.addModelOutputToMemory(modelOutput);

      // take the actions
      actionResults = await this.doMultiAction(actions);
      // logger.info('Action results', JSON.stringify(actionResults, null, 2));

      // Before replacing actionResults, clear any old extraction results that were already shown to the agent
      // (The agent saw them in the state message for this step, now it has responded, so we can clear them)
      if (this.context.actionResults.length > 0) {
        this.context.actionResults = this.context.actionResults.filter(
          r => !r.extractedContent?.includes('Extraction completed successfully'),
        );
      }

      this.context.actionResults = actionResults;

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }
      // Check if the task is done and extract the final message
      let done = false;
      let doneMessage = 'Navigation done';
      if (actionResults.length > 0 && actionResults[actionResults.length - 1].isDone) {
        done = true;
        // Use the done action's extracted content as the final message
        const doneResult = actionResults[actionResults.length - 1];
        if (doneResult.extractedContent && doneResult.extractedContent.trim().length > 0) {
          doneMessage = doneResult.extractedContent.trim();
        }
      }
      // emit event with the appropriate message
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.STEP_OK, doneMessage);
      agentOutput.result = { done };
      return agentOutput;
    } catch (error) {
      this.removeLastStateMessageFromMemory();

      // Check timeout first
      if (isTimeoutError(error)) {
        const msg = error instanceof Error ? error.message : 'Response timed out';
        logger.error(`Navigation timeout: ${msg}`);
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.STEP_FAIL, msg);
        throw new RequestCancelledError(msg);
      }

      // Check user cancellation
      if (isAbortedError(error)) {
        throw new RequestCancelledError((error as Error).message);
      }

      // URL not allowed - re-throw as-is
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      // Extension conflict - wrap with helpful message
      if (isExtensionConflictError(error)) {
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.STEP_FAIL, EXTENSION_CONFLICT_ERROR_MESSAGE);
        throw new ExtensionConflictError(EXTENSION_CONFLICT_ERROR_MESSAGE, error);
      }

      // All other errors - emit actual message, then throw to skip retry
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Navigation failed: ${errorMessage}`);
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.STEP_FAIL, errorMessage);
      throw error;
    } finally {
      // if the task is cancelled, remove the last state message from memory and emit event
      if (cancelled) {
        this.removeLastStateMessageFromMemory();
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.STEP_CANCEL, 'Navigation cancelled');
      }
      if (browserStateHistory) {
        // Create a copy of actionResults to store in history
        const actionResultsCopy = actionResults.map(result => {
          return new ActionResult({
            isDone: result.isDone,
            success: result.success,
            extractedContent: result.extractedContent,
            error: result.error,
            includeInMemory: result.includeInMemory,
            interactedElement: result.interactedElement,
          });
        });

        const history = new AgentStepRecord(modelOutputString, actionResultsCopy, browserStateHistory);
        this.context.history.history.push(history);

        // logger.info('All history', JSON.stringify(this.context.history, null, 2));
      }
    }
  }

  /** Speculatively refresh state in background to warm cache for next step */
  private async speculativelyRefreshState(): Promise<void> {
    try {
      // Fire and forget - don't block on this
      // This warms the cache so getState() is fast on next agent step
      await this.context.browserContext.getState(this.context.options.useVision);
    } catch {
      // Non-critical, silently ignore failures
    }
  }

  /** Build a simple state signature from URL and DOM path hashes */
  private async buildStateSignature(state: BrowserState): Promise<string> {
    try {
      const hashes = await calcBranchPathHashSet(state);
      const head = Array.from(hashes).slice(0, 200).join(',');
      return `${state.url}|${head}`;
    } catch {
      return `${state.url}`;
    }
  }

  /** Compute next Google SERP page URL (increments start by 10) */
  private computeNextSerpUrl(currentUrl: string): string | null {
    try {
      const u = new URL(currentUrl);
      if (!/google\.[^/]+\/search/i.test(u.href)) return null;
      const start = parseInt(u.searchParams.get('start') || '0', 10);
      const next = Number.isFinite(start) ? start + 10 : 10;
      u.searchParams.set('start', String(next));
      return u.toString();
    } catch {
      return null;
    }
  }

  /**
   * Dedupe identical actions for this step (name+args+URL).
   * If extract_google_results is duplicated within the same step, insert a go_to_url to the next SERP page before a single extraction.
   * If the only action is extract_google_results and state signature matches last extraction, replace with next-page navigation + extraction.
   */
  private async preprocessActions(
    actions: Record<string, unknown>[],
    state: BrowserState,
  ): Promise<Record<string, unknown>[]> {
    if (!Array.isArray(actions) || actions.length === 0) return actions;

    const url = state.url || '';
    const seen = new Set<string>();
    let filtered: Record<string, unknown>[] = [];
    let firstExtractIndex = -1;
    let sawDuplicateExtract = false;

    const makeKey = (name: string, args: unknown) => `${name}|${url}|${JSON.stringify(args ?? {})}`;

    for (const act of actions) {
      if (!act || typeof act !== 'object') continue;
      const name = Object.keys(act)[0];
      const args = (act as Record<string, unknown>)[name];
      const key = makeKey(name, args);
      if (seen.has(key)) {
        if (name === 'extract_google_results') sawDuplicateExtract = true;
        continue;
      }
      seen.add(key);
      if (name === 'extract_google_results' && firstExtractIndex === -1) firstExtractIndex = filtered.length;
      filtered.push(act);
    }

    if (sawDuplicateExtract && firstExtractIndex >= 0) {
      const nextUrl = this.computeNextSerpUrl(url);
      if (nextUrl) {
        filtered.splice(firstExtractIndex, 0, {
          go_to_url: { intent: 'Go to next Google results page', url: nextUrl },
        });
      }
    }

    // Across-step guard: if we just extracted for this exact state, advance SERP instead of repeating
    const stateSig = await this.buildStateSignature(state).catch(() => null);
    if (stateSig) {
      const onlyOne = filtered.length === 1 ? Object.keys(filtered[0])[0] : '';
      if (onlyOne === 'extract_google_results' && this._lastSerpExtractSignature === stateSig) {
        const nextUrl = this.computeNextSerpUrl(url);
        if (nextUrl)
          filtered = [{ go_to_url: { intent: 'Go to next Google results page', url: nextUrl } }, filtered[0]];
      }
    }

    return filtered;
  }

  /**
   * Add the state message to the memory
   */
  public async addStateMessageToMemory() {
    if (this.context.stateMessageAdded) {
      return;
    }

    const messageManager = this.context.messageManager;
    // Handle results that should be included in memory
    if (this.context.actionResults.length > 0) {
      let index = 0;
      for (const r of this.context.actionResults) {
        if (r.includeInMemory) {
          if (r.extractedContent) {
            const msg = new HumanMessage(`Action result: ${r.extractedContent}`);
            // logger.info('Adding action result to memory', msg.content);
            messageManager.addMessageWithTokens(msg);
          }
          if (r.error) {
            // Get error text and convert to string
            const errorText = r.error.toString().trim();

            // Get only the last line of the error
            const lastLine = errorText.split('\n').pop() || '';

            const msg = new HumanMessage(`Action error: ${lastLine}`);
            logger.info('Adding action error to memory', msg.content);
            messageManager.addMessageWithTokens(msg);
          }
          // reset this action result to empty, we dont want to add it again in the state message
          // NOTE: in python version, all action results are reset to empty, but in ts version, only those included in memory are reset to empty
          this.context.actionResults[index] = new ActionResult();
        }
        // NOTE: Extraction results (includeInMemory: false) are NOT cleared here
        // They need to persist through state message building so agent can see and process them
        // They will be cleared at the start of the next execute() call
        index++;
      }
    }

    // Try to get the state message, but handle "no worker tab bound" gracefully
    try {
      const state = await this.prompt.getUserMessage(this.context);
      messageManager.addStateMessage(state);
      this.context.stateMessageAdded = true;
    } catch (error: any) {
      // If no worker tab is bound yet, add a placeholder message
      if (error.message === 'No worker tab bound yet') {
        const placeholderMsg = new HumanMessage(
          '[Current state starts here]\nNo worker tab is currently bound. The agent needs to perform a navigation action first.',
        );
        messageManager.addStateMessage(placeholderMsg);
        this.context.stateMessageAdded = true;
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  }

  /**
   * Remove the last state message from the memory
   */
  protected async removeLastStateMessageFromMemory() {
    if (!this.context.stateMessageAdded) return;
    const messageManager = this.context.messageManager;
    messageManager.removeLastStateMessage();
    this.context.stateMessageAdded = false;
  }

  private async addModelOutputToMemory(modelOutput: this['ModelOutput']) {
    const messageManager = this.context.messageManager;
    messageManager.addModelOutput(modelOutput);
  }

  /**
   * Fix the actions to be an array of objects, sometimes the action is a string or an object
   * @param response
   * @returns
   */
  private fixActions(response: this['ModelOutput']): Record<string, unknown>[] {
    let actions: Record<string, unknown>[] = [];
    if (Array.isArray(response.action)) {
      // if the item is null, skip it
      actions = response.action.filter((item: unknown) => item !== null);
      if (actions.length === 0) {
        logger.warning('No valid actions found', response.action);
      }
    } else if (typeof response.action === 'string') {
      try {
        logger.warning('Unexpected action format', response.action);
        // First try to parse the action string directly
        actions = JSON.parse(response.action);
      } catch (parseError) {
        try {
          // If direct parsing fails, try to fix the JSON first
          const fixedAction = repairJsonString(response.action);
          logger.info('Fixed action string', fixedAction);
          actions = JSON.parse(fixedAction);
        } catch (error) {
          logger.error('Invalid action format even after repair attempt', response.action);
          throw new Error('Invalid action output format');
        }
      }
    } else {
      // if the action is neither an array nor a string, it should be an object
      actions = [response.action];
    }
    return actions;
  }

  private async doMultiAction(actions: Record<string, unknown>[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    let errCount = 0;
    logger.info('Actions', actions);

    const browserContext = this.context.browserContext;
    // Use cached state to avoid heavy DOM scans; on-demand refresh happens on navigation/URL change
    const browserState = await browserContext.getCachedState(this.context.options.useVision);
    // In worker mode with no bound tab yet, prioritize any navigation/open actions first
    if (browserState && Array.isArray((browserState as any).tabs) && (browserState as any).tabs.length === 0) {
      const navNames = new Set(['go_to_url', 'open_tab', 'search_google']);
      const navActions: Record<string, unknown>[] = [];
      const otherActions: Record<string, unknown>[] = [];
      for (const act of actions) {
        const name = Object.keys(act)[0];
        if (navNames.has(name)) navActions.push(act);
        else otherActions.push(act);
      }
      if (navActions.length > 0) {
        actions = [...navActions, ...otherActions];
        logger.info('Reordered actions to navigate/open first due to no bound worker tab');
      }
    }
    const cachedPathHashes = await calcBranchPathHashSet(browserState);
    const stateSignatureForThisBatch = await this.buildStateSignature(browserState).catch(() => null);

    await browserContext.removeHighlight();

    for (const [i, action] of actions.entries()) {
      const actionName = Object.keys(action)[0];
      const actionArgs = action[actionName];
      try {
        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }

        const actionInstance = this.actionRegistry.getAction(actionName);
        if (actionInstance === undefined) {
          throw new Error(`Action ${actionName} not exists`);
        }

        // Avoid mid-batch DOM refresh; rely on URL-change driven updates and next batch state capture
        // (Index-based actions proceed under the initial snapshot for this batch.)

        const indexArg = actionInstance.getIndexArg(actionArgs);
        const result = await actionInstance.call(actionArgs);
        if (result === undefined) {
          throw new Error(`Action ${actionName} returned undefined`);
        }

        // if the action has an index argument, record the interacted element to the result
        if (indexArg !== null) {
          const domElement = browserState.selectorMap.get(indexArg);
          if (domElement) {
            const interactedElement = HistoryTreeProcessor.convertDomElementToHistoryElement(domElement);
            result.interactedElement = interactedElement;
            logger.info('Interacted element', interactedElement);
            logger.info('Result', result);
          }
        }
        results.push(result);

        // Remember last SERP extraction state to prevent repeats in the following step
        if (actionName === 'extract_google_results' && stateSignatureForThisBatch) {
          this._lastSerpExtractSignature = stateSignatureForThisBatch;
        }

        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }
        // Use action-specific delay for better performance
        const delay = ACTION_DELAYS[actionName] ?? 500;
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Speculatively refresh state in background after action completes
        // This warms the cache for the next agent step
        this.speculativelyRefreshState().catch(() => {});
      } catch (error) {
        if (error instanceof URLNotAllowedError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          'doAction error',
          actionName,
          JSON.stringify(actionArgs, null, 2),
          JSON.stringify(errorMessage, null, 2),
        );
        // unexpected error, emit event
        this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.ACT_FAIL, errorMessage);
        errCount++;
        if (errCount > 3) {
          throw new Error('Too many errors in actions');
        }
        results.push(
          new ActionResult({
            error: errorMessage,
            isDone: false,
            includeInMemory: true,
          }),
        );
      }
    }
    return results;
  }

  /**
   * Parse and validate model output from history item
   */
  private parseHistoryModelOutput(historyItem: AgentStepRecord): {
    parsedOutput: ParsedModelOutput;
    goal: string;
    actionsToReplay: (Record<string, unknown> | null)[] | null;
  } {
    if (!historyItem.modelOutput) {
      throw new Error('No model output found in history item');
    }

    let parsedOutput: ParsedModelOutput;
    try {
      parsedOutput = JSON.parse(historyItem.modelOutput) as ParsedModelOutput;
    } catch (error) {
      throw new Error(`Could not parse modelOutput: ${error}`);
    }

    // logger.info('Parsed output', JSON.stringify(parsedOutput, null, 2));

    const goal = parsedOutput?.current_state?.next_goal || '';
    const actionsToReplay = parsedOutput?.action;

    // Validate that there are actions to replay
    if (
      !parsedOutput || // No model output string at all
      !actionsToReplay || // 'action' field is missing or null after parsing
      (Array.isArray(actionsToReplay) && actionsToReplay.length === 0) || // 'action' is an empty array
      (Array.isArray(actionsToReplay) && actionsToReplay.length === 1 && actionsToReplay[0] === null) // 'action' is [null]
    ) {
      throw new Error('No action to replay');
    }

    return { parsedOutput, goal, actionsToReplay };
  }

  /**
   * Execute actions from history with element index updates
   */
  private async executeHistoryActions(
    parsedOutput: ParsedModelOutput,
    historyItem: AgentStepRecord,
    delay: number,
  ): Promise<ActionResult[]> {
    const state = await this.context.browserContext.getState(this.context.options.useVision);
    if (!state) {
      throw new Error('Invalid browser state');
    }

    const updatedActions: (Record<string, unknown> | null)[] = [];
    for (let i = 0; i < parsedOutput.action!.length; i++) {
      const result = historyItem.result[i];
      if (!result) {
        break;
      }
      const interactedElement = result.interactedElement;
      const currentAction = parsedOutput.action![i];

      // Skip null actions
      if (currentAction === null) {
        updatedActions.push(null);
        continue;
      }

      // If there's no interacted element, just use the action as is
      if (!interactedElement) {
        updatedActions.push(currentAction);
        continue;
      }

      const updatedAction = await this.updateActionIndices(interactedElement, currentAction, state);
      updatedActions.push(updatedAction);

      if (updatedAction === null) {
        throw new Error(`Could not find matching element ${i} in current page`);
      }
    }

    logger.debug('updatedActions', updatedActions);

    // Filter out null values and cast to the expected type
    const validActions = updatedActions.filter((action): action is Record<string, unknown> => action !== null);
    const result = await this.doMultiAction(validActions);

    // Wait for the specified delay
    await new Promise(resolve => setTimeout(resolve, delay));
    return result;
  }

  async executeHistoryStep(
    historyItem: AgentStepRecord,
    stepIndex: number,
    totalSteps: number,
    maxRetries = 3,
    delay = 1000,
    skipFailures = true,
  ): Promise<ActionResult[]> {
    const replayLogger = createLogger('NavigatorAgent:executeHistoryStep');
    const results: ActionResult[] = [];

    // Parse and validate model output
    let parsedData: {
      parsedOutput: ParsedModelOutput;
      goal: string;
      actionsToReplay: (Record<string, unknown> | null)[] | null;
    };
    try {
      parsedData = this.parseHistoryModelOutput(historyItem);
    } catch (error) {
      const errorMsg = `Step ${stepIndex + 1}: ${error instanceof Error ? error.message : String(error)}`;
      replayLogger.warning(errorMsg);
      return [
        new ActionResult({
          error: errorMsg,
          includeInMemory: false,
        }),
      ];
    }

    const { parsedOutput, goal, actionsToReplay } = parsedData;
    replayLogger.info(`Replaying step ${stepIndex + 1}/${totalSteps}: goal: ${goal}`);
    replayLogger.debug('Replaying actions:', actionsToReplay);

    // Try to execute the step with retries
    let retryCount = 0;
    let success = false;

    while (retryCount < maxRetries && !success) {
      try {
        // Check if execution should stop
        if (this.context.stopped) {
          replayLogger.info('Replay stopped by user');
          break;
        }

        // Execute the history actions
        const stepResults = await this.executeHistoryActions(parsedOutput, historyItem, delay);
        results.push(...stepResults);
        success = true;
      } catch (error) {
        retryCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (retryCount >= maxRetries) {
          const failMsg = `Step ${stepIndex + 1} failed after ${maxRetries} attempts: ${errorMessage}`;
          replayLogger.error(failMsg);

          results.push(
            new ActionResult({
              error: failMsg,
              includeInMemory: true,
            }),
          );

          if (!skipFailures) {
            throw new Error(failMsg);
          }
        } else {
          replayLogger.warning(`Step ${stepIndex + 1} failed (attempt ${retryCount}/${maxRetries}), retrying...`);
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return results;
  }

  async updateActionIndices(
    historicalElement: DOMHistoryElement,
    action: Record<string, unknown>,
    currentState: BrowserState,
  ): Promise<Record<string, unknown> | null> {
    // If no historical element or no element tree in current state, return the action unchanged
    if (!historicalElement || !currentState.elementTree) {
      return action;
    }

    // Find the current element in the tree based on the historical element
    const currentElement = await HistoryTreeProcessor.findHistoryElementInTree(
      historicalElement,
      currentState.elementTree,
    );

    // If no current element found or it doesn't have a highlight index, return null
    if (!currentElement || currentElement.highlightIndex === null) {
      return null;
    }

    // Get action name and args
    const actionName = Object.keys(action)[0];
    const actionArgs = action[actionName] as Record<string, unknown>;

    // Get the action instance to access the index
    const actionInstance = this.actionRegistry.getAction(actionName);
    if (!actionInstance) {
      return action;
    }

    // Get the index argument from the action
    const oldIndex = actionInstance.getIndexArg(actionArgs);

    // If the index has changed, update it
    if (oldIndex !== null && oldIndex !== currentElement.highlightIndex) {
      // Create a new action object with the updated index
      const updatedAction: Record<string, unknown> = { [actionName]: { ...actionArgs } };

      // Update the index in the action arguments
      actionInstance.setIndexArg(updatedAction[actionName] as Record<string, unknown>, currentElement.highlightIndex);

      logger.info(`Element moved in DOM, updated index from ${oldIndex} to ${currentElement.highlightIndex}`);
      return updatedAction;
    }

    return action;
  }
}
