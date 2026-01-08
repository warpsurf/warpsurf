import { createLogger } from '@src/log';
import { z } from 'zod';
import type { AgentContext, AgentOutput } from '../shared/agent-types';
import { Actors, ExecutionState } from '@src/workflows/shared/event/types';
import { isAbortedError, isTimeoutError } from '../shared/agent-errors';
import { systemPrompt } from './chat-prompt';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import { buildLLMMessagesWithHistory } from '@src/workflows/shared/utils/chat-history';
import { globalTokenTracker, type TokenUsage } from '@src/utils/token-tracker';
import { calculateCost } from '@src/utils/cost-calculator';
import { buildContextTabsSystemMessage } from '@src/workflows/shared/context/context-tab-injector';
import { WorkflowType } from '@extension/shared/lib/workflows/types';

const logger = createLogger('ChatWorkflow');

export const chatOutputSchema = z.object({
  response: z.string(),
  done: z.boolean(),
});

export type ChatOutput = z.infer<typeof chatOutputSchema>;

/**
 * Simple question-answering workflow without browser interaction.
 * Uses streaming LLM responses for real-time display.
 */
export class ChatWorkflow {
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

  async execute(): Promise<AgentOutput<ChatOutput>> {
    try {
      this.context.emitEvent(Actors.CHAT, ExecutionState.STEP_START, 'Processing...');

      if (!this.currentTask) throw new Error('No task set');

      const messages = buildLLMMessagesWithHistory(systemPrompt, await this.getSessionMessages(), this.currentTask, {
        stripUserRequestTags: true,
      });

      // Inject context tabs if available
      if (this.context.contextTabIds.length > 0) {
        try {
          const contextMsg = await buildContextTabsSystemMessage(this.context.contextTabIds, WorkflowType.CHAT);
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
      const streamId = `chat_${requestStartTime}`;
      let response = '';
      let usage: any = null;

      for await (const chunk of this.chatLLM.invokeStreaming(messages, this.context.controller.signal)) {
        if (chunk.done) {
          usage = chunk.usage;
          break;
        }
        response += chunk.text;
        await this.context.emitStreamChunk(Actors.CHAT, chunk.text, streamId);
      }
      await this.context.emitStreamChunk(Actors.CHAT, '', streamId, true);

      // Log token usage
      this.logTokenUsage(usage, requestStartTime, messages, response);

      return { id: 'Chat', result: { response, done: true } };
    } catch (error) {
      if (isTimeoutError(error)) {
        const msg = error instanceof Error ? error.message : 'Response timed out';
        this.context.emitEvent(Actors.CHAT, ExecutionState.STEP_FAIL, msg);
        return { id: 'Chat', error: msg };
      }
      if (isAbortedError(error)) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, 'Task cancelled');
        return { id: 'Chat', error: 'cancelled' };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Chat failed: ${errorMessage}`);
      this.context.emitEvent(Actors.CHAT, ExecutionState.STEP_FAIL, errorMessage);
      return { id: 'Chat', error: errorMessage };
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

  private logTokenUsage(usage: any, requestStartTime?: number, inputMessages?: any[], responseText?: string): void {
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
        provider: 'Chat',
        modelName,
        cost,
        taskId,
        role: 'chat',
        request: inputMessages
          ? {
              messages: inputMessages.map((m: any) => ({ role: m?.role, content: String(m?.content || '') })),
            }
          : undefined,
        response: responseText,
      };

      const callId = `${taskId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      globalTokenTracker.addTokenUsage(callId, tokenUsage);
    } catch (e) {
      logger.debug('logTokenUsage error', e);
    }
  }
}
