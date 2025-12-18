#!/usr/bin/env npx tsx
/**
 * Generate the static latency defaults file.
 *
 * Usage: pnpm generate-latency-cache
 *
 * This script writes `apps/background/src/utils/latency-database.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';

const DEFAULTS = {
  ttfa: 1.5,
  ttft: 1,
  tps: 80,
} as const;

function generateFileContent(): string {
  return `/**
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
  ttfa: ${DEFAULTS.ttfa},
  ttft: ${DEFAULTS.ttft},
  tps: ${DEFAULTS.tps},
};

export const LATENCY_DATABASE: Record<string, LatencyEntry> = {};
`;
}

async function main() {
  const outputPath = path.join(__dirname, '../apps/background/src/utils/latency-database.ts');
  fs.writeFileSync(outputPath, generateFileContent());
  console.log(`[generate-latency-cache] Wrote defaults to ${outputPath}`);
}

main();
