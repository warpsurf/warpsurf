/**
 * Native OpenAI-compatible model implementation for custom/third-party providers
 * Designed for generic OpenAI-compatible APIs like:
 * - LM Studio, Ollama, vLLM, LocalAI
 * - Together AI, Groq, Fireworks, Anyscale
 * - Any other provider implementing the OpenAI Chat Completions API
 *
 * Unlike the main OpenAI implementation, this uses only standard Chat Completions
 * and avoids OpenAI-specific features (Responses API, web_search_options, etc.)
 */

import OpenAI from 'openai';
import type { BaseMessage } from '@langchain/core/messages';

export interface NativeCustomOpenAIArgs {
  model: string;
  apiKey?: string; // Optional for local models (Ollama, LM Studio, etc.)
  baseUrl: string; // Required for custom providers
  defaultHeaders?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  // Whether to attempt JSON mode when structured output is requested
  // Some providers don't support json_schema but do support { type: 'json_object' }
  useJsonMode?: boolean;
}

export class NativeCustomOpenAIChatModel {
  public readonly modelName: string;
  private readonly client: OpenAI;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly maxRetries: number;
  private readonly useJsonMode: boolean;

  constructor(args: NativeCustomOpenAIArgs) {
    this.modelName = args.model;
    this.client = new OpenAI({
      apiKey: args.apiKey || 'not-needed', // Some providers require a placeholder
      baseURL: args.baseUrl,
      defaultHeaders: args.defaultHeaders,
      dangerouslyAllowBrowser: true, // Required for browser extension context
    } as any);
    this.temperature = args.temperature;
    this.maxTokens = args.maxTokens;
    this.maxRetries = args.maxRetries ?? 3;
    this.useJsonMode = args.useJsonMode ?? true;
  }

  withStructuredOutput(schema: any, opts?: { includeRaw?: boolean; name?: string }) {
    return {
      invoke: async (messages: BaseMessage[], options?: Record<string, unknown>) => {
        const { signal, ...rest } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;

        const schemaName = (schema as any)?.title || opts?.name || 'ModelOutput';
        const payload = this.toOpenAIMessages(messages);

        // Build request body - try json_schema first, fall back to json_object, then text
        const chatBody: any = {
          model: this.modelName,
          messages: payload,
          // Only include temperature if explicitly set; omit to use provider default
          ...(this.temperature !== undefined && { temperature: this.temperature }),
          ...(rest as object),
        };

        // Set max_tokens with provider-agnostic field name
        if (this.maxTokens) {
          chatBody.max_tokens = this.maxTokens;
        }

        let text: string = '';
        let usage: any = undefined;
        let lastError: any = null;

        // Strategy 1: Try json_schema (OpenAI standard, supported by some providers)
        if (this.useJsonMode && schema) {
          try {
            chatBody.response_format = {
              type: 'json_schema',
              json_schema: { name: schemaName, schema, strict: true },
            };
            const result = await this.attemptRequest(chatBody, signal);
            if (result.text) {
              text = result.text;
              usage = result.usage;
            }
          } catch (err: any) {
            lastError = err;
            // Continue to fallback strategies
          }
        }

        // Strategy 2: Try json_object mode (wider support)
        if (!text && this.useJsonMode) {
          try {
            chatBody.response_format = { type: 'json_object' };
            // Add instruction to return JSON in the system/user message if not already present
            const hasJsonInstruction = payload.some(
              (m: any) =>
                typeof m.content === 'string' &&
                (m.content.toLowerCase().includes('json') || m.content.toLowerCase().includes('respond with')),
            );
            if (!hasJsonInstruction && payload.length > 0) {
              // Prepend JSON instruction to the first user message or add system message
              const systemMsg = payload.find((m: any) => m.role === 'system');
              if (systemMsg && typeof systemMsg.content === 'string') {
                systemMsg.content = systemMsg.content + '\n\nRespond with valid JSON only.';
              } else {
                payload.unshift({ role: 'system', content: 'Respond with valid JSON only.' });
              }
            }
            const result = await this.attemptRequest(chatBody, signal);
            if (result.text) {
              text = result.text;
              usage = result.usage;
            }
          } catch (err: any) {
            lastError = err;
          }
        }

        // Strategy 3: Plain text mode (universal fallback)
        if (!text) {
          try {
            delete chatBody.response_format;
            const result = await this.attemptRequest(chatBody, signal);
            text = result.text || '';
            usage = result.usage;
            lastError = result.error;
          } catch (err: any) {
            lastError = err;
          }
        }

        if (!text || text.trim().length === 0) {
          throw lastError || new Error('Failed to obtain response from OpenAI-compatible API');
        }

        // Parse response
        let parsed: any = undefined;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Try to extract JSON from text (may be wrapped in markdown)
          const extracted = this.extractJsonObject(text);
          parsed = extracted ?? { response: text };
        }

        // Normalize expected fields for compatibility
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.response !== 'string') parsed.response = text;
          if (typeof parsed.done !== 'boolean') parsed.done = true;
          if (!('search_queries' in parsed)) parsed.search_queries = [];
        }

        return { parsed, raw: { content: text }, response_metadata: { usage } };
      },
    };
  }

  async invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<{ content: string }> {
    const { signal, ...rest } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;

    const payload = this.toOpenAIMessages(messages);
    const chatBody: any = {
      model: this.modelName,
      messages: payload,
      // Only include temperature if explicitly set; omit to use provider default
      ...(this.temperature !== undefined && { temperature: this.temperature }),
      ...(rest as object),
    };

    if (this.maxTokens) {
      chatBody.max_tokens = this.maxTokens;
    }

    const result = await this.attemptRequest(chatBody, signal);

    if (!result.text || result.text.trim().length === 0) {
      throw result.error || new Error('Empty response from OpenAI-compatible API');
    }

    return { content: result.text };
  }

  private async attemptRequest(
    chatBody: any,
    signal?: AbortSignal,
  ): Promise<{ text: string; usage?: any; error?: any }> {
    let text: string = '';
    let lastError: any = null;

    for (let retryNum = 0; retryNum <= this.maxRetries; retryNum++) {
      try {
        const resp = await this.client.chat.completions.create(chatBody, { signal });
        text = resp.choices?.[0]?.message?.content || '';
        if (!text || text.trim().length === 0) {
          throw new Error('Empty response text from API');
        }
        return { text, usage: resp?.usage };
      } catch (error: any) {
        const msg = String(error?.message || error);

        // Respect abort signals immediately
        if (signal?.aborted || msg.includes('AbortError') || msg.includes('aborted')) {
          throw error;
        }

        // Don't retry on format-related errors - let caller try different format
        if (
          msg.includes('response_format') ||
          msg.includes('json_schema') ||
          msg.includes('json_object') ||
          msg.includes('not supported') ||
          msg.includes('400')
        ) {
          throw error;
        }

        lastError = error;
        if (retryNum < this.maxRetries) {
          // Exponential backoff with jitter
          const delay = Math.min(1000 * Math.pow(2, retryNum) + Math.random() * 1000, 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return { text: '', error: lastError };
  }

  private toOpenAIMessages(messages: BaseMessage[]) {
    const toChatContent = (content: any): any => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map(item => {
            if (item && typeof item === 'object') {
              if ('image_url' in item) {
                // Handle vision models - pass through image URLs
                return { type: 'image_url', image_url: item.image_url.url ?? item.image_url };
              }
              if (item.type === 'text' && typeof item.text === 'string') {
                return { type: 'text', text: item.text };
              }
            }
            return null;
          })
          .filter(Boolean);
      }
      return String(content ?? '');
    };

    const detectRole = (m: any): 'system' | 'user' | 'assistant' | 'tool' => {
      try {
        const explicitRole = m && typeof m === 'object' && typeof m.role === 'string' ? (m.role as string) : '';
        if (
          explicitRole === 'system' ||
          explicitRole === 'user' ||
          explicitRole === 'assistant' ||
          explicitRole === 'tool'
        ) {
          return explicitRole as any;
        }
        const role = (m as any).constructor?.name;
        if (role === 'SystemMessage') return 'system';
        if (role === 'HumanMessage') return 'user';
        if (role === 'AIMessage') return 'assistant';
      } catch {}
      return 'user';
    };

    const out: any[] = [];
    for (const m of messages) {
      const mappedRole = detectRole(m);
      const content = toChatContent((m as any).content);
      out.push({ role: mappedRole, content });
    }
    return out;
  }

  private extractJsonObject(text: string): Record<string, unknown> | null {
    try {
      // Try to find JSON in markdown code blocks
      const fence = text.match(/```json[\s\S]*?```/i) || text.match(/```[\s\S]*?```/);
      let candidate = fence ? fence[0] : text;
      candidate = candidate
        .replace(/```json/i, '')
        .replace(/```/g, '')
        .trim();

      // Find the outermost JSON object
      const firstBrace = candidate.indexOf('{');
      const lastBrace = candidate.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonSlice = candidate.slice(firstBrace, lastBrace + 1);
        return JSON.parse(jsonSlice) as Record<string, unknown>;
      }
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async *invokeStreaming(
    messages: BaseMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<{ text: string; done: boolean; usage?: any }> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.modelName,
        messages: this.toOpenAIMessages(messages),
        max_tokens: this.maxTokens,
        // Only include temperature if explicitly set; omit to use provider default
        ...(this.temperature !== undefined && { temperature: this.temperature }),
        stream: true,
        stream_options: { include_usage: true },
      } as any,
      { signal },
    );

    let usage: any = null;
    for await (const chunk of stream as unknown as AsyncIterable<any>) {
      if (chunk.usage) usage = chunk.usage;
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { text, done: false };
    }
    yield { text: '', done: true, usage };
  }
}
