// LLM Request Interceptor for Testing
// Captures outgoing LLM requests and allows mocking responses
// Only active when __TEST__=true

export interface LLMRequest {
  id: string;
  timestamp: number;
  url: string;
  provider: string;
  model?: string;
  messages?: Array<{ role: string; content: unknown }>;
  contents?: unknown[]; // Gemini format
  rawBody: unknown;
}

export interface MockResponse {
  pattern: RegExp | string; // URL pattern to match
  response: {
    content: string;
    model?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
}

const capturedRequests: LLMRequest[] = [];
const mockResponses: MockResponse[] = [];
let interceptEnabled = false;
let originalFetch: typeof fetch | null = null;

// Auto-setup in test mode at module load time
// This ensures the interceptor is set up before any LLM calls
if (import.meta.env.TEST && typeof globalThis !== 'undefined') {
  // Mark that we want to intercept
  (globalThis as any).__llmInterceptorPending = true;
}

function detectProvider(url: string): string {
  if (url.includes('openai.com')) return 'openai';
  if (url.includes('anthropic.com')) return 'anthropic';
  if (url.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('api.x.ai')) return 'grok';
  return 'custom';
}

function isLLMRequest(url: string, init?: RequestInit): boolean {
  if (init?.method !== 'POST') return false;
  const contentType = (init.headers as Record<string, string>)?.['Content-Type'] || '';
  if (!contentType.includes('application/json')) return false;

  // Check for LLM API patterns
  const llmPatterns = [
    /openai\.com\/v1\/(chat\/completions|responses)/,
    /anthropic\.com\/v1\/messages/,
    /generativelanguage\.googleapis\.com/,
    /openrouter\.ai\/api\/v1/,
    /api\.x\.ai\/v1/,
  ];
  return llmPatterns.some(p => p.test(url));
}

function createMockOpenAIResponse(mock: MockResponse['response']): Response {
  const body = JSON.stringify({
    id: `chatcmpl-test-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: mock.model || 'gpt-4o-test',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: mock.content },
        finish_reason: 'stop',
      },
    ],
    usage: mock.usage || { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMockAnthropicResponse(mock: MockResponse['response']): Response {
  const body = JSON.stringify({
    id: `msg-test-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: mock.content }],
    model: mock.model || 'claude-3-5-sonnet-test',
    stop_reason: 'end_turn',
    usage: { input_tokens: mock.usage?.prompt_tokens || 100, output_tokens: mock.usage?.completion_tokens || 50 },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMockGeminiResponse(mock: MockResponse['response']): Response {
  const body = JSON.stringify({
    candidates: [
      {
        content: { parts: [{ text: mock.content }], role: 'model' },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: mock.usage?.prompt_tokens || 100,
      candidatesTokenCount: mock.usage?.completion_tokens || 50,
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMockResponse(url: string, mock: MockResponse['response']): Response {
  const provider = detectProvider(url);
  switch (provider) {
    case 'anthropic':
      return createMockAnthropicResponse(mock);
    case 'gemini':
      return createMockGeminiResponse(mock);
    default:
      return createMockOpenAIResponse(mock);
  }
}

export function setupLLMInterceptor(): void {
  // Use direct comparison so bundler can evaluate at build time
  if (process.env.__TEST__ !== 'true' || originalFetch) return;

  originalFetch = globalThis.fetch;
  interceptEnabled = true;

  globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (isLLMRequest(url, init)) {
      let body: unknown = null;
      try {
        body = init?.body ? JSON.parse(init.body as string) : null;
      } catch {}

      const request: LLMRequest = {
        id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        url,
        provider: detectProvider(url),
        model: (body as any)?.model,
        messages: (body as any)?.messages,
        contents: (body as any)?.contents,
        rawBody: body,
      };

      capturedRequests.push(request);
      if (capturedRequests.length > 100) capturedRequests.shift();

      // Check for matching mock
      for (const mock of mockResponses) {
        const matches = typeof mock.pattern === 'string' ? url.includes(mock.pattern) : mock.pattern.test(url);
        if (matches) {
          return createMockResponse(url, mock.response);
        }
      }

      // If no mock and we're in strict test mode, return a default mock
      if ((globalThis as any).__testStrictMock) {
        return createMockResponse(url, { content: '[MOCKED] No specific mock configured' });
      }
    }

    return originalFetch!.call(globalThis, input, init);
  };

  // Expose on globalThis for test access
  (globalThis as any).__llmInterceptor = {
    getRequests: () => [...capturedRequests],
    clearRequests: () => {
      capturedRequests.length = 0;
    },
    addMock: (mock: MockResponse) => {
      mockResponses.push(mock);
    },
    clearMocks: () => {
      mockResponses.length = 0;
    },
    setStrictMock: (strict: boolean) => {
      (globalThis as any).__testStrictMock = strict;
    },
    getLastRequest: () => capturedRequests[capturedRequests.length - 1] || null,
    findRequestsWithContext: (contextPattern: string | RegExp) => {
      return capturedRequests.filter(req => {
        const messagesStr = JSON.stringify(req.messages || req.contents || []);
        return typeof contextPattern === 'string'
          ? messagesStr.includes(contextPattern)
          : contextPattern.test(messagesStr);
      });
    },
  };
}

export function teardownLLMInterceptor(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  interceptEnabled = false;
  capturedRequests.length = 0;
  mockResponses.length = 0;
  delete (globalThis as any).__llmInterceptor;
  delete (globalThis as any).__testStrictMock;
}
