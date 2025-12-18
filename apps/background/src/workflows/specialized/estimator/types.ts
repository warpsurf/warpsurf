/**
 * Workflow Estimation Types
 * 
 * This module defines the core types for the workflow estimation system.
 * The estimation system predicts the cost and time required for agent workflows.
 */

/**
 * Represents a single step in the workflow plan
 */
export interface WorkflowStep {
  /** Brief title/description of the step */
  title: string;
  /** Estimated duration in seconds for the web agent to complete this step */
  web_agent_duration_s: number;
  /** Estimated duration in seconds for a human to complete this step */
  human_duration_s: number;
  /** Estimated number of tokens (input + output) for this step */
  num_tokens: number;
}

/**
 * Summary statistics for the entire workflow
 */
export interface WorkflowSummary {
  /** Total estimated duration for web agent across all steps (seconds) */
  total_agent_duration_s: number;
  /** Total estimated duration for human across all steps (seconds) */
  total_human_duration_s: number;
  /** Total estimated tokens across all steps */
  total_tokens: number;
  /** Estimated cost in USD for the entire workflow */
  estimated_cost_usd: number;
  /** Model name used for the workflow */
  model_name: string;
  /** Provider name for the model */
  provider: string;
  /** Estimated cost in USD for the estimation itself */
  estimation_cost_usd: number;
}

/**
 * Complete workflow estimation including steps and summary
 */
export interface WorkflowEstimation {
  /** Ordered list of workflow steps */
  steps: WorkflowStep[];
  /** Aggregated summary statistics */
  summary: WorkflowSummary;
}

/**
 * Interface for workflow estimators
 * This abstraction allows easy replacement with different estimation strategies
 * (e.g., LLM-based, trajectory-based, hybrid)
 */
export interface IEstimator {
  /**
   * Estimate the workflow for a given task
   * @param task - The user's task description
   * @param context - Optional context for estimation (e.g., previous trajectories)
   * @returns Promise resolving to a workflow estimation
   */
  estimateWorkflow(task: string, context?: any): Promise<WorkflowEstimation>;
  
  /**
   * Set the navigator model name that will execute the workflow
   * This is used to add model latency to step duration estimates
   * @param navigatorModelName - Name of the navigator model
   */
  setNavigatorModel?(navigatorModelName: string): void;
}

/**
 * Raw response from the LLM estimation
 */
export interface EstimationLLMResponse {
  steps: Array<{
    title: string;
    web_agent_duration_s: number;
    human_duration_s: number;
    num_tokens: number;
  }>;
}

