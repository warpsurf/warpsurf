import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from '../shared/base-agent';
import { createLogger } from '@src/log';
import { z } from 'zod';
import type { AgentOutput } from '../shared/agent-types';
import { Actors, ExecutionState } from '@src/workflows/shared/event/types';
import { isAbortedError, isTimeoutError } from '../shared/agent-errors';
import { systemPrompt } from './search-prompt';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import { buildLLMMessagesWithHistory } from '@src/workflows/shared/utils/chat-history';

const logger = createLogger('SearchWorkflow');

// Define Zod schema for search output
export const searchOutputSchema = z.object({
  response: z.string(),
  done: z.boolean(),
  search_queries: z.array(z.string()).nullable().optional(),
  sources: z
    .array(
      z.union([
        z.string(),
        z.object({
          url: z.string(),
          title: z.string().optional(),
          author: z.string().optional(),
        }),
      ]),
    )
    .nullable()
    .optional(),
});

export type SearchOutput = z.infer<typeof searchOutputSchema>;

/**
 * Question-answering workflow with web search capabilities.
 * Retrieves current information from the web before generating LLM responses.
 */
export class SearchWorkflow extends BaseAgent<typeof searchOutputSchema, SearchOutput> {
  private currentTask?: string;

  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(searchOutputSchema, options, { ...extraOptions, id: 'Search' });
  }

  setTask(task: string) {
    this.currentTask = task;
  }

  async execute(): Promise<AgentOutput<SearchOutput>> {
    try {
      // Emit STEP_START event for loading indicator
      this.context.emitEvent(Actors.SEARCH, ExecutionState.STEP_START, 'Searching and processing...');

      // Get the actual user task directly instead of searching through complex navigator messages
      if (!this.currentTask) {
        throw new Error('No current task set for search');
      }

      logger.info('=== Search Input ===');
      logger.info('User task:', this.currentTask);

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

      logger.info('=== Search Messages Being Sent ===');
      logger.info('System prompt length:', systemPrompt.length);
      logger.info('User message content:', this.currentTask);
      logger.info('Total messages:', llmMessages.length);

      const modelOutput = await this.invoke(llmMessages);
      if (!modelOutput) {
        throw new Error('Failed to get response from search');
      }

      logger.info('=== Search Output ===');
      logger.info('Raw model output:', JSON.stringify(modelOutput));
      
      // Handle case where response might not be in expected format
      let responseText = modelOutput.response;
      if (!responseText && typeof modelOutput === 'string') {
        responseText = modelOutput;
      }
      
      if (!responseText) {
        throw new Error('No response text found in model output');
      }

      // Emit the response as a SEARCH message that will be displayed, including optional search queries
      const maybeQueries = (modelOutput as any)?.search_queries as string[] | undefined;
      const maybeSources = (modelOutput as any)?.sources as Array<string | { url: string; title?: string; author?: string }> | undefined;
      const sourceUrls: string[] = Array.isArray(maybeSources)
        ? maybeSources
            .map(s => (typeof s === 'string' ? s : s?.url))
            .filter((u): u is string => typeof u === 'string' && !!u)
        : [];
      const sourceItems = Array.isArray(maybeSources)
        ? maybeSources
            .map(s =>
              typeof s === 'string'
                ? { url: s as string, title: undefined, author: undefined }
                : { url: s.url, title: s.title, author: s.author },
            )
            .filter(it => !!it.url)
        : [];
      this.context.emitEvent(Actors.SEARCH, ExecutionState.STEP_OK, responseText, {
        message: JSON.stringify({
          type: 'search_metadata',
          searchQueries: Array.isArray(maybeQueries) ? maybeQueries : [],
          sourceUrls,
          sourceItems,
        })
      });
      logger.info('Search response generated successfully');

      return {
        id: this.id,
        result: modelOutput,
      };
    } catch (error) {
      // 1. Check timeout FIRST - we track this separately since SDK just says "aborted"
      if (isTimeoutError(error)) {
        const msg = error instanceof Error ? error.message : 'Response timed out';
        logger.error(`Search timeout: ${msg}`);
        this.context.emitEvent(Actors.SEARCH, ExecutionState.STEP_FAIL, msg);
        return { id: this.id, error: msg };
      }

      // 2. Check user cancellation - deliberate action, not an error
      if (isAbortedError(error)) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, 'Task cancelled');
        return { id: this.id, error: 'cancelled' } as any;
      }

      // 3. All other errors - propagate the actual provider error message
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Search processing failed: ${errorMessage}`);
      this.context.emitEvent(Actors.SEARCH, ExecutionState.STEP_FAIL, errorMessage);
      return { id: this.id, error: errorMessage };
    }
  }
}

