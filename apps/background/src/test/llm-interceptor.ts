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

const LLM_URL_PATTERNS = [
  /openai\.com\/v1\/(chat\/completions|responses)/,
  /anthropic\.com\/v1\/messages/,
  /generativelanguage\.googleapis\.com/,
  /openrouter\.ai\/api\/v1/,
  /api\.x\.ai\/v1/,
];

function isLLMRequest(url: string, input: RequestInfo | URL, init?: RequestInit): boolean {
  // Extract method from either the Request object or init
  const method = init?.method ?? (input instanceof Request ? input.method : undefined);
  if (method !== 'POST') return false;
  return LLM_URL_PATTERNS.some(p => p.test(url));
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

// ── Streaming mock responses (SSE format) ──────────────────────────────

function createStreamingOpenAIResponse(mock: MockResponse['response']): Response {
  const chunks = [
    `data: ${JSON.stringify({
      id: `chatcmpl-test-${Date.now()}`,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: mock.content }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: `chatcmpl-test-${Date.now()}`,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: mock.usage || { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

function createStreamingAnthropicResponse(mock: MockResponse['response']): Response {
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: `msg-test-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [],
        model: mock.model || 'claude-3-5-sonnet-test',
        usage: { input_tokens: mock.usage?.prompt_tokens || 100, output_tokens: 0 },
      },
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: mock.content },
    })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({
      type: 'content_block_stop',
      index: 0,
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: mock.usage?.completion_tokens || 50 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const ev of events) controller.enqueue(encoder.encode(ev));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

function createStreamingGeminiResponse(mock: MockResponse['response']): Response {
  // Gemini uses streamGenerateContent which returns newline-delimited JSON
  const body = JSON.stringify([
    {
      candidates: [{ content: { parts: [{ text: mock.content }], role: 'model' }, finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: mock.usage?.prompt_tokens || 100,
        candidatesTokenCount: mock.usage?.completion_tokens || 50,
      },
    },
  ]);
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMockResponse(url: string, mock: MockResponse['response'], streaming = false): Response {
  const provider = detectProvider(url);
  if (streaming) {
    switch (provider) {
      case 'anthropic':
        return createStreamingAnthropicResponse(mock);
      case 'gemini':
        return createStreamingGeminiResponse(mock);
      default:
        return createStreamingOpenAIResponse(mock);
    }
  }
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

    if (isLLMRequest(url, input, init)) {
      let body: unknown = null;
      try {
        const rawBody = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
        body = rawBody ? JSON.parse(rawBody as string) : null;
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

      const isStreaming = !!(body as any)?.stream;

      // Check for matching mock
      for (const mock of mockResponses) {
        const matches = typeof mock.pattern === 'string' ? url.includes(mock.pattern) : mock.pattern.test(url);
        if (matches) {
          return createMockResponse(url, mock.response, isStreaming);
        }
      }

      // If no mock and we're in strict test mode, return a default mock
      if ((globalThis as any).__testStrictMock) {
        return createMockResponse(url, { content: '[MOCKED] No specific mock configured' }, isStreaming);
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
