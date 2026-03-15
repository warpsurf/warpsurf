import { z } from 'zod';
import type BrowserContext from '@src/browser/context';
import type MessageManager from '@src/workflows/shared/messages/service';
import type { EventManager } from '@src/workflows/shared/event/event-bus';
import { type Actors, ExecutionState, AgentEvent } from '@src/workflows/shared/event/types';
import type { EventData } from '@src/workflows/shared/event/types';
import { AgentStepHistory } from '@src/workflows/shared/step-history';
import { DOMHistoryElement } from '@src/browser/dom/history/view';
import type { LoopDetector } from '@src/workflows/agent/loop-detector';
import type { Attachment } from '@extension/storage/lib/chat/types';

export type VisionMode = boolean | 'auto';

/** Returns true when vision capabilities are active (useVision is true or 'auto'). */
export function isVisionActive(mode: VisionMode): boolean {
  return mode === true || mode === 'auto';
}

export interface PlanItem {
  text: string;
  status: 'pending' | 'current' | 'done' | 'skipped';
}

export interface AgentOptions {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  maxValidatorFailures: number;
  retryDelay: number;
  maxInputTokens: number;
  maxErrorLength: number;
  useVision: VisionMode;
  useVisionForPlanner: boolean;
  validateOutput: boolean;
  includeAttributes: string[];
  planningInterval: number;
  /** Target screenshot dimensions [width, height] for the LLM. Auto-detected from model name. */
  llmScreenshotSize?: [number, number];
  /** Allow the agent to click at exact pixel coordinates from screenshots. */
  enableCoordinateClick?: boolean;
  /** Default search engine for web search actions (e.g., 'google', 'duckduckgo', 'bing'). */
  defaultSearchEngine?: string;
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = {
  maxSteps: 100,
  maxActionsPerStep: 10,
  maxFailures: 3,
  maxValidatorFailures: 3,
  retryDelay: 10,
  maxInputTokens: 128000,
  maxErrorLength: 400,
  useVision: 'auto',
  useVisionForPlanner: true,
  validateOutput: true,
  includeAttributes: [
    'title',
    'type',
    'name',
    'role',
    'aria-label',
    'placeholder',
    'value',
    'alt',
    'aria-expanded',
    'data-date-format',
    'checked',
    'data-state',
    'aria-checked',
    'href',
    'tabindex',
  ],
  planningInterval: 3,
};

export class AgentContext {
  controller: AbortController;
  taskId: string;
  browserContext: BrowserContext;
  messageManager: MessageManager;
  eventManager: EventManager;
  options: AgentOptions;
  paused: boolean;
  stopped: boolean;
  consecutiveFailures: number;
  consecutiveValidatorFailures: number;
  nSteps: number;
  stepInfo: AgentStepInfo | null;
  actionResults: ActionResult[];
  stateMessageAdded: boolean;
  history: AgentStepHistory;
  // Pre-built chat history messages (LangChain BaseMessage objects) from the side panel session
  chatHistoryMessages: any[];
  // Context tab IDs provided by user for reference
  contextTabIds: number[];
  // File/image attachments from user (in-memory, may include ephemeral large files)
  attachments: Attachment[];
  // Loop detection for stuck-agent nudges
  loopDetector: LoopDetector | null;
  // Structured plan tracking
  plan: PlanItem[] | null;
  currentPlanIndex: number;
  // Live user messages queued during execution (drained each step)
  pendingUserMessages: string[];
  // On-demand screenshot captured by the 'screenshot' action (consumed by prompt builder)
  pendingScreenshot: string | null;
  // URLs collected for site skill injection
  private _skillUrls: Set<string>;

  constructor(
    taskId: string,
    browserContext: BrowserContext,
    messageManager: MessageManager,
    eventManager: EventManager,
    options: Partial<AgentOptions>,
  ) {
    this.controller = new AbortController();
    this.taskId = taskId;
    this.browserContext = browserContext;
    this.messageManager = messageManager;
    this.eventManager = eventManager;
    this.options = { ...DEFAULT_AGENT_OPTIONS, ...options };

    this.paused = false;
    this.stopped = false;
    this.nSteps = 0;
    this.consecutiveFailures = 0;
    this.consecutiveValidatorFailures = 0;
    this.stepInfo = null;
    this.actionResults = [];
    this.stateMessageAdded = false;
    this.history = new AgentStepHistory();
    this.loopDetector = null;
    this.plan = null;
    this.currentPlanIndex = 0;
    this.pendingUserMessages = [];
    this.pendingScreenshot = null;
    this.chatHistoryMessages = [];
    this.contextTabIds = [];
    this.attachments = [];
    this._skillUrls = new Set();
  }

  /** Add a URL for site skill resolution. */
  addSkillUrl(url: string): void {
    if (url && /^https?:/i.test(url)) {
      this._skillUrls.add(url);
    }
  }

  /** Add multiple URLs for site skill resolution. */
  addSkillUrls(urls: string[]): void {
    for (const url of urls) {
      this.addSkillUrl(url);
    }
  }

  /** Get all collected skill URLs. */
  getSkillUrls(): string[] {
    return Array.from(this._skillUrls);
  }

  /** Clear skill URLs. */
  clearSkillUrls(): void {
    this._skillUrls.clear();
  }

  /** Replace the current plan with new steps. First step is marked current. */
  setPlan(steps: string[]): void {
    this.plan = steps.map((text, i) => ({
      text,
      status: i === 0 ? 'current' : 'pending',
    }));
    this.currentPlanIndex = 0;
  }

  /** Mark all plan items as done (call on task completion). */
  markPlanComplete(): void {
    if (!this.plan) return;
    for (const item of this.plan) {
      if (item.status === 'current' || item.status === 'pending') {
        item.status = 'done';
      }
    }
  }

  /** Advance the plan to a new index, marking intermediate steps done. */
  advancePlan(newIndex: number): void {
    if (!this.plan) return;
    const clamped = Math.max(0, Math.min(newIndex, this.plan.length - 1));
    if (clamped === this.currentPlanIndex) return;
    // Reset the old current item before moving
    if (this.plan[this.currentPlanIndex]?.status === 'current') {
      this.plan[this.currentPlanIndex].status = clamped > this.currentPlanIndex ? 'done' : 'pending';
    }
    // Mark intermediate steps done when advancing forward
    for (let i = this.currentPlanIndex + 1; i < clamped; i++) {
      if (this.plan[i].status === 'pending') {
        this.plan[i].status = 'done';
      }
    }
    this.plan[clamped].status = 'current';
    this.currentPlanIndex = clamped;
  }

  /** Drain all queued user messages, returning them (empty array if none). */
  drainUserMessages(): string[] {
    if (this.pendingUserMessages.length === 0) return [];
    const msgs = this.pendingUserMessages.splice(0);
    return msgs;
  }

  async emitEvent(actor: Actors, state: ExecutionState, eventDetails: string, additionalData?: Partial<EventData>) {
    // Try to include current page URL for trajectory tracking
    let pageUrl: string | undefined;
    let pageTitle: string | undefined;
    try {
      const page = await this.browserContext.getCurrentPage();
      if (page) {
        pageUrl = page.url() || undefined;
        pageTitle = await page.title().catch(() => undefined);
      }
    } catch {
      // Ignore - page may not be available
    }

    const event = new AgentEvent(actor, state, {
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.options.maxSteps,
      details: eventDetails,
      ...(pageUrl && { pageUrl }),
      ...(pageTitle && { pageTitle }),
      ...additionalData,
    });
    await this.eventManager.emit(event);
  }

  async emitStreamChunk(actor: Actors, text: string, streamId: string, isFinal = false) {
    await this.eventManager.emit(
      new AgentEvent(actor, ExecutionState.STEP_STREAMING, {
        taskId: this.taskId,
        step: this.nSteps,
        maxSteps: this.options.maxSteps,
        details: text,
        message: text,
        streamId,
        isFinal,
      }),
    );
  }

  async pause() {
    this.paused = true;
  }

  async resume() {
    this.paused = false;
  }

  async stop() {
    this.stopped = true;
    setTimeout(() => this.controller.abort(), 300);
  }
}

export class AgentStepInfo {
  stepNumber: number;
  maxSteps: number;

  constructor(params: { stepNumber: number; maxSteps: number }) {
    this.stepNumber = params.stepNumber;
    this.maxSteps = params.maxSteps;
  }
}

export class ActionResult {
  isDone: boolean;
  success: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;
  interactedElement: DOMHistoryElement | null;

  constructor(params: Partial<ActionResult> = {}) {
    this.isDone = params.isDone ?? false;
    this.success = params.success ?? false;
    this.interactedElement = params.interactedElement ?? null;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
  }
}

export type WrappedActionResult = ActionResult & {
  toolCallId: string;
};

export class StepMetadata {
  stepStartTime: number;
  stepEndTime: number;
  inputTokens: number;
  stepNumber: number;

  constructor(stepStartTime: number, stepEndTime: number, inputTokens: number, stepNumber: number) {
    this.stepStartTime = stepStartTime;
    this.stepEndTime = stepEndTime;
    this.inputTokens = inputTokens;
    this.stepNumber = stepNumber;
  }

  /**
   * Calculate step duration in seconds
   */
  get durationSeconds(): number {
    return this.stepEndTime - this.stepStartTime;
  }
}

export const agentBrainSchema = z
  .object({
    evaluation_previous_goal: z.string(),
    memory: z.string(),
    next_goal: z.string(),
  })
  .describe('Current state of the agent');

export type AgentBrain = z.infer<typeof agentBrainSchema>;

// Make AgentOutput generic with Zod schema
export interface AgentOutput<T = unknown> {
  /**
   * The unique identifier for the agent
   */
  id: string;

  /**
   * The result of the agent's step
   */
  result?: T;
  /**
   * The error that occurred during the agent's action
   */
  error?: string;
}
