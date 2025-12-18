import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from '../shared/base-agent';
import { createLogger } from '@src/log';
import { z } from 'zod';
import type { AgentOutput } from '../shared/agent-types';
import { Actors, ExecutionState } from '@src/workflows/shared/event/types';
import { isAbortedError, isTimeoutError } from '../shared/agent-errors';
import { systemPrompt } from './chat-prompt';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import { buildLLMMessagesWithHistory } from '@src/workflows/shared/utils/chat-history';

const logger = createLogger('ChatWorkflow');

// Define Zod schema for chat output
export const chatOutputSchema = z.object({
  response: z.string(),
  done: z.boolean(),
});

export type ChatOutput = z.infer<typeof chatOutputSchema>;

/**
 * Simple question-answering workflow without browser interaction.
 * Uses LLM for direct text responses to user queries.
 */
export class ChatWorkflow extends BaseAgent<typeof chatOutputSchema, ChatOutput> {
  private currentTask?: string;

  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(chatOutputSchema, options, { ...extraOptions, id: 'Chat' });
  }

  setTask(task: string) {
    this.currentTask = task;
  }

  async execute(): Promise<AgentOutput<ChatOutput>> {
    try {
      // Emit STEP_START event for loading indicator
      this.context.emitEvent(Actors.CHAT, ExecutionState.STEP_START, 'Processing request...');

      // Get the current task
      if (!this.currentTask) {
        throw new Error('No current task set');
      }
      logger.info('Current task:', this.currentTask);

      // Build messages using shared Chat History builder
      let sessionMsgs: any[] = [];
      try {
        const session = await chatHistoryStore.getSession(this.context.taskId);
        sessionMsgs = Array.isArray(session?.messages) ? session!.messages : [];
      } catch {}
      const llmMessages = buildLLMMessagesWithHistory(
        systemPrompt,
        sessionMsgs as any,
        this.currentTask,
        { stripUserRequestTags: true }
      );

      const modelOutput = await this.invoke(llmMessages);
      if (!modelOutput) {
        throw new Error('Failed to get response from LLM');
      }

      logger.info('Raw model output:', JSON.stringify(modelOutput));
      
      // Handle case where response might not be in expected format
      let responseText = modelOutput.response;
      if (!responseText && typeof modelOutput === 'string') {
        responseText = modelOutput;
      }
      
      if (!responseText) {
        throw new Error('No response text found in model output');
      }

      // Emit the response as a CHAT message that will be displayed
      logger.info('Emitting STEP_OK event with response:', responseText);
      this.context.emitEvent(Actors.CHAT, ExecutionState.STEP_OK, responseText);
      logger.info('Chat response generated:', responseText);

      return {
        id: this.id,
        result: modelOutput,
      };
    } catch (error) {
      // 1. Check timeout FIRST - we track this separately since SDK just says "aborted"
      if (isTimeoutError(error)) {
        const msg = error instanceof Error ? error.message : 'Response timed out';
        logger.error(`Chat timeout: ${msg}`);
        this.context.emitEvent(Actors.CHAT, ExecutionState.STEP_FAIL, msg);
        return { id: this.id, error: msg };
      }

      // 2. Check user cancellation - deliberate action, not an error
      if (isAbortedError(error)) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, 'Task cancelled');
        return { id: this.id, error: 'cancelled' } as any;
      }

      // 3. All other errors - propagate the actual provider error message
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Chat processing failed: ${errorMessage}`);
      this.context.emitEvent(Actors.CHAT, ExecutionState.STEP_FAIL, errorMessage);
      return { id: this.id, error: errorMessage };
    }
  }
}

