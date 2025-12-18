/// <reference types="vite/client" />

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warning: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
  // Enhanced logging for user actions
  userAction: (action: string, details?: Record<string, unknown>) => void;
}

const createLogger = (namespace: string): Logger => {
  const prefix = `[${namespace}]`;

  // Bind console methods directly to preserve call stack and show correct line numbers
  const boundDebug = console.debug.bind(console, prefix);
  const boundInfo = console.info.bind(console, prefix);
  const boundWarn = console.warn.bind(console, prefix);
  const boundError = console.error.bind(console, prefix);
  const boundGroup = console.group.bind(console);
  const boundGroupEnd = console.groupEnd.bind(console);

  // User action logging - always visible for audit trail
  const userAction = (action: string, details?: Record<string, unknown>) => {
    const detailStr = details ? ` ${formatDetails(details)}` : '';
    console.info(`[UserAction] ${action}${detailStr}`);
  };

  return {
    debug: import.meta.env.DEV ? boundDebug : () => {},
    info: (import.meta.env.DEV || import.meta.env.VERBOSE_LOGS) ? boundInfo : () => {},
    warning: boundWarn,
    error: boundError,
    group: (label: string) => boundGroup(`${prefix} ${label}`),
    groupEnd: boundGroupEnd,
    userAction,
  };
};

// Helper to format details object compactly
function formatDetails(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

// Utility function to format model counts compactly
export function formatModelCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([_, count]) => count > 0)
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(', ');
}

// Create default logger
const logger = createLogger('Agent');

export type { Logger, LogLevel };
export { createLogger, logger };
