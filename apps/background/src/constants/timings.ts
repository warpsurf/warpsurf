/**
 * Timing constants used throughout the background service
 * All values in milliseconds
 */
export const TIMINGS = {
  // Tab operations
  TAB_CREATION_DELAY_MS: 1000,
  TAB_SWITCH_DELAY_MS: 500,
  
  // Mirroring
  MIRROR_UPDATE_DELAY_MS: 800,
  MIRROR_POLL_INTERVAL_MS: 500,
  
  // Connection
  CONNECTION_WAIT_MS: 200,
  CONNECTION_RETRY_MS: 1000,
  HEARTBEAT_INTERVAL_MS: 30000,
  
  // Puppeteer
  ATTACH_BACKOFF_MS: 30_000,
  ATTACH_RETRY_DELAY_MS: 5000,
  SCREENSHOT_TIMEOUT_MS: 5000,
  
  // Actions
  ACTION_DELAY_MS: 1000,
  PAGE_LOAD_WAIT_MS: 2000,
  
  // Estimation
  ESTIMATION_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
} as const;

