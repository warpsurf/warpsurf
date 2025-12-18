/* eslint-disable @typescript-eslint/no-explicit-any */

export type RequestSummaryShape = {
  inputTokens: number;
  outputTokens: number;
  latency: string;
  cost: number;
  apiCalls: number;
  modelName?: string;
  provider?: string;
};

export function computeSummaryFromUsages(usages: Array<any>): { summary: RequestSummaryShape; latencyMs: number } {
  const list = Array.isArray(usages) ? usages : [];
  let inputTokens = 0, outputTokens = 0, cost = 0, hasAnyCost = false;
  const timestamps: number[] = [];
  let provider: string | undefined;
  let modelName: string | undefined;
  for (const u of list) {
    inputTokens += Math.max(0, Number(u?.inputTokens) || 0);
    outputTokens += Math.max(0, Number(u?.outputTokens) || 0);
    const uCost = Number(u?.cost);
    if (isFinite(uCost) && uCost >= 0) {
      cost += uCost;
      hasAnyCost = true;
    }
    const ts = Number(u?.timestamp || 0);
    if (Number.isFinite(ts) && ts > 0) timestamps.push(ts);
    provider = u?.provider || provider;
    modelName = u?.modelName || modelName;
  }
  // If no valid costs found, mark as unavailable (-1)
  if (!hasAnyCost) cost = -1;
  timestamps.sort((a, b) => a - b);
  let totalLatencyMs = 0;
  if (timestamps.length >= 2) totalLatencyMs = Math.max(0, timestamps[timestamps.length - 1] - timestamps[0]);
  else if (timestamps.length === 1) totalLatencyMs = 100;
  const latency = (totalLatencyMs / 1000).toFixed(2);
  return { summary: { inputTokens, outputTokens, latency, cost, apiCalls: list.length, modelName, provider }, latencyMs: totalLatencyMs };
}

export function applySummaryToMessage(
  messageId: string,
  summary: RequestSummaryShape,
  setRequestSummaries: React.Dispatch<React.SetStateAction<Record<string, any>>>,
  sessionIdRef: React.MutableRefObject<string | null>,
) {
  if (!messageId) return;
  setRequestSummaries(prev => {
    const existing = (prev as any)[messageId];
    // Guard: don't overwrite non-zero latency with zero
    if (existing && Number(existing.latency) > 0 && Number(summary.latency) === 0) return prev;
    const next = { ...prev, [messageId]: { ...(existing || {}), ...summary } } as any;
    try { if (sessionIdRef.current) (window as any).chatHistoryStore?.storeRequestSummaries?.(sessionIdRef.current, next); } catch {}
    return next;
  });
}

export function handleTokenLogForCancel(
  message: any,
  cancelMessageIdByTaskIdRef: React.MutableRefObject<Map<string, string>>,
  setRequestSummaries: React.Dispatch<React.SetStateAction<Record<string, any>>>,
  sessionIdRef: React.MutableRefObject<string | null>,
) {
  try {
    const taskId = String((message as any)?.taskId || '');
    const usages: Array<any> = Array.isArray((message as any)?.data) ? (message as any).data : [];
    if (!taskId || !cancelMessageIdByTaskIdRef.current.has(taskId)) return;
    const anchorId = cancelMessageIdByTaskIdRef.current.get(taskId) as string;
    const { summary } = computeSummaryFromUsages(usages);
    applySummaryToMessage(anchorId, summary, setRequestSummaries, sessionIdRef);
  } catch {}
}


