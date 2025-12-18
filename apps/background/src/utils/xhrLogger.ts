import { calculateCost } from '../utils/cost-calculator';

export function setupXHRLogging(logger: any) {
  try {
    const OriginalXHR = (globalThis as any).XMLHttpRequest;
    if (OriginalXHR && !((globalThis as any).__nanoXHRWrapped)) {
      (globalThis as any).__nanoXHRWrapped = true;
      class WrappedXHR extends OriginalXHR {
        private __url: string = '';
        private __method: string = 'GET';
        open(method: string, url: string, async?: boolean, user?: string, password?: string) {
          this.__method = (method || 'GET').toUpperCase();
          this.__url = url || '';
          return super.open(method, url, async as any, user as any, password as any);
        }
        send(body?: Document | BodyInit | null) {
          try {
            const isPost = this.__method === 'POST';
            const looksJson = typeof body === 'string' && (body as string).trim().startsWith('{');
            if (isPost && looksJson) {
              let requestModelName = 'unknown';
              try {
                const json = JSON.parse(body as string);
                if (json.model) requestModelName = json.model;
              } catch {}
              const onLoad = () => {
                try {
                  const text = (this as any).responseText || '';
                  if (text) {
                    try {
                      const resp = JSON.parse(text);
                      const usage = resp?.usageMetadata || resp?.usage || null;
                      if (usage) {
                        let inputTokens = Number(usage.promptTokenCount || usage.prompt_tokens || usage.input_tokens || 0) || 0;
                        let outputTokens = Number(usage.candidatesTokenCount || usage.completion_tokens || usage.output_tokens || 0) || 0;
                        let thoughtTokens = Number(usage.thoughtsTokenCount || usage.thinking_tokens || usage.reasoning_tokens || usage.thought_tokens || 0) || 0;
                        const modelName = requestModelName;
                        const cost = calculateCost(modelName, inputTokens, outputTokens + thoughtTokens);
                      }
                    } catch {}
                  }
                } catch {}
                try { this.removeEventListener('load', onLoad as any); } catch {}
              };
              this.addEventListener('load', onLoad as any);
            }
          } catch {}
          return super.send(body as any);
        }
      }
      ;(globalThis as any).XMLHttpRequest = WrappedXHR;
      logger.info('XHR logging initialized');
    }
  } catch {}
}


