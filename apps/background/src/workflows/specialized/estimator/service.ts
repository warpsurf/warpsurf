/**
 * Workflow Estimation Service
 *
 * Main orchestrator for workflow estimation.
 * This service is designed to be modular and easily replaceable.
 */

import { createLogger } from '@src/log';
import { AgentNameEnum, getDefaultDisplayNameFromProviderId } from '@extension/storage';
import { getAllProvidersDecrypted, getAllAgentModelsDecrypted } from '@src/crypto';
import { createChatModel } from '@src/workflows/models/factory';
import type { IEstimator, WorkflowEstimation } from './types';
import { LLMWorkflowEstimator } from './estimation-workflow';

const logger = createLogger('EstimationService');

/**
 * Workflow Estimation Service
 *
 * Provides a clean interface for workflow estimation.
 * The implementation can be easily swapped (e.g., LLM-based → trajectory-based)
 */
export class EstimationService {
  private estimator: IEstimator | null = null;
  private initialized = false;

  /**
   * Initialize the estimation service
   * Loads the configured estimator model from storage
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.info('Initializing estimation service...');

      const providers = await getAllProvidersDecrypted();
      const agentModels = await getAllAgentModelsDecrypted();

      // Get estimator model configuration
      const estimatorConfig = agentModels[AgentNameEnum.Estimator];

      if (!estimatorConfig) {
        // Fallback to planner model if no estimator configured
        logger.info('No estimator model configured, falling back to planner');
        const plannerConfig = agentModels[AgentNameEnum.AgentPlanner];

        if (!plannerConfig) {
          logger.warning('No planner model available either, estimation will fail');
          this.initialized = true;
          return;
        }

        const provider = providers[plannerConfig.provider];
        if (!provider) {
          logger.warning(`Provider '${getDefaultDisplayNameFromProviderId(plannerConfig.provider)}' not found`);
          this.initialized = true;
          return;
        }

        const chatModel = createChatModel(provider, plannerConfig);
        this.estimator = new LLMWorkflowEstimator(chatModel, plannerConfig.modelName, plannerConfig.provider);
      } else {
        const provider = providers[estimatorConfig.provider];
        if (!provider) {
          logger.warning(`Provider '${getDefaultDisplayNameFromProviderId(estimatorConfig.provider)}' not found`);
          this.initialized = true;
          return;
        }

        const chatModel = createChatModel(provider, estimatorConfig);
        this.estimator = new LLMWorkflowEstimator(chatModel, estimatorConfig.modelName, estimatorConfig.provider);
      }

      logger.info('Estimation service initialized successfully');
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize estimation service:', error);
      this.initialized = true; // Mark as initialized to prevent repeated attempts
    }
  }

  /**
   * Estimate the workflow for a given task
   *
   * @param task - User's task description
   * @param navigatorModelName - Name of the navigator model that will execute the workflow (for latency calculation)
   * @param taskId - The task/session ID for logging purposes
   * @param context - Optional context for estimation
   * @returns Promise resolving to workflow estimation
   * @throws Error if estimation service is not initialized or unavailable
   */
  async estimateTask(
    task: string,
    navigatorModelName?: string,
    taskId?: string,
    context?: any,
  ): Promise<WorkflowEstimation> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.estimator) {
      throw new Error('Estimation service not available (no model configured)');
    }

    // Set the navigator model if provided and estimator supports it
    if (navigatorModelName && this.estimator.setNavigatorModel) {
      this.estimator.setNavigatorModel(navigatorModelName);
    }

    // Set the task ID for logging if provided
    if (taskId && (this.estimator as any).setTaskId) {
      (this.estimator as any).setTaskId(taskId);
    }

    logger.info(`Estimating task: "${task.substring(0, 100)}${task.length > 100 ? '...' : ''}"`);

    try {
      const estimation = await this.estimator.estimateWorkflow(task, context);
      logger.info('Task estimation completed successfully');
      return estimation;
    } catch (error) {
      logger.error('Task estimation failed:', error);
      throw error;
    }
  }

  /**
   * Check if the estimation service is ready
   *
   * @returns True if the service is initialized and has an estimator
   */
  isReady(): boolean {
    return this.initialized && this.estimator !== null;
  }

  /**
   * Set a custom estimator implementation
   * This allows for easy replacement with trajectory-based or other estimators
   *
   * @param estimator - Custom estimator implementation
   */
  setEstimator(estimator: IEstimator): void {
    this.estimator = estimator;
    this.initialized = true;
    logger.info('Custom estimator set');
  }
}

// Export a singleton instance for easy use across the codebase
export const estimationService = new EstimationService();
