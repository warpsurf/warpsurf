import { getAllProvidersDecrypted } from '../../crypto';

export async function handleTestProviderMessage(message: any, sendResponse: (resp: any) => void) {
  const start = Date.now();
  try {
    const providerId: string | undefined = message?.providerId;
    const overrideConfig: any | undefined = message?.config;
    if (!providerId && !overrideConfig) {
      return sendResponse({ ok: false, error: 'Missing providerId or config' });
    }

    // Load config from storage unless an override is provided
    let cfg = overrideConfig;
    if (!cfg && providerId) {
      const all = await getAllProvidersDecrypted();
      cfg = (all as any)[providerId];
    }
    if (!cfg) {
      return sendResponse({ ok: false, error: 'Provider not configured' });
    }

    // Determine a test URL and headers based on provider type
    const type = String(cfg.type || '').toLowerCase();
    const baseUrl = (cfg.baseUrl || '').replace(/\/$/, '');
    let testUrl = '';
    const headers: Record<string, string> = {};

    const withBearer = () => {
      if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    };

    if (type === 'gemini') {
      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models';
      testUrl = cfg.apiKey ? `${endpoint}?key=${encodeURIComponent(cfg.apiKey)}` : endpoint;
    } else if (type === 'custom_openai') {
      // Custom OpenAI-compatible provider - requires baseUrl
      if (!baseUrl) {
        return sendResponse({ ok: false, error: 'Base URL is required for custom OpenAI-compatible providers' });
      }
      testUrl = `${baseUrl}/models`;
      withBearer();
    } else {
      const defaults: Record<string, string> = {
        openai: 'https://api.openai.com/v1',
        openrouter: 'https://openrouter.ai/api/v1',
        grok: 'https://api.x.ai/v1',
        anthropic: 'https://api.anthropic.com/v1',
      };
      const b = baseUrl || defaults[type] || 'https://api.openai.com/v1';
      testUrl = `${b.replace(/\/$/, '')}/models`;
      withBearer();
      if (type === 'openrouter') {
        headers['HTTP-Referer'] = 'https://warpsurf.ai';
        headers['X-Title'] = 'warpsurf';
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(testUrl, { method: 'GET', headers, signal: controller.signal } as RequestInit);
    clearTimeout(timeout);
    const dt = Date.now() - start;
    if (resp && typeof resp.status === 'number' && resp.status >= 200 && resp.status < 500) {
      return sendResponse({ ok: true, latencyMs: dt, status: resp.status });
    }
    return sendResponse({ ok: false, latencyMs: dt, status: resp?.status ?? 0 });
  } catch (e: any) {
    const dt = Date.now() - start;
    return sendResponse({ ok: false, latencyMs: dt, error: String(e?.message || e) });
  }
}

