/**
 * LLM-based Workflow Estimator
 *
 * Uses an LLM to generate workflow plans with duration and cost estimates.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLogger } from '@src/log';
import type { IEstimator, WorkflowEstimation, EstimationLLMResponse } from './types';
import { EstimationSystemPrompt } from './estimation-prompt';
import { summarizeEstimation, calculateTokenCost, addModelLatencyToSteps } from './calculator';
import { globalTokenTracker, logLLMUsage } from '@src/utils/token-tracker';
import { getChatHistoryForSession } from '@src/workflows/shared/utils/chat-history';

const logger = createLogger('LLMWorkflowEstimator');

/**
 * LLM-based implementation of the workflow estimator
 */
export class LLMWorkflowEstimator implements IEstimator {
  private navigatorModelName: string | undefined;
  private currentTaskId: string | undefined;

  constructor(
    private chatModel: BaseChatModel,
    private modelName: string,
    private provider: string,
  ) {}

  /**
   * Set the task ID for logging purposes
   * @param taskId - The current task/session ID
   */
  setTaskId(taskId: string): void {
    this.currentTaskId = taskId;
  }

  /**
   * Set the navigator model name that will execute the workflow
   * @param navigatorModelName - Name of the navigator model
   */
  setNavigatorModel(navigatorModelName: string): void {
    this.navigatorModelName = navigatorModelName;
    logger.info(`Navigator model set to: ${navigatorModelName}`);
  }

  /**
   * Estimate workflow using the LLM
   *
   * @param task - User's task description
   * @param context - Optional context (for future trajectory-based estimation)
   * @returns Promise resolving to workflow estimation
   */
  async estimateWorkflow(task: string, context?: any): Promise<WorkflowEstimation> {
    logger.info(`Starting workflow estimation for task: "${task}"`);

    const startTime = Date.now();

    try {
      // Build messages with chat history context
      const messages: BaseMessage[] = [new SystemMessage(EstimationSystemPrompt)];

      // Inject chat history if session ID is available
      if (this.currentTaskId) {
        const historyBlock = await getChatHistoryForSession(this.currentTaskId, {
          latestTaskText: task,
          stripUserRequestTags: true,
          maxTurns: 6,
        });
        if (historyBlock) {
          messages.push(new SystemMessage(historyBlock));
        }
      }

      messages.push(new HumanMessage(`Please estimate the workflow for this task:\n\n${task}`));

      // Set up token tracking for this estimation call
      const taskId = this.currentTaskId || 'unknown';
      const prevTaskId = globalTokenTracker.getCurrentTaskId();
      const prevRole = globalTokenTracker.getCurrentRole();
      globalTokenTracker.setCurrentTaskId(taskId);
      globalTokenTracker.setCurrentRole('estimator');

      // Call LLM
      logger.info('Invoking LLM for estimation...');
      let response: any;
      try {
        response = await this.chatModel.invoke(messages);
      } finally {
        // Restore previous tracking context
        globalTokenTracker.setCurrentTaskId(prevTaskId || 'unknown');
        globalTokenTracker.setCurrentRole(prevRole);
      }

      const elapsedMs = Date.now() - startTime;
      logger.info(`LLM estimation completed in ${elapsedMs}ms`);

      // Log the API call for session logs
      try {
        const inputMessages = messages.map(m => ({
          role: m._getType() === 'system' ? 'system' : 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }));
        logLLMUsage(response, {
          taskId,
          role: 'estimator',
          modelName: this.modelName,
          provider: this.provider,
          inputMessages,
        });
      } catch (e) {
        logger.error('Failed to log estimator usage:', e);
      }

      // Parse response
      const estimation = this.parseEstimationResponse(response.content);

      // NOTE: Do NOT add model latency here - the LLM estimates already include implicit latency
      // The latency will be added dynamically in the UI when users compare models
      // This prevents double-counting and allows accurate model-to-model comparisons

      // Calculate estimation cost (based on response token usage if available)
      let estimationCost = 0;
      try {
        // Try to get actual token usage from response
        const usage = (response as any).usage_metadata || (response as any).response_metadata?.usage;
        if (usage) {
          const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
          const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
          const totalTokens = inputTokens + outputTokens;
          estimationCost = calculateTokenCost(totalTokens, this.modelName);
          logger.info(`Estimation used ${totalTokens} tokens (cost: $${estimationCost.toFixed(4)})`);
        } else {
          // Fallback: estimate based on prompt length
          const estimatedTokens = Math.ceil((EstimationSystemPrompt.length + task.length) / 3) + 500;
          estimationCost = calculateTokenCost(estimatedTokens, this.modelName);
          logger.info(`Estimation cost estimated at $${estimationCost.toFixed(4)} (no usage data)`);
        }
      } catch (e) {
        logger.error('Failed to calculate estimation cost:', e);
      }

      // Add summary
      const summary = summarizeEstimation(estimation.steps, this.modelName, this.provider, estimationCost);

      const result: WorkflowEstimation = {
        steps: estimation.steps,
        summary,
      };

      // Use safe cost formatting - handle potential null/NaN from JSON serialization
      const costStr =
        summary.estimated_cost_usd != null && !isNaN(summary.estimated_cost_usd)
          ? `~$${summary.estimated_cost_usd.toFixed(3)}`
          : 'cost unavailable';
      logger.info(
        `Estimation complete: ${result.steps.length} steps, ~${Math.round(summary.total_agent_duration_s || 0)}s (base LLM estimate), ${costStr}`,
      );

      return result;
    } catch (error) {
      logger.error('Workflow estimation failed:', error);
      // Return a minimal fallback estimation
      return this.getFallbackEstimation(task);
    }
  }

  /**
   * Parse the LLM response into a structured estimation
   *
   * @param content - Raw LLM response content
   * @returns Parsed estimation response
   */
  private parseEstimationResponse(content: string | any): EstimationLLMResponse {
    try {
      // Handle both string and object responses
      let jsonStr: string;
      if (typeof content === 'string') {
        jsonStr = content;
      } else {
        jsonStr = JSON.stringify(content);
      }

      // Try to extract JSON from response
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate structure
      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        throw new Error('Invalid response structure: missing steps array');
      }

      // Validate each step
      for (const step of parsed.steps) {
        if (
          !step.title ||
          typeof step.web_agent_duration_s !== 'number' ||
          typeof step.human_duration_s !== 'number' ||
          typeof step.num_tokens !== 'number'
        ) {
          throw new Error('Invalid step structure');
        }
        // Ensure positive values
        step.web_agent_duration_s = Math.max(1, Math.round(step.web_agent_duration_s));
        step.human_duration_s = Math.max(1, Math.round(step.human_duration_s));
        step.num_tokens = Math.max(100, Math.round(step.num_tokens));
      }

      logger.info(`Parsed ${parsed.steps.length} steps from LLM response`);
      return parsed as EstimationLLMResponse;
    } catch (error) {
      logger.error('Failed to parse estimation response:', error);
      throw error;
    }
  }

  /**
   * Generate a fallback estimation when the LLM fails
   *
   * @param task - User's task description
   * @returns Minimal fallback estimation
   */
  private getFallbackEstimation(task: string): WorkflowEstimation {
    logger.error('Using fallback estimation');

    // Create a simple single-step fallback
    const steps = [
      {
        title: 'Complete task',
        web_agent_duration_s: 60,
        human_duration_s: 15,
        num_tokens: 5000,
      },
    ];

    const summary = summarizeEstimation(steps, this.modelName, this.provider, 0);

    return { steps, summary };
  }
}
