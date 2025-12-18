/* eslint-disable @typescript-eslint/no-explicit-any */

// Small utility to compute a per-message RequestSummary from session_logs
// payload returned by the background script for Agent v2 workflows.

export interface SessionLogsData {
  main: any[];
  workers: Record<number, any[]>;
  totals?: {
    perWorker: Record<number, { inputTokens: number; outputTokens: number; totalTokens: number; cost: number }>;
    overall: { inputTokens: number; outputTokens: number; totalTokens: number; cost: number };
  };
}

export interface RequestSummaryLike {
  inputTokens: number;
  outputTokens: number;
  latency: string; // seconds, stringified (e.g., "1.23")
  cost: number;
  apiCalls: number;
  modelName?: string;
  provider?: string;
}

export function computeRequestSummaryFromSessionLogs(data: SessionLogsData | null | undefined): { summary: RequestSummaryLike | null; totalLatencyMs: number } {
  if (!data) return { summary: null, totalLatencyMs: 0 };
  const main = Array.isArray((data as any).main) ? (data as any).main : [];
  const workersObj = (data as any).workers && typeof (data as any).workers === 'object' ? (data as any).workers : {};
  const workerArrays: any[] = Object.values(workersObj).flat();

  const usages: any[] = [...main, ...workerArrays];
  if (usages.length === 0) return { summary: null, totalLatencyMs: 0 };

  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let hasAnyCost = false;
  let apiCalls = 0;
  const timestamps: number[] = [];

  for (const u of usages) {
    inputTokens += Math.max(0, Number(u?.inputTokens) || 0);
    outputTokens += Math.max(0, Number(u?.outputTokens) || 0);
    const uCost = Number(u?.cost);
    if (isFinite(uCost) && uCost >= 0) {
      cost += uCost;
      hasAnyCost = true;
    }
    apiCalls += 1;
    const ts = Number(u?.timestamp || 0);
    if (Number.isFinite(ts) && ts > 0) timestamps.push(ts);
  }
  // If no valid costs found, mark as unavailable (-1)
  if (!hasAnyCost) cost = -1;

  timestamps.sort((a, b) => a - b);
  let totalLatencyMs = 0;
  if (timestamps.length >= 2) totalLatencyMs = Math.max(0, timestamps[timestamps.length - 1] - timestamps[0]);
  else if (timestamps.length === 1) totalLatencyMs = 100;

  const last = usages[usages.length - 1] || {};
  const provider = last?.provider || undefined;
  const modelName = last?.modelName || undefined;

  const latencySeconds = (totalLatencyMs / 1000).toFixed(2);

  return {
    summary: {
      inputTokens,
      outputTokens,
      latency: latencySeconds,
      cost,
      apiCalls,
      modelName,
      provider,
    },
    totalLatencyMs,
  };
}


