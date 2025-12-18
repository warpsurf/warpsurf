/**
 * Workflow Estimation Calculator
 * 
 * Pure functions for calculating costs and summarizing estimations.
 * Uses the existing Helicone-based cost calculator for accurate pricing.
 * Integrates latency estimates for realistic time estimates.
 */

import type { WorkflowStep, WorkflowSummary } from './types';
import { calculateCost } from '@src/utils/cost-calculator';
import { getModelLatency } from '@src/utils/latency-calculator';

/**
 * Calculate cost for a given number of tokens and model
 * Assumes 75% input tokens, 25% output tokens as a rough heuristic
 * Uses the existing Helicone-based cost calculator for accurate pricing
 * 
 * @param totalTokens - Total number of tokens (input + output)
 * @param modelName - Name of the model
 * @returns Cost in USD
 */
export function calculateTokenCost(totalTokens: number, modelName: string): number {
  // Heuristic: 75% input, 25% output
  const inputTokens = Math.round(totalTokens * 0.75);
  const outputTokens = Math.round(totalTokens * 0.25);
  
  // Use the existing cost calculator which has Helicone pricing data
  return calculateCost(modelName, inputTokens, outputTokens);
}

/**
 * Calculate total cost for all steps in the workflow
 * 
 * @param steps - Array of workflow steps
 * @param modelName - Name of the model that will execute the workflow
 * @returns Total cost in USD
 */
export function calculateWorkflowCost(steps: WorkflowStep[], modelName: string): number {
  const totalTokens = steps.reduce((sum, step) => sum + step.num_tokens, 0);
  return calculateTokenCost(totalTokens, modelName);
}

/**
 * Add model latency to workflow steps
 * 
 * Adds the Time to First Answer Token (TTFA) from latency database
 * to each step's web_agent_duration_s, since each step involves an LLM call.
 * 
 * @param steps - Array of workflow steps (will be modified in place)
 * @param navigatorModelName - Name of the navigator model used for workflow execution
 * @returns Modified steps array with latency added
 */
export function addModelLatencyToSteps(
  steps: WorkflowStep[],
  navigatorModelName: string,
): WorkflowStep[] {
  const latencyMetrics = getModelLatency(navigatorModelName);
  const ttfa = latencyMetrics.timeToFirstAnswerToken;
  const source = latencyMetrics.isEstimated ? 'default' : 'benchmarked';
  
  console.log(`[Estimation] Adding ${ttfa.toFixed(2)}s TTFA (${source}) to each step (${navigatorModelName})`);
  
  steps.forEach(step => {
    step.web_agent_duration_s += ttfa;
  });
  
  return steps;
}

/**
 * Summarize estimation results
 * 
 * @param steps - Array of workflow steps (with latency already added)
 * @param modelName - Name of the model that will execute the workflow
 * @param provider - Provider name
 * @param estimationCost - Cost of the estimation itself
 * @returns Complete workflow summary
 */
export function summarizeEstimation(
  steps: WorkflowStep[],
  modelName: string,
  provider: string,
  estimationCost: number = 0,
): WorkflowSummary {
  const total_agent_duration_s = steps.reduce((sum, step) => sum + step.web_agent_duration_s, 0);
  const total_human_duration_s = steps.reduce((sum, step) => sum + step.human_duration_s, 0);
  const total_tokens = steps.reduce((sum, step) => sum + step.num_tokens, 0);
  const estimated_cost_usd = calculateWorkflowCost(steps, modelName);
  
  return {
    total_agent_duration_s,
    total_human_duration_s,
    total_tokens,
    estimated_cost_usd,
    model_name: modelName,
    provider,
    estimation_cost_usd: estimationCost,
  };
}

/**
 * Format duration in seconds to human-readable string with appropriate rounding
 * 
 * Rounding Schema:
 * - < 10s: Round to nearest 1 second (keep precise for very short tasks)
 * - 10-60s: Round to nearest 5 seconds (e.g., 32s → 30s, 34s → 35s)
 * - 1-5 min: Round to nearest 15 seconds (e.g., 1m 51s → 2m, 2m 42s → 2m 45s)
 * - 5-30 min: Round to nearest minute (e.g., 12m 40s → 13m)
 * - 30+ min: Round to nearest 5 minutes (e.g., 42m → 40m)
 * 
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "2m", "30s", "2m 45s")
 */
export function formatDuration(seconds: number | null | undefined): string {
  // Handle null/undefined/NaN (NaN becomes null when JSON serialized)
  if (seconds == null || isNaN(seconds)) {
    return '—';
  }
  let roundedSeconds: number;
  
  if (seconds < 10) {
    // < 10s: Round to nearest second
    roundedSeconds = Math.round(seconds);
  } else if (seconds < 60) {
    // 10-60s: Round to nearest 5 seconds
    roundedSeconds = Math.round(seconds / 5) * 5;
  } else if (seconds < 300) {
    // 1-5 min: Round to nearest 15 seconds
    roundedSeconds = Math.round(seconds / 15) * 15;
  } else if (seconds < 1800) {
    // 5-30 min: Round to nearest minute
    roundedSeconds = Math.round(seconds / 60) * 60;
  } else {
    // 30+ min: Round to nearest 5 minutes
    roundedSeconds = Math.round(seconds / 300) * 300;
  }
  
  // Format the rounded value
  if (roundedSeconds < 60) {
    return `${roundedSeconds}s`;
  }
  
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format cost in USD to human-readable string
 * 
 * @param costUsd - Cost in USD (-1 or negative indicates no pricing available)
 * @returns Formatted string (e.g., "$0.05", "<$0.001", "—" for unavailable)
 */
export function formatCost(costUsd: number | null | undefined): string {
  // Handle null/undefined/NaN/negative - negative sentinel means no pricing available
  if (costUsd == null || isNaN(costUsd) || costUsd < 0) {
    return '—';
  }
  if (costUsd < 0.001) {
    return '<$0.001';
  }
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(3)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

