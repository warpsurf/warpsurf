type BaseChatModel = any;
import { type ActionResult, AgentContext, type AgentOptions } from '@src/workflows/shared/agent-types';
import {
  AgentNavigator,
  NavigatorActionRegistry,
  AgentPlanner,
  type PlannerOutput,
  AgentValidator,
} from '@src/workflows/agent';
import { ChatWorkflow } from '@src/workflows/chat';
import { SearchWorkflow } from '@src/workflows/search';
import { NavigatorPrompt, PlannerPrompt, ValidatorPrompt } from '@src/workflows/agent';
import { createLogger } from '@src/log';
import { workflowLogger } from './workflow-logger';
import { MessageManager, MessageManagerSettings } from '@src/workflows/shared/messages';
import type BrowserContext from '../browser/context';
import { ActionBuilder } from '@src/workflows/agent';
import { EventManager } from '@src/workflows/shared/event';
import { Actors, type EventCallback, EventType, ExecutionState } from '@src/workflows/shared/event';
import { globalTokenTracker } from '../utils/token-tracker';
import { ExtensionConflictError, RequestCancelledError } from '@src/workflows/shared/agent-errors';
import { wrapUntrustedContent } from '@src/workflows/shared/messages';
import { URLNotAllowedError } from '../browser/views';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import type { AgentStepHistory } from '@src/workflows/shared/step-history';
import { generalSettingsStore, type GeneralSettingsConfig } from '@extension/storage';
import { AutoWorkflow, type AutoAction, type AutoResult } from '@src/workflows/auto';
import { ToolWorkflow } from '@src/workflows/tool';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { buildChatHistoryBlock } from '@src/workflows/shared/utils';
import { tabExists } from '@src/utils';
import { buildContextTabsSystemMessage } from '@src/workflows/shared/context/context-tab-injector';
import { WorkflowType } from '@extension/shared/lib/workflows/types';

const logger = createLogger('Executor');

export interface ExecutorExtraArgs {
  plannerLLM?: BaseChatModel;
  validatorLLM?: BaseChatModel;
  extractorLLM?: BaseChatModel;
  chatLLM?: BaseChatModel;
  searchLLM?: BaseChatModel;
  agentOptions?: Partial<AgentOptions>;
  generalSettings?: GeneralSettingsConfig;
  agentType?: string;
  messageContext?: string;
  retainTokenLogs?: boolean;
  /** Optional override for the initial SystemMessage (used by Multi-agent workers). */
  systemMessageOverride?: SystemMessage;
  /** Context menu action identifier (e.g., 'explain-selection') for selecting bespoke prompts. */
  contextMenuAction?: string;
  /** Pre-computed triage result from task-handlers to avoid duplicate AUTO calls. */
  preTriageResult?: AutoResult;
}

export class Executor {
  private readonly navigator: AgentNavigator;
  private readonly planner: AgentPlanner;
  private readonly validator: AgentValidator;
  private readonly chat: ChatWorkflow;
  private readonly search: SearchWorkflow;
  private readonly tool: ToolWorkflow;
  private readonly context: AgentContext;
  private readonly plannerPrompt: PlannerPrompt;
  private readonly navigatorPrompt: NavigatorPrompt;
  private readonly validatorPrompt: ValidatorPrompt;
  private readonly generalSettings: GeneralSettingsConfig | undefined;
  private readonly autoService: AutoWorkflow;
  private manualAgentType?: string;
  private preTriageResult?: AutoResult;
  private tasks: string[] = [];
  private lastError?: any;
  private retainTokenLogs?: boolean;
  private hasRunBrowserUse: boolean = false;
  private _hasReachedTerminalState: boolean = false;
  private navigatorModelName?: string;

  public llmResponses: {
    auto: Array<{ request: string; response: any; timestamp: number }>;
    chat: Array<{ request: string; response: any; timestamp: number }>;
    search: Array<{ request: string; response: any; timestamp: number }>;
    tool: Array<{ request: string; response: any; timestamp: number }>;
    navigator: Array<{ step: number; response: any; timestamp: number }>;
    planner: Array<{ step: number; response: any; timestamp: number }>;
    validator: Array<{ step: number; response: any; timestamp: number }>;
  } = {
    auto: [],
    chat: [],
    search: [],
    tool: [],
    navigator: [],
    planner: [],
    validator: [],
  };
  constructor(
    task: string,
    taskId: string,
    browserContext: BrowserContext,
    navigatorLLM: BaseChatModel,
    extraArgs?: Partial<ExecutorExtraArgs>,
  ) {
    const messageManager = new MessageManager(new MessageManagerSettings({ minimalInit: true } as any));

    const plannerLLM = extraArgs?.plannerLLM ?? navigatorLLM;
    const validatorLLM = extraArgs?.validatorLLM ?? navigatorLLM;
    const extractorLLM = extraArgs?.extractorLLM ?? navigatorLLM;
    const chatLLM = extraArgs?.chatLLM ?? navigatorLLM;
    const searchLLM = extraArgs?.searchLLM ?? navigatorLLM;
    const eventManager = new EventManager();
    const context = new AgentContext(
      taskId,
      browserContext,
      messageManager,
      eventManager,
      extraArgs?.agentOptions ?? {},
    );

    this.generalSettings = extraArgs?.generalSettings;
    this.retainTokenLogs = !!extraArgs?.retainTokenLogs;
    this.manualAgentType = extraArgs?.agentType;
    this.preTriageResult = extraArgs?.preTriageResult;
    this.tasks.push(task);
    this.navigatorPrompt = new NavigatorPrompt(context.options.maxActionsPerStep);
    this.plannerPrompt = new PlannerPrompt();
    this.validatorPrompt = new ValidatorPrompt(task);

    const actionBuilder = new ActionBuilder(context, extractorLLM);
    const navigatorActionRegistry = new NavigatorActionRegistry(actionBuilder.buildDefaultActions());

    this.navigator = new AgentNavigator(navigatorActionRegistry, {
      chatLLM: navigatorLLM,
      context: context,
      prompt: this.navigatorPrompt,
    });

    this.planner = new AgentPlanner({
      chatLLM: plannerLLM,
      context: context,
      prompt: this.plannerPrompt,
    });

    this.validator = new AgentValidator({
      chatLLM: validatorLLM,
      context: context,
      prompt: this.validatorPrompt,
    });

    this.chat = new ChatWorkflow(chatLLM, context, extraArgs?.contextMenuAction);

    this.search = new SearchWorkflow(searchLLM, context);

    this.tool = new ToolWorkflow(chatLLM, context);

    this.autoService = new AutoWorkflow();

    this.context = context;
    // Store model name for context budget calculations
    this.navigatorModelName = (navigatorLLM as any).modelName || (navigatorLLM as any).model_name;
    // Initialize message history (allow optional messageContext for worker sessions)
    const systemMsg = extraArgs?.systemMessageOverride ?? this.navigatorPrompt.getSystemMessage();
    this.context.messageManager.initTaskMessages(systemMsg, task, extraArgs?.messageContext);
  }

  /** Expose the browser context for controlled introspection (tests/overseer). */
  getBrowserContext(): BrowserContext {
    return (this as any).context.browserContext as BrowserContext;
  }

  async initialize(): Promise<void> {
    await this.autoService.initialize();
    logger.info('Trying to load chat history for session', this.context.taskId);
    try {
      const session = await chatHistoryStore.getSession(this.context.taskId);
      if (session && session.messages && session.messages.length > 0) {
        const latestTaskText = String(this.tasks[this.tasks.length - 1] || '').trim();
        const block = buildChatHistoryBlock(session.messages as any, { latestTaskText, stripUserRequestTags: true });
        logger.info('Chat history block', block);
        if (block && block.trim().length > 0) {
          (this.context.messageManager as any).insertChatHistoryBlock?.(block);
        }
      }
      logger.info('Chat history loaded for session', this.context.taskId);
    } catch (e) {
      logger.info('No chat history found or failed to load history for session', this.context.taskId, e);
    }

    // Inject context tabs for Agent workflow (DOM format)
    await this.injectContextTabsForAgent();
  }

  /**
   * Set context tab IDs for this executor session.
   */
  setContextTabIds(tabIds: number[]): void {
    this.context.contextTabIds = tabIds;
    logger.info(`Set ${tabIds.length} context tabs for executor`);
  }

  /**
   * Inject context tabs into Agent workflow messages (DOM format).
   * Called during initialization for agent workflows.
   * Context tabs are inserted at position 1 (after system message, before user_request).
   */
  private async injectContextTabsForAgent(): Promise<void> {
    // Upsert semantics: remove any stale blocks first
    try {
      this.context.messageManager.removeContextTabsBlocks();
    } catch {}

    if (this.context.contextTabIds.length === 0) return;
    if (this.manualAgentType && this.manualAgentType !== 'agent' && this.manualAgentType !== 'auto') return;

    try {
      const contextMsg = await buildContextTabsSystemMessage(
        this.context.contextTabIds,
        WorkflowType.AGENT,
        this.navigatorModelName,
      );
      if (contextMsg) {
        // Insert at position 1 (after system message, before user_request)
        this.context.messageManager.addMessageWithTokens(contextMsg, 'context', 1);
        logger.info(`Injected context tabs (DOM) for Agent workflow: ${this.context.contextTabIds.length} tabs`);
      }
    } catch (e) {
      logger.warning('Failed to inject context tabs for agent:', e);
    }
  }

  /**
   * Ensure context tabs are available to the agent after tool workflow updates.
   * This is required when chaining tool → agent in the same session (manualAgentType may be 'tool').
   */
  private async forceInjectContextTabsForAgent(): Promise<void> {
    try {
      this.context.messageManager.removeContextTabsBlocks();
    } catch {}

    if (this.context.contextTabIds.length === 0) return;

    try {
      const contextMsg = await buildContextTabsSystemMessage(
        this.context.contextTabIds,
        WorkflowType.AGENT,
        this.navigatorModelName,
      );
      if (contextMsg) {
        this.context.messageManager.addMessageWithTokens(contextMsg, 'context', 1);
        logger.info(`Injected context tabs (DOM) for Agent workflow: ${this.context.contextTabIds.length} tabs`);
      }
    } catch (e) {
      logger.warning('Failed to inject context tabs for agent:', e);
    }
  }

  subscribeExecutionEvents(callback: EventCallback): void {
    this.context.eventManager.subscribe(EventType.EXECUTION, callback);
  }

  clearExecutionEvents(): void {
    this.context.eventManager.clearSubscribers(EventType.EXECUTION);
  }

  addFollowUpTask(task: string, agentType?: string, preTriageResult?: AutoResult): void {
    this.tasks.push(task);
    // Store pre-triage result if provided (for tool actions)
    if (preTriageResult) {
      this.preTriageResult = preTriageResult;
    }
    // Normalize agent type: if not provided, inherit the existing manual agent type for this session
    const normalizedType = agentType ?? this.manualAgentType;
    // For agent sessions, avoid adding another "ultimate task" block.
    // Replace the current instruction to keep a single current instruction per request.
    if (normalizedType === 'agent') {
      (this.context.messageManager as any).addWorkerInstruction?.(task);
    } else {
      // Single-agent (chat / search / auto→navigator) follow-up:
      // Rebuild the prompt scaffold fresh and re-insert Chat History block
      try {
        const sysMsg = this.navigatorPrompt.getSystemMessage();
        (this.context.messageManager as any).resetForSingleAgent?.(task, sysMsg);
      } catch {
        // Fallback: replace the current task in place
        try {
          this.context.messageManager.setCurrentTask(task);
        } catch {
          this.context.messageManager.addNewTask(task);
        }
      }
      // Rebuild Chat History block for the latest task and insert after the system message
      try {
        const latestTaskText = String(this.tasks[this.tasks.length - 1] || '').trim();
        (async () => {
          try {
            const session = await chatHistoryStore.getSession(this.context.taskId);
            const sessionMsgs = Array.isArray(session?.messages) ? session!.messages : [];
            const block = buildChatHistoryBlock(sessionMsgs as any, { latestTaskText, stripUserRequestTags: true });
            if (block && block.trim().length > 0) {
              (this.context.messageManager as any).upsertChatHistoryBlock?.(block);
            } else {
              (this.context.messageManager as any).removeChatHistoryBlocks?.();
            }
          } catch {
            // Best-effort; do not block
          }
        })();
      } catch {}
    }
    this.validatorPrompt.addFollowUpTask(task);

    if (normalizedType) {
      this.manualAgentType = normalizedType;
      logger.info(`Updated manual agent type to: ${normalizedType}`);
    }
    // need to reset previous action results that are not included in memory
    this.context.actionResults = this.context.actionResults.filter(result => result.includeInMemory);
  }

  /**
   * Add a follow-up task for browser-use agent while preserving full context.
   * The agent keeps all browser context, tab access, message history, and permissions.
   * This is specifically for single_agent continuity without resetting the executor.
   * Should only be called when browser-use is already active in the session.
   */
  async addBrowserUseFollowUpTask(task: string): Promise<void> {
    this.tasks.push(task);

    logger.info(`Adding browser-use follow-up task: ${task}`);

    // Mark that this executor has run browser-use (in case it was previously another type)
    this.hasRunBrowserUse = true;

    // Step 1: Remove ALL user_request blocks
    try {
      const msgs: any[] = (this.context.messageManager as any).history?.messages || [];
      const USER_REQUEST_START = '<user_request>';
      const USER_REQUEST_END = '</user_request>';

      // Find all messages containing user_request and remove them (backwards to preserve indices)
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]?.message;
        if (
          m &&
          typeof m.content === 'string' &&
          m.content.includes(USER_REQUEST_START) &&
          m.content.includes(USER_REQUEST_END)
        ) {
          logger.info(`Removing old task at index ${i}`);
          (this.context.messageManager as any).history.removeMessage(i);
        }
      }
    } catch (e) {
      logger.error('Failed to remove old task blocks:', e);
    }

    // Step 2: Rebuild chat history with all completed messages
    try {
      const session = await chatHistoryStore.getSession(this.context.taskId);
      if (session && session.messages && session.messages.length > 0) {
        const latestTaskText = String(task || '').trim();
        const block = buildChatHistoryBlock(session.messages as any, {
          latestTaskText,
          stripUserRequestTags: true,
        });
        if (block && block.trim().length > 0) {
          logger.info(`Upserting chat history block, length: ${block.length}`);
          (this.context.messageManager as any).upsertChatHistoryBlock?.(block);
        }
      }
    } catch (e) {
      logger.error('Failed to rebuild chat history:', e);
    }

    // Step 3: Add the NEW task (fresh, no stale currentTaskIndex issues)
    try {
      logger.info(`Adding new task: ${task}`);
      this.context.messageManager.addNewTask(task);
      logger.info('New task added successfully');
    } catch (error) {
      logger.error(`addNewTask failed: ${error}`);
    }

    this.validatorPrompt.addFollowUpTask(task);

    this.manualAgentType = 'agent';
    logger.info(`Updated manual agent type to: agent`);

    // Filter action results (keep memory-included ones)
    this.context.actionResults = this.context.actionResults.filter(result => result.includeInMemory);

    logger.info(`Browser-use follow-up task added successfully`);
  }

  /**
   * Get the current manual agent type for this executor.
   */
  getManualAgentType(): string | undefined {
    return this.manualAgentType;
  }

  /**
   * Check if this executor has ever run browser-use (single_agent).
   * Used to determine if browser context should be preserved when switching agent types.
   */
  getHasRunBrowserUse(): boolean {
    return this.hasRunBrowserUse;
  }

  /**
   * Execute the task
   *
   * @returns {Promise<void>}
   */
  async execute(): Promise<void> {
    // Reset terminal state for new/follow-up task execution
    this._hasReachedTerminalState = false;
    const task = this.tasks[this.tasks.length - 1];
    const jobStartTime = Date.now();
    const currentTaskNum = workflowLogger.taskReceived(task, this.manualAgentType);

    try {
      let autoResult: AutoResult;

      // Use pre-computed triage result if available (avoids duplicate AUTO calls)
      if (this.preTriageResult) {
        autoResult = this.preTriageResult;
        // Clear after use so follow-up tasks triage fresh
        this.preTriageResult = undefined;
        workflowLogger.autoRouting(autoResult.action, autoResult.confidence);
      } else if (this.manualAgentType && this.manualAgentType !== 'auto') {
        switch (this.manualAgentType) {
          case 'chat':
            autoResult = { action: 'chat', confidence: 1 };
            this.context.emitEvent(Actors.CHAT, ExecutionState.STEP_START, 'Processing request...');
            break;
          case 'search':
            autoResult = { action: 'search', confidence: 1 };
            this.context.emitEvent(Actors.SEARCH, ExecutionState.STEP_START, 'Searching and processing...');
            break;
          case 'agent':
            autoResult = { action: 'agent', confidence: 1 };
            this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.STEP_START, 'Initializing browser agent...');
            break;
          default:
            autoResult = await this.triageRequest(task);
            workflowLogger.autoRouting(autoResult.action, autoResult.confidence);
            break;
        }
      } else {
        autoResult = await this.triageRequest(task);
        workflowLogger.autoRouting(autoResult.action, autoResult.confidence);
      }

      workflowLogger.workflowStart(autoResult.action);

      switch (autoResult.action) {
        case 'chat':
          this.context.emitEvent(
            Actors.SYSTEM,
            ExecutionState.TASK_START,
            'Processing as simple question - using direct LLM response',
          );
          await this.executeChatWorkflow();
          break;

        case 'search':
          this.context.emitEvent(
            Actors.SYSTEM,
            ExecutionState.TASK_START,
            'Processing as web search question - using LLM with web search',
          );
          await this.executeSearchWorkflow();
          break;

        case 'tool': {
          this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_START, 'Processing settings/configuration request');
          const toolSummary = await this.executeToolWorkflow();
          // Only chain to the follow-up workflow if tools were actually executed.
          // If no tools ran (e.g. LLM asked for clarification), stop here.
          if (toolSummary && autoResult.afterTool && autoResult.afterTool !== 'none') {
            await this.reloadGeneralSettings();
            // If tool workflow updated context tabs and we are chaining into the agent workflow,
            // make sure BrowserContext owns those tabs and the agent prompt includes them.
            if (autoResult.afterTool === 'agent') {
              try {
                this.context.browserContext.setContextTabs(this.context.contextTabIds);
              } catch {}
              await this.forceInjectContextTabsForAgent();
            }
            // Push a modified task so the follow-up workflow knows the tool part is done.
            // The tool output is also persisted to chat history for full context.
            const original = this.tasks[this.tasks.length - 1];
            this.tasks.push(
              `[Tool actions completed: ${toolSummary}] ` +
                `Handle the remaining part of the user's request: ${original}`,
            );
            switch (autoResult.afterTool) {
              case 'chat':
                await this.executeChatWorkflow();
                break;
              case 'search':
                await this.executeSearchWorkflow();
                break;
              case 'agent':
                await this.executeAgentWorkflow();
                break;
            }
          }
          break;
        }

        case 'agent':
        default:
          this.context.emitEvent(
            Actors.SYSTEM,
            ExecutionState.TASK_START,
            'Processing as complex task - using browser automation',
          );
          await this.executeAgentWorkflow();
          break;
      }
    } catch (error) {
      this.lastError = error;
      throw error;
    } finally {
      const responsesSummary = this.getLLMResponsesSummary();
      const jobSummary = this.getJobSummary(jobStartTime);

      const alreadyTerminal = this._hasReachedTerminalState;
      if (this.lastError && !alreadyTerminal) {
        const errorMessage = this.lastError instanceof Error ? this.lastError.message : String(this.lastError);
        if (!errorMessage.toLowerCase().includes('abort')) {
          workflowLogger.taskFailed(errorMessage, currentTaskNum);
          this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, `Task failed: ${errorMessage}`);
          this._hasReachedTerminalState = true;
        }
        this.lastError = undefined;
      } else if (this.context.stopped && !alreadyTerminal) {
        workflowLogger.taskCancelled(currentTaskNum);
      } else if (!alreadyTerminal && responsesSummary.total > 0) {
        workflowLogger.taskComplete(
          jobSummary.totalLatency,
          jobSummary.totalCost,
          jobSummary.totalTokens,
          currentTaskNum,
        );
        // Include job summary in event data for UI to display cost/latency
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, 'Task completed successfully', {
          summary: {
            totalInputTokens: jobSummary.totalInputTokens,
            totalOutputTokens: jobSummary.totalOutputTokens,
            totalCost: jobSummary.totalCost,
            totalLatencySeconds: Math.round(jobSummary.totalLatency / 1000),
            totalLatencyMs: Math.round(jobSummary.totalLatency),
            apiCallCount: responsesSummary.total,
          },
        } as any);
        this._hasReachedTerminalState = true;

        if (!this.retainTokenLogs) {
          globalTokenTracker.clearTokensForTask(this.context.taskId);
        }
      } else if (!this.retainTokenLogs) {
        globalTokenTracker.clearTokensForTask(this.context.taskId);
      }
    }
  }

  private async triageRequest(request: string): Promise<AutoResult> {
    this.context.emitEvent(Actors.AUTO, ExecutionState.STEP_START, 'Analyzing request...');

    try {
      const result = await this.autoService.triageRequest(request, this.context.taskId, this.context.contextTabIds);
      if (result.action === 'request_more_info') {
        result.action = 'chat';
      }

      this.llmResponses.auto.push({ request, response: result, timestamp: Date.now() });
      this.context.emitEvent(Actors.AUTO, ExecutionState.STEP_OK, `Request categorized as: ${result.action}`);
      return result;
    } catch (error) {
      const errorResponse: AutoResult = {
        action: 'agent',
        confidence: 0.3,
        reasoning: 'Fallback due to auto failure',
      };

      this.llmResponses.auto.push({ request, response: errorResponse, timestamp: Date.now() });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.emitEvent(Actors.AUTO, ExecutionState.STEP_FAIL, `Auto failed: ${errorMessage}`);

      return {
        action: 'agent',
        confidence: 0.3,
        reasoning: 'Fallback due to auto failure',
      };
    }
  }

  private async executeChatWorkflow(): Promise<void> {
    try {
      logger.info('Executing chat workflow...');
      const currentTask = this.tasks[this.tasks.length - 1];
      this.chat.setTask(currentTask);
      const result = await this.chat.execute();

      this.llmResponses.chat.push({
        request: currentTask,
        response: result,
        timestamp: Date.now(),
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.result?.response) {
        throw new Error('No response from chat');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      const currentTask = this.tasks[this.tasks.length - 1];
      this.llmResponses.chat.push({
        request: currentTask,
        response: { error: errorMessage },
        timestamp: Date.now(),
      });

      logger.error(`Chat execution failed: ${errorMessage}`);
      // Re-throw to let the main finally block handle job summary
      throw error;
    }
  }

  private async executeSearchWorkflow(): Promise<void> {
    try {
      logger.info('Executing search workflow...');
      const currentTask = this.tasks[this.tasks.length - 1];
      this.search.setTask(currentTask);
      const result = await this.search.execute();

      this.llmResponses.search.push({
        request: currentTask,
        response: result,
        timestamp: Date.now(),
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.result?.response) {
        throw new Error('No response from search');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      const currentTask = this.tasks[this.tasks.length - 1];
      this.llmResponses.search.push({
        request: currentTask,
        response: { error: errorMessage },
        timestamp: Date.now(),
      });

      logger.error(`Search execution failed: ${errorMessage}`);
      // Re-throw to let the main finally block handle job summary
      throw error;
    }
  }

  /**
   * Returns a summary of completed tool actions, or null if no tools were executed
   * (e.g. the LLM asked for clarification instead).
   */
  private async executeToolWorkflow(): Promise<string | null> {
    try {
      logger.info('Executing tool workflow...');
      const currentTask = this.tasks[this.tasks.length - 1];
      this.tool.setTask(currentTask);
      const result = await this.tool.execute();

      this.llmResponses.tool.push({ request: currentTask, response: result, timestamp: Date.now() });

      if (result.error) throw new Error(result.error);

      const executed = result.result?.toolResults ?? [];
      if (executed.length === 0) return null;
      return executed.map(r => r.message).join('; ');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.llmResponses.tool.push({
        request: this.tasks[this.tasks.length - 1],
        response: { error: errorMessage },
        timestamp: Date.now(),
      });
      logger.error(`Tool execution failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Re-read general settings and update context.options so that any
   * settings changed by the tool workflow take effect for the follow-up workflow.
   */
  private async reloadGeneralSettings(): Promise<void> {
    try {
      const settings = await generalSettingsStore.getSettings();
      const opts = this.context.options;
      opts.maxSteps = settings.maxSteps;
      opts.maxFailures = settings.maxFailures;
      opts.maxActionsPerStep = settings.maxActionsPerStep;
      opts.retryDelay = settings.retryDelay;
      opts.maxInputTokens = settings.maxInputTokens;
      opts.useVision = settings.useVision;
      opts.planningInterval = settings.planningInterval;
      logger.info('Reloaded general settings after tool workflow');
    } catch (e) {
      logger.warning('Failed to reload general settings:', e);
    }
  }

  private async executeAgentWorkflow(): Promise<void> {
    // Mark that this executor has run browser-use
    this.hasRunBrowserUse = true;

    const context = this.context;
    context.nSteps = 0;
    const allowedMaxSteps = this.context.options.maxSteps;

    try {
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.STEP_START, 'Starting browser automation...');

      let done = false;
      let step = 0;
      let validatorFailed = false;
      let webTask = undefined;
      for (step = 0; step < allowedMaxSteps; step++) {
        context.stepInfo = {
          stepNumber: context.nSteps,
          maxSteps: context.options.maxSteps,
        };

        if (step > 0) {
          workflowLogger.workflowStep(step + 1, allowedMaxSteps);
        }

        if (await this.shouldStop()) {
          break;
        }

        // Check if planner is enabled
        const isPlannerEnabled = !!(
          this.generalSettings?.useFullPlanningPipeline || this.generalSettings?.enablePlanner
        );
        const isPlanningStep = context.nSteps % context.options.planningInterval === 0 || validatorFailed;

        // Debug: Log planner activation check on first step
        if (step === 0) {
          logger.info('[Planner] Activation check:', {
            isPlannerEnabled,
            useFullPlanningPipeline: this.generalSettings?.useFullPlanningPipeline,
            enablePlanner: this.generalSettings?.enablePlanner,
            plannerExists: !!this.planner,
            nSteps: context.nSteps,
            planningInterval: context.options.planningInterval,
            isPlanningStep,
            willRunPlanner: isPlannerEnabled && this.planner && isPlanningStep,
          });
        }

        // Run planner when enabled (either legacy full pipeline or explicit enablePlanner)
        if (isPlannerEnabled && this.planner && isPlanningStep) {
          validatorFailed = false;
          // The first planning step is special, we don't want to add the browser state message to memory
          let positionForPlan = 0;
          if (this.tasks.length > 1 || step > 0) {
            await this.navigator.addStateMessageToMemory();
            positionForPlan = this.context.messageManager.length() - 1;
          } else {
            positionForPlan = this.context.messageManager.length();
          }

          const planOutput = await this.planner.execute();

          this.llmResponses.planner.push({
            step: step,
            response: planOutput,
            timestamp: Date.now(),
          });

          if (planOutput.result) {
            const observation = wrapUntrustedContent(planOutput.result.observation);
            const plan: PlannerOutput = {
              ...planOutput.result,
              observation,
            };
            this.context.messageManager.addPlan(JSON.stringify(plan), positionForPlan);

            if (webTask === undefined) {
              // set the web task, and keep it not change from now on
              webTask = planOutput.result.web_task;
            }

            if (planOutput.result.done) {
              // task is complete, skip navigation
              done = true;
              this.validator.setPlan(planOutput.result.next_steps);
            } else {
              // task is not complete, let's navigate
              this.validator.setPlan(null);
              done = false;
            }

            if (!webTask && planOutput.result.done) {
              break;
            }
          }
        }

        // execute the navigation step
        if (!done) {
          done = await this.navigate();
        }

        // Break early if done and validator is not enabled
        const isValidatorEnabled = !!(
          this.generalSettings?.useFullPlanningPipeline || this.generalSettings?.enableValidator
        );
        if (done) {
          const useValidator = this.context.options.validateOutput && isValidatorEnabled;

          // Debug: Log validator activation check when task is done
          logger.info('[Validator] Activation check:', {
            done,
            validateOutput: this.context.options.validateOutput,
            isValidatorEnabled,
            useFullPlanningPipeline: this.generalSettings?.useFullPlanningPipeline,
            enableValidator: this.generalSettings?.enableValidator,
            willRunValidator: useValidator,
          });

          if (!useValidator) {
            break;
          }
        }

        // Validate output only when enabled (legacy full pipeline or explicit enableValidator)
        if (
          done &&
          this.context.options.validateOutput &&
          isValidatorEnabled &&
          !this.context.stopped &&
          !this.context.paused
        ) {
          const validatorOutput = await this.validator.execute();

          this.llmResponses.validator.push({
            step: step,
            response: validatorOutput,
            timestamp: Date.now(),
          });

          if (validatorOutput.result?.is_valid) {
            break;
          }
          validatorFailed = true;
          context.consecutiveValidatorFailures++;
          if (context.consecutiveValidatorFailures >= context.options.maxValidatorFailures) {
            logger.error(`Stopping due to ${context.options.maxValidatorFailures} consecutive validator failures`);
            throw new Error('Too many failures of validation');
          }
        }
      }

      if (done) {
        // Prefer the final done action's text as the user-visible completion message
        let finalDoneText: string | undefined;
        try {
          const results = Array.isArray((this.context as any).actionResults)
            ? ((this.context as any).actionResults as Array<any>)
            : [];
          // DEBUG: Log all action results to understand output content extraction
          logger.info('[TASK_OK Debug] Searching actionResults for output content', {
            taskId: this.context.taskId,
            totalResults: results.length,
            resultsWithContent: results.filter(r => r?.extractedContent).length,
            resultsWithDone: results.filter(r => r?.isDone).length,
          });
          for (let i = results.length - 1; i >= 0; i--) {
            const r = results[i];
            if (r && (r.isDone === true || typeof r.extractedContent === 'string')) {
              logger.info('[TASK_OK Debug] Found candidate result', {
                index: i,
                isDone: r.isDone,
                hasExtractedContent: typeof r.extractedContent === 'string',
                extractedContentLength: r.extractedContent?.length ?? 0,
                extractedContentPreview: r.extractedContent?.substring?.(0, 200),
              });
              if (typeof r.extractedContent === 'string' && r.extractedContent.trim().length > 0) {
                const text = r.extractedContent.trim();
                finalDoneText = text;
                logger.info('[TASK_OK Debug] Using extractedContent as finalDoneText', {
                  length: text.length,
                  preview: text.substring(0, 200),
                });
                break;
              }
            }
          }
          if (!finalDoneText) {
            logger.warning('[TASK_OK Debug] No extractedContent found, using fallback message');
          }
        } catch (err) {
          logger.error('[TASK_OK Debug] Error extracting finalDoneText:', err);
        }
        // Get job summary for UI display
        const agentJobSummary = this.getJobSummary();
        const agentResponsesSummary = this.getLLMResponsesSummary();
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, finalDoneText || 'Task completed successfully', {
          summary: {
            totalInputTokens: agentJobSummary.totalInputTokens,
            totalOutputTokens: agentJobSummary.totalOutputTokens,
            totalCost: agentJobSummary.totalCost,
            totalLatencySeconds: Math.round(agentJobSummary.totalLatency / 1000),
            totalLatencyMs: Math.round(agentJobSummary.totalLatency),
            apiCallCount: agentResponsesSummary.total,
            modelName: agentJobSummary.modelName,
            provider: agentJobSummary.provider,
          },
        } as any);
        this._hasReachedTerminalState = true;
      } else if (step >= allowedMaxSteps) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, 'Task failed: Max steps reached');
        this._hasReachedTerminalState = true;
      } else if (this.context.stopped) {
      } else {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_PAUSE, 'Task paused');
      }
    } catch (error) {
      if (error instanceof RequestCancelledError) {
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, `Task failed: ${errorMessage}`);
        this._hasReachedTerminalState = true;
      }
    } finally {
      if (import.meta.env.DEV) {
        logger.debug('Executor history', JSON.stringify(this.context.history, null, 2));
      }
      // store the history only if replay is enabled
      if (this.generalSettings?.replayHistoricalTasks) {
        const historyString = JSON.stringify(this.context.history);
        logger.info(`Executor history size: ${historyString.length}`);
        await chatHistoryStore.storeAgentStepHistory(this.context.taskId, this.tasks[0], historyString);
      } else {
        logger.info('Replay historical tasks is disabled, skipping history storage');
      }
    }
  }

  private async navigate(): Promise<boolean> {
    const context = this.context;
    try {
      if (context.paused || context.stopped) {
        return false;
      }
      const navOutput = await this.navigator.execute();

      this.llmResponses.navigator.push({
        step: context.nSteps,
        response: navOutput,
        timestamp: Date.now(),
      });

      if (context.paused || context.stopped) {
        return false;
      }
      context.nSteps++;
      if (navOutput.error) {
        throw new Error(navOutput.error);
      }
      context.consecutiveFailures = 0;
      if (navOutput.result?.done) {
        return true;
      }
    } catch (error) {
      // All errors stop the workflow - the agent already emitted STEP_FAIL with the message
      logger.error(`Failed to execute step: ${error}`);
      throw error;
    }
    return false;
  }

  private async shouldStop(): Promise<boolean> {
    if (this.context.stopped) {
      logger.info('Agent stopped');
      return true;
    }

    while (this.context.paused) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (this.context.stopped) {
        return true;
      }
    }

    if (this.context.consecutiveFailures >= this.context.options.maxFailures) {
      logger.error(`Stopping due to ${this.context.options.maxFailures} consecutive failures`);
      return true;
    }

    return false;
  }

  async cancel(): Promise<void> {
    // Skip cancellation event if task already reached terminal state (completed/failed)
    if (this._hasReachedTerminalState) {
      try {
        await this.context.browserContext.cleanup();
      } catch {}
      return;
    }

    this._hasReachedTerminalState = true;
    this.context.stop();
    try {
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, 'Task cancelled');
    } catch {}
    try {
      await this.context.browserContext.cleanup();
    } catch {}
  }

  async resume(): Promise<void> {
    this.context.resume();
    try {
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_RESUME, 'Task resumed by user');
    } catch {}
  }

  async pause(): Promise<void> {
    this.context.pause();
    try {
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_PAUSE, 'Task paused by user');
    } catch {}
  }

  async cleanup(): Promise<void> {
    // Detach from browser tabs to release the Chrome debugger.
    // Note: This does NOT close tabs - they remain open for user interaction.
    // Tab closing is handled by TaskManager when user clicks "Close Tabs".
    try {
      await this.context.browserContext.cleanup();
    } catch (error) {
      logger.error(`Failed to cleanup browser context: ${error}`);
    }
  }

  /**
   * Pause the agent and emit a structured message requesting user control.
   */
  async requestUserControl(reason: string, tabId?: number): Promise<void> {
    try {
      this.context.emitEvent(Actors.AGENT_NAVIGATOR, ExecutionState.TASK_PAUSE, 'Requesting human intervention', {
        message: JSON.stringify({ type: 'request_user_control', reason, tabId }),
        tabId,
      });
      await this.context.pause();
    } catch {}
  }

  /**
   * Capture a screenshot of the agent's current page using Puppeteer/CDP.
   * Returns a base64 string (without data URI) when successful.
   */
  async captureCurrentPageScreenshot(): Promise<string | undefined> {
    try {
      const page = await this.context.browserContext.getCurrentPage();
      // Ensure the page is attached to Puppeteer before taking screenshot
      const attached = await this.context.browserContext.attachPage(page);
      if (!attached) {
        logger.debug('captureCurrentPageScreenshot: failed to attach page, attempting reconnect');
        // Try to detach and reattach
        await page.detachPuppeteer();
        const reattached = await page.attachPuppeteer();
        if (!reattached) {
          logger.debug('captureCurrentPageScreenshot: reconnect failed');
          return undefined;
        }
      }
      const b64 = await page.takeScreenshot();
      return b64 || undefined;
    } catch (e) {
      logger.debug('captureCurrentPageScreenshot failed', e);
      return undefined;
    }
  }

  async captureTabScreenshot(tabId: number): Promise<string | undefined> {
    try {
      logger.debug(`captureTabScreenshot called for tab ${tabId}`);

      // Pre-check if tab exists
      if (!(await tabExists(tabId))) return undefined;

      // First check if this is the current page
      let currentPage;
      try {
        currentPage = await this.context.browserContext.getCurrentPage();
      } catch (e: any) {
        // getCurrentPage can throw "No worker tab bound yet" - that's fine
        logger.debug(`captureTabScreenshot: Could not get current page: ${e?.message}`);
      }

      if (currentPage && currentPage.tabId === tabId) {
        logger.debug(`Tab ${tabId} is the current page, using it directly`);
        // Ensure it's attached
        try {
          const attached = await this.context.browserContext.attachPage(currentPage);
          if (attached) {
            const b64 = await currentPage.takeScreenshot();
            if (b64) {
              logger.debug(`Screenshot taken for current tab ${tabId}, size: ${b64.length}`);
            }
            return b64 || undefined;
          }
        } catch (e: any) {
          const msg = String(e?.message || '');
          if (msg.includes('No tab with') || msg.includes('Protocol error') || msg.includes('Target closed')) {
            logger.debug(`captureTabScreenshot: Tab ${tabId} became inaccessible during capture`);
            return undefined;
          }
          throw e;
        }
      }

      // Otherwise try to get the page by tab ID
      let page;
      try {
        page = await this.context.browserContext.getPageByTabId(tabId);
      } catch (e: any) {
        const msg = String(e?.message || '');
        if (msg.includes('No tab with') || msg.includes('Invalid tab')) {
          logger.debug(`captureTabScreenshot: Tab ${tabId} not found when getting page`);
          return undefined;
        }
        throw e;
      }

      logger.debug(`Got page for tab ${tabId}`);

      // The page should already be attached by getPageByTabId, but verify
      if (!page.attached) {
        logger.debug(`Page for tab ${tabId} not attached, attempting to attach`);
        try {
          const attached = await this.context.browserContext.attachPage(page);
          if (!attached) {
            logger.debug('captureTabScreenshot: failed to attach page', tabId);
            return undefined;
          }
        } catch (e: any) {
          const msg = String(e?.message || '');
          if (msg.includes('No tab with') || msg.includes('Another debugger')) {
            logger.debug(`captureTabScreenshot: Tab ${tabId} attachment failed: ${msg}`);
            return undefined;
          }
          throw e;
        }
      }

      logger.debug(`Page attached for tab ${tabId}, taking screenshot`);
      try {
        const b64 = await page.takeScreenshot();
        if (b64) {
          logger.debug(`Screenshot taken for tab ${tabId}, size: ${b64.length}`);
        }
        return b64 || undefined;
      } catch (e: any) {
        const msg = String(e?.message || '');
        if (msg.includes('No tab with') || msg.includes('Protocol error') || msg.includes('Target closed')) {
          logger.debug(`captureTabScreenshot: Tab ${tabId} became inaccessible during screenshot`);
          return undefined;
        }
        throw e;
      }
    } catch (e: any) {
      // Final catch-all - check if it's a tab-not-found error
      const msg = String(e?.message || '');
      if (msg.includes('No tab with') || msg.includes('Invalid tab') || msg.includes('Protocol error')) {
        logger.debug(`captureTabScreenshot: Tab ${tabId} error (${msg.slice(0, 50)})`);
        return undefined;
      }
      logger.error('captureTabScreenshot failed', e);
      return undefined;
    }
  }

  async getCurrentTaskId(): Promise<string> {
    return this.context.taskId;
  }

  /**
   * Get all captured LLM responses for this execution
   */
  getAllLLMResponses() {
    return this.llmResponses;
  }

  /**
   * Get LLM responses for a specific agent type
   */
  getLLMResponses(agentType: keyof typeof this.llmResponses) {
    return this.llmResponses[agentType];
  }

  /**
   * Get a summary of all LLM responses with counts
   */
  getLLMResponsesSummary() {
    return {
      auto: this.llmResponses.auto.length,
      chat: this.llmResponses.chat.length,
      search: this.llmResponses.search.length,
      navigator: this.llmResponses.navigator.length,
      planner: this.llmResponses.planner.length,
      validator: this.llmResponses.validator.length,
      total: Object.values(this.llmResponses).reduce((sum, responses) => sum + responses.length, 0),
    };
  }

  /**
   * Calculate total token usage and latency for this job using global token tracker
   */
  getJobSummary(jobStartTime?: number): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThoughtTokens: number;
    totalTokens: number;
    totalLatency: number;
    totalCost: number;
    apiCallCount: number;
    totalWebSearches: number;
    modelName?: string;
    provider?: string;
  } {
    const taskTokens = globalTokenTracker.getTokensForTask(this.context.taskId);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalThoughtTokens = 0;
    let totalTokens = 0;
    let totalLatency = 0;
    let totalCost = 0;
    let totalWebSearches = 0;
    let modelName: string | undefined;
    let provider: string | undefined;

    if (taskTokens.length > 0) {
      // Calculate totals from global token tracker
      totalInputTokens = taskTokens.reduce((sum: number, usage: any) => sum + usage.inputTokens, 0);
      totalOutputTokens = taskTokens.reduce((sum: number, usage: any) => sum + usage.outputTokens, 0);
      totalThoughtTokens = taskTokens.reduce((sum: number, usage: any) => sum + (usage.thoughtTokens || 0), 0);
      totalTokens = taskTokens.reduce((sum: number, usage: any) => sum + usage.totalTokens, 0);
      // Sum only valid costs (>= 0); if none found, total is -1 (unavailable)
      let hasAnyCost = false;
      totalCost = taskTokens.reduce((sum: number, usage: any) => {
        const cost = Number(usage.cost);
        if (isFinite(cost) && cost >= 0) {
          hasAnyCost = true;
          return sum + cost;
        }
        return sum;
      }, 0);
      if (!hasAnyCost) totalCost = -1;
      totalWebSearches = taskTokens.reduce((sum: number, usage: any) => sum + (usage.webSearchCount || 0), 0);

      // Extract model name and provider from the primary API call (usually the last/main one)
      if (taskTokens.length > 0) {
        const primaryUsage = taskTokens[taskTokens.length - 1]; // Use the last API call as primary
        modelName = primaryUsage.modelName;
        provider = primaryUsage.provider;
      }

      // Calculate latency - use full job execution time if available, otherwise fall back to API call timing
      if (jobStartTime) {
        totalLatency = Date.now() - jobStartTime;
      } else {
        // Fallback: Calculate latency from earliest start to latest completion
        const completionTimes = taskTokens
          .map((usage: any) => Number(usage.timestamp || 0))
          .filter((n: number) => Number.isFinite(n) && n > 0);
        const startTimes = taskTokens
          .map((usage: any) => Number(usage.requestStartTime || usage.timestamp || 0))
          .filter((n: number) => Number.isFinite(n) && n > 0);

        if (startTimes.length > 0 && completionTimes.length > 0) {
          totalLatency = Math.max(0, Math.max(...completionTimes) - Math.min(...startTimes));
        } else if (completionTimes.length > 1) {
          completionTimes.sort((a, b) => a - b);
          totalLatency = completionTimes[completionTimes.length - 1] - completionTimes[0];
        }
      }
    } else if (jobStartTime) {
      // Even if no API calls were tracked, calculate job latency
      totalLatency = Date.now() - jobStartTime;
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalThoughtTokens,
      totalTokens,
      totalLatency,
      totalCost,
      apiCallCount: taskTokens.length,
      totalWebSearches,
      modelName,
      provider,
    };
  }

  /**
   * Replays a saved history of actions with error handling and retry logic.
   *
   * @param history - The history to replay
   * @param maxRetries - Maximum number of retries per action
   * @param skipFailures - Whether to skip failed actions or stop execution
   * @param delayBetweenActions - Delay between actions in seconds
   * @returns List of action results
   */
  async replayHistory(
    sessionId: string,
    maxRetries = 3,
    skipFailures = true,
    delayBetweenActions = 2.0,
  ): Promise<ActionResult[]> {
    // Reset terminal state for replay execution
    this._hasReachedTerminalState = false;
    const results: ActionResult[] = [];
    const replayLogger = createLogger('Executor:replayHistory');

    logger.info('replay task', this.tasks[0]);

    try {
      const historyFromStorage = await chatHistoryStore.loadAgentStepHistory(sessionId);
      if (!historyFromStorage) {
        throw new Error('History not found');
      }

      const history = JSON.parse(historyFromStorage.history) as AgentStepHistory;
      if (history.history.length === 0) {
        throw new Error('History is empty');
      }
      logger.debug('Replaying history:', JSON.stringify(history, null, 2));
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_START, 'Replaying task history');

      for (let i = 0; i < history.history.length; i++) {
        const historyItem = history.history[i];

        // Check if execution should stop
        if (this.context.stopped) {
          replayLogger.info('Replay stopped by user');
          break;
        }

        // Execute the history step with enhanced method that handles all the logic
        const stepResults = await this.navigator.executeHistoryStep(
          historyItem,
          i,
          history.history.length,
          maxRetries,
          delayBetweenActions * 1000,
          skipFailures,
        );

        results.push(...stepResults);

        // If stopped during execution, break the loop
        if (this.context.stopped) {
          break;
        }
      }

      if (this.context.stopped) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, 'Replay cancelled');
        this._hasReachedTerminalState = true;
      } else {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, 'Replay completed');
        this._hasReachedTerminalState = true;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      replayLogger.error(`Replay failed: ${errorMessage}`);
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, `Replay failed: ${errorMessage}`);
      this._hasReachedTerminalState = true;
    }

    return results;
  }
}
