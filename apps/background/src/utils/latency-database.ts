/**
 * Static latency defaults.
 */

export interface LatencyEntry {
  /** Time to First Answer Token in seconds (for reasoning models) */
  ttfa?: number;
  /** Time to First Token in seconds */
  ttft?: number;
  /** Output tokens per second */
  tps?: number;
}

export const DEFAULT_LATENCY: Required<LatencyEntry> = {
  ttfa: 1.5,
  ttft: 1,
  tps: 80,
};

export const LATENCY_DATABASE: Record<string, LatencyEntry> = {};
