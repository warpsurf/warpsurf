import { globalTokenTracker } from './token-tracker';
import { createLogger } from '../log';

const logger = createLogger('llm-fetch-logger');

// Heuristic check for LLM API requests
async function isLLMApiRequest(url: string, init?: RequestInit): Promise<boolean> {
  try {
    if ((init?.method || 'GET').toUpperCase() !== 'POST') return false;
    
    let headers: Record<string, string> = {};
    if (init?.headers instanceof Headers) {
      init.headers.forEach((value, key) => { headers[key] = value; });
    } else if (init?.headers && typeof init.headers === 'object') {
      headers = init.headers as Record<string, string>;
    }
    
    const contentType = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) return false;
    
    const bodyText = typeof init?.body === 'string' ? init.body : undefined;
    if (!bodyText) return false;
    
    try {
      const json = JSON.parse(bodyText);
      return !!(json?.model || json?.messages || json?.contents);
    } catch { return false; }
  } catch { return false; }
}

export function setupLLMApiLogging(): void {
  const originalFetch = globalThis.fetch;
  
  globalThis.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const isLLMRequest = await isLLMApiRequest(url, init);
    
    if (isLLMRequest) {
      // Get taskId from AbortSignal (reliable for parallel workers) or fallback to current
      const signal = init?.signal;
      const taskId = signal 
        ? (globalTokenTracker as any)?.getTaskIdFromSignal?.(signal) || globalTokenTracker.getCurrentTaskId()
        : globalTokenTracker.getCurrentTaskId();
      logger.debug('LLM request', { taskId, url });
    }
    
    // Token tracking handled at agent/workflow level (base-agent.ts, etc.)
    return originalFetch.call(this, input, init);
  };
}
