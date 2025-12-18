import { type BaseMessage, AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { MessageHistory, MessageMetadata } from '@src/workflows/shared/messages/views';
import { createLogger } from '@src/log';
import { wrapUserRequest, USER_REQUEST_TAG_START, USER_REQUEST_TAG_END } from '@src/workflows/shared/messages/utils';

const logger = createLogger('MessageManager');

export class MessageManagerSettings {
  maxInputTokens = 128000;
  estimatedCharactersPerToken = 3;
  imageTokens = 800;
  includeAttributes: string[] = [];
  messageContext?: string;
  sensitiveData?: Record<string, string>;
  availableFilePaths?: string[];
  minimalInit?: boolean;

  constructor(
    options: {
      maxInputTokens?: number;
      estimatedCharactersPerToken?: number;
      imageTokens?: number;
      includeAttributes?: string[];
      messageContext?: string;
      sensitiveData?: Record<string, string>;
      availableFilePaths?: string[];
    } = {},
  ) {
    if (options.maxInputTokens !== undefined) this.maxInputTokens = options.maxInputTokens;
    if (options.estimatedCharactersPerToken !== undefined)
      this.estimatedCharactersPerToken = options.estimatedCharactersPerToken;
    if (options.imageTokens !== undefined) this.imageTokens = options.imageTokens;
    if (options.includeAttributes !== undefined) this.includeAttributes = options.includeAttributes;
    if (options.messageContext !== undefined) this.messageContext = options.messageContext;
    if (options.sensitiveData !== undefined) this.sensitiveData = options.sensitiveData;
    if (options.availableFilePaths !== undefined) this.availableFilePaths = options.availableFilePaths;
    if ((options as any).minimalInit !== undefined) this.minimalInit = (options as any).minimalInit;
  }
}

export default class MessageManager {
  private history: MessageHistory;
  private toolId: number;
  private settings: MessageManagerSettings;
  private currentTaskIndex: number | null = null;

  constructor(settings: MessageManagerSettings = new MessageManagerSettings()) {
    this.settings = settings;
    this.history = new MessageHistory();
    this.toolId = 1;
  }

  public initTaskMessages(systemMessage: SystemMessage, task: string, messageContext?: string): void {
    // Add system message
    this.addMessageWithTokens(systemMessage, 'init');

    // Add context message if provided
    {/*
    if (messageContext && messageContext.length > 0) {
      const contextMessage = new HumanMessage({
        content: `Context for the task: ${messageContext}`,
      });
      this.addMessageWithTokens(contextMessage, 'init');
    }*/}

    // Add task instructions only if non-empty
    const normalizedTask = String(task || '').trim();
    if (normalizedTask.length > 0) {
      const taskMessage = MessageManager.taskInstructions(normalizedTask);
      this.addMessageWithTokens(taskMessage, 'init');
      this.currentTaskIndex = this.length() - 1;
    }

    // Add sensitive data info if sensitive data is provided
    if (this.settings.sensitiveData) {
      const info = `Here are placeholders for sensitive data: ${Object.keys(this.settings.sensitiveData)}`;
      const infoMessage = new HumanMessage({
        content: `${info}\nTo use them, write <secret>the placeholder name</secret>`,
      });
      this.addMessageWithTokens(infoMessage, 'init');
    }

    // Minimal scaffolding mode: skip example tool calls and placeholder messages
    if (!this.settings.minimalInit) {
      const placeholderMessage = new HumanMessage({
        content: 'Example output:',
      });
      this.addMessageWithTokens(placeholderMessage, 'init');

      const toolCallId = this.nextToolId();
      const toolCalls = [
        {
          name: 'AgentOutput',
          args: {
            current_state: {
              evaluation_previous_goal:
                `Success - I successfully clicked on the 'Apple' link from the Google Search results page, 
                which directed me to the 'Apple' company homepage. This is a good start toward finding 
                the best place to buy a new iPhone as the Apple website often list iPhones for sale.`.trim(),
              memory: `I searched for 'iPhone retailers' on Google. From the Google Search results page, 
                I used the 'click_element' tool to click on a element labelled 'Best Buy' but calling 
                the tool did not direct me to a new page. I then used the 'click_element' tool to click 
                on a element labelled 'Apple' which redirected me to the 'Apple' company homepage. 
                Currently at step 3/15.`.trim(),
              next_goal: `Looking at reported structure of the current page, I can see the item '[127]<h3 iPhone/>' 
                in the content. I think this button will lead to more information and potentially prices 
                for iPhones. I'll click on the link to 'iPhone' at index [127] using the 'click_element' 
                tool and hope to see prices on the next page.`.trim(),
            },
            action: [{ click_element: { index: 127 } }],
          },
          id: String(toolCallId),
          type: 'tool_call' as const,
        },
      ];

      const exampleToolCall = new AIMessage({
        content: '',
        tool_calls: toolCalls,
      });
      this.addMessageWithTokens(exampleToolCall, 'init');
      this.addToolMessage('Browser started', toolCallId, 'init');
    }

    // Add history start marker
    const historyStartMessage = new HumanMessage({
      content: '[Your task history memory starts here]',
    });
    this.addMessageWithTokens(historyStartMessage);

    // Add available file paths if provided
    if (this.settings.availableFilePaths && this.settings.availableFilePaths.length > 0) {
      const filepathsMsg = new HumanMessage({
        content: `Here are file paths you can use: ${this.settings.availableFilePaths}`,
      });
      this.addMessageWithTokens(filepathsMsg, 'init');
    }
  }

  public nextToolId(): number {
    const id = this.toolId;
    this.toolId += 1;
    return id;
  }

  /**
   * Createthe task instructions
   * @param task - The raw description of the task
   * @returns A HumanMessage object containing the task instructions
   */
  private static taskInstructions(task: string): HumanMessage {
    // If the initial task is empty, do not inject an idle directive. Workers will receive
    // a precise subtask via addNewTask before any actions are taken.
    const normalized = String(task || '').trim();
    const content = normalized.length > 0
      ? `Your ultimate task is: """${normalized}""". If you achieved your ultimate task, stop everything and use the done action in the next step to complete the task. If not, continue as usual.`
      : '';
    const wrappedContent = content ? wrapUserRequest(content) : '';
    return new HumanMessage({ content: wrappedContent });
  }

  /**
   * Returns the number of messages in the history
   * @returns The number of messages in the history
   */
  public length(): number {
    return this.history.messages.length;
  }

  /**
   * Adds a new task to execute, it will be executed based on the history
   * @param newTask - The raw description of the new task
   */
  public addNewTask(newTask: string): void {
    const content = `Your new ultimate task is: """${newTask}""". This is a follow-up of the previous tasks. Make sure to take all of the previous context into account and finish your new ultimate task.`;
    const wrappedContent = wrapUserRequest(content);
    const msg = new HumanMessage({ content: wrappedContent });
    this.addMessageWithTokens(msg);
  }

  /**
   * Adds a worker subtask instruction without the "Your new ultimate task is ..." phrasing.
   * This keeps worker requests to one current instruction while preserving history.
   */
  public addWorkerInstruction(instruction: string): void {
    const normalized = String(instruction || '').trim();
    if (!normalized) return;
    // Do NOT wrap as a new ultimate task; store plainly so the latest instruction is unambiguous
    const msg = new HumanMessage({ content: normalized });
    this.addMessageWithTokens(msg);
  }

  /**
   * Adds a plan message to the history
   * @param plan - The raw description of the plan
   * @param position - The position to add the plan
   */
  public addPlan(plan?: string, position?: number): void {
    if (plan) {
      const msg = new AIMessage({ content: `<plan>${plan}</plan>` });
      this.addMessageWithTokens(msg, null, position);
    }
  }

  /**
   * Adds a state message to the history
   * @param stateMessage - The HumanMessage object containing the state
   */
  public addStateMessage(stateMessage: HumanMessage): void {
    this.addMessageWithTokens(stateMessage);
  }

  /**
   * Adds a model output message to the history
   * @param modelOutput - The model output
   */
  public addModelOutput(modelOutput: Record<string, any>): void {
    const toolCallId = this.nextToolId();
    const toolCalls = [
      {
        name: 'AgentOutput',
        args: modelOutput,
        id: String(toolCallId),
        type: 'tool_call' as const,
      },
    ];

    const msg = new AIMessage({
      content: 'tool call',
      tool_calls: toolCalls,
    });
    this.addMessageWithTokens(msg);

    // Need a placeholder for the tool response here to avoid errors sometimes
    // NOTE: in browser-use, it uses an empty string
    this.addToolMessage('tool call response', toolCallId);
  }

  /**
   * Removes the last state message from the history
   */
  public removeLastStateMessage(): void {
    this.history.removeLastStateMessage();
  }

  public getMessages(): BaseMessage[] {
    const messages = this.history.messages.map(m => m.message);

    let totalInputTokens = 0;
    logger.debug(`Messages in history: ${this.history.messages.length}:`);

    for (const m of this.history.messages) {
      totalInputTokens += m.metadata.tokens;
      logger.debug(`${m.message.constructor.name} - Token count: ${m.metadata.tokens}`);
    }

    logger.debug(`Total input tokens: ${totalInputTokens}`);
    return messages;
  }

  /**
   * Append pre-built chat messages (from side-panel chat history) to the current message history.
   * Messages should already be LangChain BaseMessage instances (e.g., HumanMessage/AIMessage).
   */
  public addChatHistory(prebuiltMessages: BaseMessage[]): void {
    try {
      const lines: string[] = [];
      for (const m of prebuiltMessages) {
        const ctor = (m as any).constructor?.name;
        const isHuman = ctor === 'HumanMessage';
        const isAI = ctor === 'AIMessage';
        const isSystem = ctor === 'SystemMessage';
        const role = isHuman ? 'USER' : (isAI || isSystem ? 'ASSISTANT' : null);
        let text = typeof m.content === 'string' ? m.content : '';
        if (!text) continue;
        // Sanitize: strip any prior <nano_user_request> blocks so they don't appear in Chat History
        try {
          const start = USER_REQUEST_TAG_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const end = USER_REQUEST_TAG_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`${start}[\\s\\S]*?${end}`, 'g');
          text = text.replace(re, '').trim();
        } catch {}
        // Remove legacy markers
        if (text.includes('[Your task history memory starts here]')) continue;
        // Only include USER/ASSISTANT lines in Chat History; skip SYSTEM
        if (role) lines.push(`${role}: ${text}`);
      }
      const historyBlock = lines.join('\n');
      if (historyBlock.trim().length > 0) {
        const historyMsg = new HumanMessage({ content: `[Chat History]\n${historyBlock}` });
        this.addMessageWithTokens(historyMsg);
      }
    } catch {
      // fallback to raw append if formatting fails
      for (const msg of prebuiltMessages) {
        this.addMessageWithTokens(msg);
      }
    }
  }

  /**
   * Adds a message to the history with the token count metadata
   * @param message - The BaseMessage object to add
   * @param messageType - The type of the message (optional)
   * @param position - The optional position to add the message, if not provided, the message will be added to the end of the history
   */
  public addMessageWithTokens(message: BaseMessage, messageType?: string | null, position?: number): void {
    let filteredMessage = message;
    // filter out sensitive data if provided
    if (this.settings.sensitiveData) {
      filteredMessage = this._filterSensitiveData(message);
    }

    const tokenCount = this._countTokens(filteredMessage);
    const metadata: MessageMetadata = new MessageMetadata(tokenCount, messageType);
    this.history.addMessage(filteredMessage, metadata, position);
  }

  /**
   * Insert a preformatted Chat History block immediately after the history marker, if present.
   * Falls back to appending at the end if the marker is not found.
   */
  public insertChatHistoryBlock(blockText: string): void {
    const historyMarker = '[Your task history memory starts here]';
    let insertAt: number | null = null;
    try {
      const msgs: any[] = (this as any).history?.messages || [];
      // Prefer to insert immediately after the first SystemMessage (the navigator system prompt)
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i]?.message;
        if (m && (m instanceof SystemMessage)) {
          insertAt = i + 1;
          break;
        }
      }
      // Fallback: insert after legacy history marker if present
      if (insertAt == null) {
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i]?.message;
          if (m && typeof m.content === 'string' && m.content === historyMarker) {
            insertAt = i + 1;
            break;
          }
        }
      }
    } catch {}
    const historyMsg = new SystemMessage(blockText);
    if (insertAt != null) {
      this.addMessageWithTokens(historyMsg, undefined, insertAt);
    } else {
      this.addMessageWithTokens(historyMsg);
    }
  }

  // Note: Do not prune prior <nano_user_request> blocks here; agent step prompting depends on them.

  /**
   * Remove any existing Chat History blocks from the current message history.
   * Looks for HumanMessage entries starting with "[Chat History]".
   */
  public removeChatHistoryBlocks(): void {
    try {
      const msgs: any[] = (this as any).history?.messages || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]?.message;
        if (
          (m instanceof HumanMessage || m instanceof SystemMessage) &&
          typeof m.content === 'string' &&
          (m.content.startsWith('[Chat History]') || m.content.startsWith('<chat_history>'))
        ) {
          (this as any).history.removeMessage(i);
        }
      }
    } catch {}
  }

  /**
   * Upsert Chat History block: remove any existing Chat History blocks and insert the provided block
   * immediately after the system prompt (or after the legacy history marker if present).
   */
  public upsertChatHistoryBlock(blockText: string): void {
    try { this.removeChatHistoryBlocks(); } catch {}
    this.insertChatHistoryBlock(blockText);
  }

  /**
   * Reset the message history to a fresh single-agent prompt scaffold:
   * [System] + [Task instruction (Your ultimate task ...)] + [History marker].
   * Then the caller can insert Chat History via upsert/insert.
   *
   * If no systemMessage is provided, reuse the first SystemMessage from existing history if present.
   */
  public resetForSingleAgent(task: string, systemMessage?: SystemMessage): void {
    let sysMsg = systemMessage;
    try {
      if (!sysMsg) {
        const msgs: any[] = (this as any).history?.messages || [];
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i]?.message;
          if (m && (m instanceof SystemMessage)) { sysMsg = m as SystemMessage; break; }
        }
      }
    } catch {}
    if (!sysMsg) {
      // As a safety net, create a minimal system message if none exists
      sysMsg = new SystemMessage('');
    }
    // Reset message history
    this.history = new MessageHistory();
    this.currentTaskIndex = null;
    // Rebuild base scaffold identical to initTaskMessages()
    this.initTaskMessages(sysMsg, task, this.settings.messageContext);
  }

  /**
   * Filters out sensitive data from the message
   * @param message - The BaseMessage object to filter
   * @returns The filtered BaseMessage object
   */
  private _filterSensitiveData(message: BaseMessage): BaseMessage {
    const replaceSensitive = (value: string): string => {
      let filteredValue = value;
      if (!this.settings.sensitiveData) return filteredValue;

      for (const [key, val] of Object.entries(this.settings.sensitiveData)) {
        // Skip empty values to match Python behavior
        if (!val) continue;
        filteredValue = filteredValue.replace(val, `<secret>${key}</secret>`);
      }
      return filteredValue;
    };

    if (typeof message.content === 'string') {
      message.content = replaceSensitive(message.content);
    } else if (Array.isArray(message.content)) {
      message.content = message.content.map(item => {
        // Add null check to match Python's isinstance() behavior
        if (typeof item === 'object' && item !== null && 'text' in item) {
          return { ...item, text: replaceSensitive(item.text) };
        }
        return item;
      });
    }

    return message;
  }

  /**
   * Counts the tokens in the message
   * @param message - The BaseMessage object to count the tokens
   * @returns The number of tokens in the message
   */
  private _countTokens(message: BaseMessage): number {
    let tokens = 0;

    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if ('image_url' in item) {
          tokens += this.settings.imageTokens;
        } else if (typeof item === 'object' && 'text' in item) {
          tokens += this._countTextTokens(item.text);
        }
      }
    } else {
      let msg = message.content;
      // Check if it's an AIMessage with tool_calls
      if ('tool_calls' in message) {
        msg += JSON.stringify(message.tool_calls);
      }
      tokens += this._countTextTokens(msg);
    }

    return tokens;
  }

  /**
   * Counts the tokens in the text
   * Rough estimate, no tokenizer provided for now
   * @param text - The text to count the tokens
   * @returns The number of tokens in the text
   */
  private _countTextTokens(text: string): number {
    return Math.floor(text.length / this.settings.estimatedCharactersPerToken);
  }

  /**
   * Cuts the last message if the total tokens exceed the max input tokens
   *
   * Get current message list, potentially trimmed to max tokens
   */
  public cutMessages(): void {
    let diff = this.history.totalTokens - this.settings.maxInputTokens;
    if (diff <= 0) return;

    const lastMsg = this.history.messages[this.history.messages.length - 1];

    // if list with image remove image
    if (Array.isArray(lastMsg.message.content)) {
      let text = '';
      lastMsg.message.content = lastMsg.message.content.filter(item => {
        if ('image_url' in item) {
          diff -= this.settings.imageTokens;
          lastMsg.metadata.tokens -= this.settings.imageTokens;
          this.history.totalTokens -= this.settings.imageTokens;
          logger.debug(
            `Removed image with ${this.settings.imageTokens} tokens - total tokens now: ${this.history.totalTokens}/${this.settings.maxInputTokens}`,
          );
          return false;
        }
        if ('text' in item) {
          text += item.text;
        }
        return true;
      });
      lastMsg.message.content = text;
      this.history.messages[this.history.messages.length - 1] = lastMsg;
    }

    if (diff <= 0) return;

    // if still over, remove text from state message proportionally to the number of tokens needed with buffer
    // Calculate the proportion of content to remove
    const proportionToRemove = diff / lastMsg.metadata.tokens;
    if (proportionToRemove > 0.99) {
      throw new Error(
        `Max token limit reached - history is too long - reduce the system prompt or task. proportion_to_remove: ${proportionToRemove}`,
      );
    }
    logger.debug(
      `Removing ${(proportionToRemove * 100).toFixed(2)}% of the last message (${(proportionToRemove * lastMsg.metadata.tokens).toFixed(2)} / ${lastMsg.metadata.tokens.toFixed(2)} tokens)`,
    );

    const content = lastMsg.message.content as string;
    const charactersToRemove = Math.floor(content.length * proportionToRemove);
    const newContent = content.slice(0, -charactersToRemove);

    // remove tokens and old long message
    this.history.removeLastStateMessage();

    // new message with updated content
    const msg = new HumanMessage({ content: newContent });
    this.addMessageWithTokens(msg);

    const finalMsg = this.history.messages[this.history.messages.length - 1];
    logger.debug(
      `Added message with ${finalMsg.metadata.tokens} tokens - total tokens now: ${this.history.totalTokens}/${this.settings.maxInputTokens} - total messages: ${this.history.messages.length}`,
    );
  }

  /**
   * Adds a tool message to the history
   * @param content - The content of the tool message
   * @param toolCallId - The tool call id of the tool message, if not provided, a new tool call id will be generated
   * @param messageType - The type of the tool message
   */
  public addToolMessage(content: string, toolCallId?: number, messageType?: string | null): void {
    const id = toolCallId ?? this.nextToolId();
    const msg = new ToolMessage({ content, tool_call_id: String(id) });
    this.addMessageWithTokens(msg, messageType);
  }

  public setCurrentTask(task: string): void {
    const normalized = String(task || '').trim();
    const msg = MessageManager.taskInstructions(normalized);
    if (this.currentTaskIndex != null && this.currentTaskIndex >= 0 && this.currentTaskIndex < this.length()) {
      // Replace the existing current task message in place to avoid multiple nano_user_request blocks
      // Remove old at index and insert new, preserving token counts via re-add
      (this as any).history.removeMessage(this.currentTaskIndex);
      this.addMessageWithTokens(msg, 'init', this.currentTaskIndex);
    } else {
      this.addMessageWithTokens(msg, 'init');
      this.currentTaskIndex = this.length() - 1;
    }
  }
}

