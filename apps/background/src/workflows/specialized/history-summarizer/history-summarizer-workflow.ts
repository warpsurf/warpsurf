import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from '@src/workflows/shared/base-agent';
import { createLogger } from '@src/log';
import { z } from 'zod';
import type { AgentOutput } from '@src/workflows/shared/agent-types';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Actors, ExecutionState } from '@src/workflows/shared/event/types';
import { isAbortedError, isTimeoutError } from '@src/workflows/shared/agent-errors';
import { systemPrompt } from './history-summarizer-prompt';
import { formatHistoryForLLM, type ProcessedHistoryItem } from '@src/browser/history/preprocessor';

const logger = createLogger('HistorySummariserAgent');

// Define Zod schema for history summary output
export const historySummaryOutputSchema = z.object({
  summary: z.string(),
  keyTopics: z.array(z.string()),
  notableUrls: z.array(z.object({
    url: z.string(),
    title: z.string(),
    visitCount: z.number(),
    relevance: z.string(),
  })),
  categories: z.record(z.number()),
  patterns: z.string(),
  done: z.boolean(),
});

export type HistorySummaryOutput = z.infer<typeof historySummaryOutputSchema>;

export class HistorySummarizerWorkflow extends BaseAgent<
  typeof historySummaryOutputSchema,
  HistorySummaryOutput
> {
  private historyItems: ProcessedHistoryItem[] = [];

  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(historySummaryOutputSchema, options, { ...extraOptions, id: 'HistorySummarizer' });
  }

  /**
   * Set the preprocessed history items to analyze
   */
  setHistory(items: ProcessedHistoryItem[]) {
    this.historyItems = items;
    logger.info(`Set ${items.length} history items for summarization`);
  }

  async execute(): Promise<AgentOutput<HistorySummaryOutput>> {
    try {
      // Emit STEP_START event for loading indicator
      this.context.emitEvent(
        Actors.SYSTEM,
        ExecutionState.STEP_START,
        'Analyzing browser history...'
      );

      if (this.historyItems.length === 0) {
        throw new Error('No history items provided for summarization');
      }

      logger.info(`Summarizing ${this.historyItems.length} unique history items`);

      // Format history for LLM
      const historyText = formatHistoryForLLM(this.historyItems);
      
      // Estimate token usage
      const estimatedTokens = Math.ceil(historyText.length / 4);
      logger.info(`Estimated input tokens: ${estimatedTokens}`);

      // Build messages
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(historyText),
      ];

      // Call LLM
      const modelOutput = await this.invoke(messages);
      if (!modelOutput) {
        throw new Error('Failed to get response from history summariser');
      }

      logger.info('History summary generated successfully');
      logger.info('Summary:', modelOutput.summary);
      logger.info('Key topics:', modelOutput.keyTopics);

      // Emit the summary as a SYSTEM message
      const summaryMessage = `**Browser History Summary (Last ${this.historyItems.length} unique pages)**\n\n${modelOutput.summary}\n\n**Key Topics:** ${modelOutput.keyTopics.join(', ')}\n\n**Notable Pages:** ${modelOutput.notableUrls.length} identified`;
      
      this.context.emitEvent(
        Actors.SYSTEM,
        ExecutionState.STEP_OK,
        summaryMessage
      );

      return {
        id: this.id,
        result: modelOutput,
      };
    } catch (error) {
      // Check timeout first
      if (isTimeoutError(error)) {
        const msg = error instanceof Error ? error.message : 'Response timed out';
        logger.error(`History summarization timeout: ${msg}`);
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.STEP_FAIL, msg);
        return { id: this.id, error: msg };
      }

      // Check user cancellation
      if (isAbortedError(error)) {
        return { id: this.id, error: 'cancelled' } as any;
      }

      // All other errors - propagate actual message
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`History summarization failed: ${errorMessage}`);
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.STEP_FAIL, errorMessage);
      return { id: this.id, error: errorMessage };
    }
  }
}

