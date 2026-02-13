import { createLogger } from '@src/log';
import type { AgentContext, AgentOutput } from '../shared/agent-types';
import { Actors, ExecutionState } from '@src/workflows/shared/event/types';
import { isAbortedError, isTimeoutError } from '../shared/agent-errors';
import { buildToolSystemPrompt } from './tool-prompt';
import { executeToolCall, type ToolCallResult, type ToolContext } from './tool-handlers';
import { generalSettingsStore, agentModelStore, Actors as StorageActors } from '@extension/storage';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import { buildLLMMessagesWithHistory } from '@src/workflows/shared/utils/chat-history';
import { globalTokenTracker, type TokenUsage } from '@src/utils/token-tracker';
import { calculateCost } from '@src/utils/cost-calculator';
import { toUIErrorPayload } from '@src/workflows/models/model-error';

const logger = createLogger('ToolWorkflow');

export interface ToolWorkflowResult {
  toolResults: ToolCallResult[];
  textResponse?: string;
}

/**
 * Handles chat-driven settings configuration and read-only queries.
 * Parses structured JSON tool calls from LLM output and executes them
 * against extension storage APIs.
 */
export class ToolWorkflow {
  private toolLLM: any;
  private context: AgentContext;
  private currentTask?: string;

  constructor(toolLLM: any, context: AgentContext) {
    this.toolLLM = toolLLM;
    this.context = context;
  }

  setTask(task: string) {
    this.currentTask = task;
  }

  /**
   * Keep BrowserContext in sync with contextTabIds so worker-mode agent workflows
   * can access tabs that were added via the tool workflow.
   */
  private syncContextTabsToBrowserContext(tabIds: number[]): void {
    try {
      const browserContext: any = this.context?.browserContext as any;
      if (browserContext && typeof browserContext.setContextTabs === 'function') {
        browserContext.setContextTabs(tabIds);
      }
    } catch (e) {
      logger.debug('Failed to sync context tabs to browser context', e);
    }
  }

  async execute(): Promise<AgentOutput<ToolWorkflowResult>> {
    try {
      this.context.emitEvent(Actors.TOOL, ExecutionState.STEP_START, 'Processing tool request...');

      if (!this.currentTask) throw new Error('No task set');

      // Build lightweight settings snapshot and open tabs listing for context
      const snapshot = await this.buildSettingsSnapshot();
      const tabsListing = await this.buildOpenTabsListing();
      const systemPrompt = buildToolSystemPrompt(snapshot, tabsListing);

      // Build messages with chat history
      const sessionMessages = await this.getSessionMessages();
      const messages = buildLLMMessagesWithHistory(systemPrompt, sessionMessages, this.currentTask, {
        stripUserRequestTags: true,
      });

      const requestStartTime = Date.now();
      const response = await this.toolLLM.invoke(messages, { signal: this.context.controller.signal });

      // Log token usage
      this.logTokenUsage(response, requestStartTime, messages);

      // Parse the structured JSON response
      const content = typeof response.content === 'string' ? response.content : '';
      const parsed = this.parseResponse(content);

      // Execute tool calls
      let updatedContextTabIds: number[] | null = null;
      const toolCtx: ToolContext = {
        setContextTabIds: (ids: number[]) => {
          this.context.contextTabIds = ids;
          this.syncContextTabsToBrowserContext(ids);
          updatedContextTabIds = ids;
          logger.info(`Tool set ${ids.length} context tabs`);
        },
        removeContextTabIds: (idsToRemove: Set<number>) => {
          this.context.contextTabIds = this.context.contextTabIds.filter(id => !idsToRemove.has(id));
          this.syncContextTabsToBrowserContext(this.context.contextTabIds);
          updatedContextTabIds = this.context.contextTabIds;
          logger.info(`Tool removed tabs, ${this.context.contextTabIds.length} remaining`);
        },
      };

      const results: ToolCallResult[] = [];
      for (const call of parsed.toolCalls) {
        const result = await executeToolCall(call.name, call.args, toolCtx);
        results.push(result);

        // Emit per-call status event
        const isContextTabAction = result.data && (result.data as any).contextTabsMeta;
        if (!result.data || isContextTabAction) {
          const icon = result.success ? '✓' : '✗';
          const extra: any = {};
          if (updatedContextTabIds !== null) {
            extra.contextTabIds = updatedContextTabIds;
            updatedContextTabIds = null;
          }
          if (isContextTabAction) {
            extra.contextTabsMeta = (result.data as any).contextTabsMeta;
          }
          this.context.emitEvent(
            Actors.TOOL,
            result.success ? ExecutionState.STEP_OK : ExecutionState.STEP_FAIL,
            `${icon} ${result.message}`,
            Object.keys(extra).length > 0 ? extra : undefined,
          );
        }
      }

      // Build the text response
      // Only use the LLM's message if NO tools were called (e.g., clarification request).
      // When tools are executed, ignore any message the LLM added — the follow-up workflow handles output.
      let textResponse: string | undefined;

      if (results.length === 0) {
        // No tools executed — use the LLM's message (clarification or redirect)
        textResponse = parsed.message;
      } else {
        // Tools were executed — check for read-only tools that returned displayable data.
        // Exclude UI metadata (contextTabsMeta) which is only for the panel, not for display.
        const dataResults = results.filter(r => {
          if (!r.data) return false;
          const d = r.data as Record<string, unknown>;
          // contextTabsMeta is UI metadata, not display data
          if (d.contextTabsMeta && Object.keys(d).length === 1) return false;
          return true;
        });
        if (dataResults.length > 0) {
          // Format data results for display (e.g., get_current_settings)
          textResponse = await this.formatDataWithLLM(dataResults);
        }
        // Otherwise, no text response — the tool status messages are sufficient
      }

      let responseStreamId: string | undefined;
      let responseStreamTimestamp: number | undefined;
      if (textResponse) {
        responseStreamTimestamp = Date.now();
        responseStreamId = `tool_${responseStreamTimestamp}`;
        await this.context.emitStreamChunk(Actors.TOOL, textResponse, responseStreamId);
        await this.context.emitStreamChunk(Actors.TOOL, '', responseStreamId, true);
      }

      // Persist tool output to chat history so follow-up workflows see it
      await this.persistToHistory(results, textResponse, responseStreamId, responseStreamTimestamp);

      return { id: 'Tool', result: { toolResults: results, textResponse } };
    } catch (error) {
      if (isTimeoutError(error)) {
        const msg = error instanceof Error ? error.message : 'Response timed out';
        this.context.emitEvent(Actors.TOOL, ExecutionState.STEP_FAIL, msg);
        return { id: 'Tool', error: msg };
      }
      if (isAbortedError(error)) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, 'Task cancelled');
        return { id: 'Tool', error: 'cancelled' };
      }
      const uiError = toUIErrorPayload(error, 'Request failed');
      logger.error(`Tool workflow failed: ${uiError.error.rawMessage}`);
      this.context.emitEvent(Actors.TOOL, ExecutionState.STEP_FAIL, uiError.message, { error: uiError.error } as any);
      return { id: 'Tool', error: uiError.message };
    }
  }

  private parseResponse(content: string): {
    toolCalls: Array<{ name: string; args: Record<string, any> }>;
    message: string;
  } {
    // Strip markdown code fences that some models (Gemini) wrap JSON in
    let cleaned = content.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

    // Try direct parse first (most common case)
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        return {
          toolCalls: Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [],
          message: String(parsed.message || ''),
        };
      }
    } catch {}

    // Fallback: extract first JSON object from mixed content
    const match = cleaned.match(/\{[\s\S]*?\}(?=\s*$|\s*\{|\s*```)/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return {
          toolCalls: Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [],
          message: String(parsed.message || ''),
        };
      } catch (e) {
        logger.warning('Failed to parse extracted JSON:', e);
      }
    }

    // Last resort: treat entire response as a text message (no tool calls)
    logger.warning('Could not parse tool response as JSON, treating as text');
    return { toolCalls: [], message: content.trim() };
  }

  /**
   * Format data from read-only tool calls into a natural language response
   * by making a lightweight second LLM call.
   */
  private async formatDataWithLLM(dataResults: ToolCallResult[]): Promise<string> {
    const dataStr = dataResults.map(r => JSON.stringify(r.data, null, 2)).join('\n');
    try {
      const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
      const formatMessages = [
        new SystemMessage(
          'Format the data into a compact response. Rules:\n' +
            '- Use simple bullet points (- item)\n' +
            '- NO blank lines between items\n' +
            '- NO code blocks or backticks around model names\n' +
            '- NO headers or sections\n' +
            '- For model lists: "- modelName" on each line\n' +
            '- Keep it minimal and dense',
        ),
        new HumanMessage(`Request: ${this.currentTask}\n\nData:\n${dataStr}`),
      ];
      const resp = await this.toolLLM.invoke(formatMessages, { signal: this.context.controller.signal });
      const text = typeof resp.content === 'string' ? resp.content : '';
      this.logTokenUsage(resp, Date.now(), formatMessages);
      return text;
    } catch (e) {
      logger.warning('Failed to format data with LLM, falling back to plain text:', e);
      // Fallback: simple text formatting
      return dataResults
        .map(r => {
          if (typeof r.data !== 'object') return String(r.data);
          // Handle arrays (e.g., model lists)
          if (Array.isArray(r.data)) {
            return (r.data as string[]).map(item => `- ${item}`).join('\n');
          }
          return Object.entries(r.data as Record<string, any>)
            .map(([section, val]) => {
              if (typeof val !== 'object') return `**${section}**: ${val}`;
              if (Array.isArray(val)) {
                return `**${section}**:\n` + val.map((item: string) => `- ${item}`).join('\n');
              }
              return (
                `**${section}**:\n` +
                Object.entries(val as Record<string, any>)
                  .map(([k, v]: [string, any]) => `- ${k}: ${v?.modelName || v} (${v?.provider || ''})`)
                  .join('\n')
              );
            })
            .join('\n');
        })
        .join('\n');
    }
  }

  private async buildSettingsSnapshot(): Promise<string> {
    try {
      const general = await generalSettingsStore.getSettings();
      const models = await agentModelStore.getAllAgentModels();

      const modelSummary = Object.entries(models)
        .map(([role, config]: [string, any]) => {
          const temp = config.parameters?.temperature;
          const tempStr = temp !== undefined ? `, temp=${temp}` : '';
          return `  ${role}: ${config.modelName} (${config.provider}${tempStr})`;
        })
        .join('\n');

      // Only include non-default general settings to keep the snapshot compact
      const nonDefaults = Object.entries(general)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');

      return `[General]\n${nonDefaults}\n\n[Models]\n${modelSummary || '  (none configured)'}`;
    } catch (e) {
      logger.warning('Failed to build settings snapshot:', e);
      return '(unable to read current settings)';
    }
  }

  private async buildOpenTabsListing(): Promise<string> {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const eligible = tabs.filter(
        t => t.id && t.id > 0 && !t.url?.startsWith('chrome://') && !t.url?.startsWith('chrome-extension://'),
      );
      if (eligible.length === 0) return '(no open tabs)';
      const contextSet = new Set(this.context.contextTabIds);
      return eligible
        .map(t => {
          const flags = [t.active ? 'active' : '', contextSet.has(t.id!) ? 'in context' : '']
            .filter(Boolean)
            .join(', ');
          return `  [${t.id}] ${t.title || '(untitled)'}${flags ? ` (${flags})` : ''} — ${t.url || ''}`;
        })
        .join('\n');
    } catch (e) {
      logger.warning('Failed to build open tabs listing:', e);
      return '(unable to read open tabs)';
    }
  }

  private async getSessionMessages(): Promise<any[]> {
    try {
      const session = await chatHistoryStore.getSession(this.context.taskId);
      return session?.messages ?? [];
    } catch {
      return [];
    }
  }

  /** Persist tool actions to chat history so follow-up workflows and future sessions see them. */
  private async persistToHistory(
    results: ToolCallResult[],
    textResponse?: string,
    responseStreamId?: string,
    responseStreamTimestamp?: number,
  ): Promise<void> {
    try {
      const sessionId = this.context.taskId;
      if (!sessionId) return;

      // Persist tool action summaries
      const actionSummaries = results.filter(r => !r.data).map(r => r.message);
      if (actionSummaries.length > 0) {
        await chatHistoryStore.addMessage(sessionId, {
          actor: StorageActors.TOOL,
          content: actionSummaries.join('\n'),
          timestamp: Date.now(),
        });
      }

      // Persist formatted text response (from read-only queries)
      if (textResponse) {
        await chatHistoryStore.addMessage(sessionId, {
          actor: StorageActors.TOOL,
          content: textResponse,
          timestamp: typeof responseStreamTimestamp === 'number' ? responseStreamTimestamp : Date.now(),
          eventId: responseStreamId ? `stream:${responseStreamId}` : undefined,
        });
      }
    } catch (e) {
      logger.warning('Failed to persist tool output to history:', e);
    }
  }

  private logTokenUsage(response: any, requestStartTime: number, inputMessages?: any[]): void {
    try {
      const taskId = this.context?.taskId;
      if (!taskId) return;

      const usage = response?.usage_metadata || response?.usage;
      const inputTokens = Number(usage?.prompt_tokens || usage?.input_tokens || 0);
      const outputTokens = Number(usage?.completion_tokens || usage?.output_tokens || 0);

      const modelName = this.toolLLM?.modelName || 'unknown';
      // Calculate cost only if we have token counts, otherwise set to -1 (unavailable)
      const cost = inputTokens + outputTokens > 0 ? calculateCost(modelName, inputTokens, outputTokens) : -1;

      // Derive provider from model name pattern or LLM class name
      let provider = 'Chat';
      const llmClassName = this.toolLLM?.constructor?.name || '';
      if (llmClassName.includes('Gemini')) provider = 'Gemini';
      else if (llmClassName.includes('Anthropic')) provider = 'Anthropic';
      else if (llmClassName.includes('OpenRouter')) provider = 'OpenRouter';
      else if (llmClassName.includes('Grok')) provider = 'Grok';
      else if (llmClassName.includes('OpenAI')) provider = 'OpenAI';

      const tokenUsage: TokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        thoughtTokens: 0,
        webSearchCount: 0,
        timestamp: Date.now(),
        requestStartTime,
        provider,
        modelName,
        cost,
        taskId,
        role: 'tool',
        request: inputMessages
          ? { messages: inputMessages.map((m: any) => ({ role: m?.role, content: String(m?.content || '') })) }
          : undefined,
        response: typeof response.content === 'string' ? response.content : undefined,
      };

      const callId = `${taskId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      globalTokenTracker.addTokenUsage(callId, tokenUsage);
    } catch (e) {
      logger.debug('logTokenUsage error', e);
    }
  }
}
