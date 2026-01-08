import { createLogger } from '@src/log';
import { z } from 'zod';
import type { AgentContext, AgentOutput } from '../shared/agent-types';
import { Actors, ExecutionState } from '@src/workflows/shared/event/types';
import { isAbortedError, isTimeoutError } from '../shared/agent-errors';
import { systemPrompt } from './search-prompt';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import { buildLLMMessagesWithHistory } from '@src/workflows/shared/utils/chat-history';
import { globalTokenTracker, type TokenUsage } from '@src/utils/token-tracker';
import { calculateCost } from '@src/utils/cost-calculator';
import { buildContextTabsSystemMessage } from '@src/workflows/shared/context/context-tab-injector';
import { WorkflowType } from '@extension/shared/lib/workflows/types';

const logger = createLogger('SearchWorkflow');

export const searchOutputSchema = z.object({
  response: z.string(),
  done: z.boolean(),
  search_queries: z.array(z.string()).nullable().optional(),
  sources: z
    .array(
      z.union([z.string(), z.object({ url: z.string(), title: z.string().optional(), author: z.string().optional() })]),
    )
    .nullable()
    .optional(),
});

export type SearchOutput = z.infer<typeof searchOutputSchema>;

/**
 * Question-answering workflow with web search capabilities.
 * Uses streaming LLM responses for real-time display.
 */
export class SearchWorkflow {
  private currentTask?: string;
  private chatLLM: any;
  private context: AgentContext;

  constructor(chatLLM: any, context: AgentContext) {
    this.chatLLM = chatLLM;
    this.context = context;
  }

  setTask(task: string) {
    this.currentTask = task;
  }

  async execute(): Promise<AgentOutput<SearchOutput>> {
    try {
      this.context.emitEvent(Actors.SEARCH, ExecutionState.STEP_START, 'Searching...');

      if (!this.currentTask) throw new Error('No task set');

      const messages = buildLLMMessagesWithHistory(systemPrompt, await this.getSessionMessages(), this.currentTask, {
        stripUserRequestTags: true,
      });

      // Inject context tabs if available
      if (this.context.contextTabIds.length > 0) {
        try {
          const contextMsg = await buildContextTabsSystemMessage(this.context.contextTabIds, WorkflowType.SEARCH);
          if (contextMsg) {
            // Insert after system message (index 0)
            messages.splice(1, 0, contextMsg);
            logger.info(`Injected context from ${this.context.contextTabIds.length} tabs`);
          }
        } catch (e) {
          logger.warn('Failed to inject context tabs:', e);
        }
      }

      const requestStartTime = Date.now();
      const streamId = `search_${requestStartTime}`;
      let response = '';
      let usage: any = null;

      for await (const chunk of this.chatLLM.invokeStreaming(messages, this.context.controller.signal)) {
        if (chunk.done) {
          usage = chunk.usage;
          break;
        }
        response += chunk.text;
        await this.context.emitStreamChunk(Actors.SEARCH, chunk.text, streamId);
      }
      await this.context.emitStreamChunk(Actors.SEARCH, '', streamId, true);

      // Log token usage
      this.logTokenUsage(usage, requestStartTime);

      return { id: 'Search', result: { response, done: true, search_queries: [] } };
    } catch (error) {
      if (isTimeoutError(error)) {
        const msg = error instanceof Error ? error.message : 'Response timed out';
        this.context.emitEvent(Actors.SEARCH, ExecutionState.STEP_FAIL, msg);
        return { id: 'Search', error: msg };
      }
      if (isAbortedError(error)) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, 'Task cancelled');
        return { id: 'Search', error: 'cancelled' };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Search failed: ${errorMessage}`);
      this.context.emitEvent(Actors.SEARCH, ExecutionState.STEP_FAIL, errorMessage);
      return { id: 'Search', error: errorMessage };
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

  private logTokenUsage(usage: any, requestStartTime?: number): void {
    if (!usage) return;
    try {
      const taskId = this.context?.taskId;
      if (!taskId) return;

      const inputTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
      const outputTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
      const totalTokens = inputTokens + outputTokens;
      if (totalTokens === 0) return;

      const modelName = this.chatLLM?.modelName || 'unknown';
      const cost = calculateCost(modelName, inputTokens, outputTokens);

      const tokenUsage: TokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens,
        thoughtTokens: 0,
        webSearchCount: 0,
        timestamp: Date.now(),
        requestStartTime,
        provider: 'Search',
        modelName,
        cost,
        taskId,
        role: 'search',
      };

      const callId = `${taskId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      globalTokenTracker.addTokenUsage(callId, tokenUsage);
    } catch (e) {
      logger.debug('logTokenUsage error', e);
    }
  }
}
