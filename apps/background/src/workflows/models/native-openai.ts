/**
 * Native OpenAI model implementation using openai SDK
 */

import OpenAI from 'openai';
import type { BaseMessage } from '@langchain/core/messages';

export interface NativeOpenAIArgs {
  model: string;
  apiKey: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  webSearch?: boolean;
  maxRetries?: number;
}

export class NativeOpenAIChatModel {
  public readonly modelName: string;
  private readonly client: OpenAI;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly webSearchEnabled: boolean;
  private readonly maxRetries?: number;

  constructor(args: NativeOpenAIArgs) {
    this.modelName = args.model;
    this.client = new OpenAI({
      apiKey: args.apiKey,
      baseURL: args.baseUrl,
      defaultHeaders: args.defaultHeaders,
    } as any);
    this.temperature = args.temperature;
    this.maxTokens = args.maxTokens;
    this.webSearchEnabled = !!args.webSearch;
    this.maxRetries = args.maxRetries;
  }

  withStructuredOutput(schema: any, opts?: { includeRaw?: boolean; name?: string }) {
    return {
      invoke: async (messages: BaseMessage[], options?: Record<string, unknown>) => {
        // Extract AbortSignal from options if provided. Do not pass "signal" inside JSON body.
        const { signal, ...rest } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;

        // Build structured output configuration
        const schemaName = (schema as any)?.title || opts?.name || 'ModelOutput';
        // For Chat Completions, response_format is supported for many models; for Responses API,
        // structured output should be attached under response_format or text.format depending on model.
        const chatResponseFormat = schema
          ? ({ type: 'json_schema', json_schema: { name: schemaName, schema } } as any)
          : ({ type: 'text' } as any);

        if (this.shouldUseResponsesAPI()) {
          const { system, chatMessages } = this.splitSystem(messages);
          // Use Responses API for o*/gpt-5*/search-preview models. Omit temperature.
          const input = this.toResponsesInput(chatMessages);
          const body: any = {
            model: this.modelName,
            input,
            // Newer models expect max_output_tokens/max_completion_tokens; prefer max_output_tokens
            max_output_tokens: this.maxTokens,
          };
          // For search-preview models, avoid structured-output to prevent 400 errors.
          const allowStructured = !!schema && !this.isSearchPreviewModel();
          if (allowStructured) {
            // Use response_format for structured output on Responses API
            body.response_format = {
              type: 'json_schema',
              json_schema: { name: schemaName, schema, strict: true },
            } as any;
          }
          if (this.webSearchEnabled || this.isSearchPreviewModel()) {
            body.tools = [{ type: 'web_search' }];
          }
          if (system) {
            body.instructions = system;
          }

          // Models don't have access to context - removed incorrect wrapper

          const retries = Math.max(0, this.maxRetries ?? 5);
          let resp: any = null;
          let lastError: any = null;
          for (let retryNum = 0; retryNum <= retries; retryNum++) {
            try {
              // Primary attempt
              resp = await (this.client as any).responses.create(body, { signal });
            } catch (_err1: any) {
              const msg = String(_err1?.message || _err1);
              if (signal?.aborted || msg.includes('AbortError') || msg.includes('aborted')) {
                throw _err1;
              }
              if (allowStructured) {
                try {
                  // Fallback: attach under text as format (older SDKs)
                  delete body.response_format;
                  body.text = {
                    format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } },
                  } as any;
                  resp = await (this.client as any).responses.create(body, { signal });
                } catch (_err2: any) {
                  try {
                    // Last resort: drop structured output entirely to avoid format errors
                    delete body.text;
                    delete body.response_format;
                    resp = await (this.client as any).responses.create(body, { signal });
                  } catch (_err3: any) {
                    lastError = _err3;
                  }
                }
              } else {
                lastError = _err1;
              }
            }
            if (resp) {
              // Validate text content
              const txt = this.extractResponsesText(resp);
              if (!txt || txt.trim().length === 0) {
                lastError = new Error('Empty response text from OpenAI Responses API');
              } else {
                lastError = null;
                break;
              }
            }
            if (retryNum < retries) {
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          }
          if (!resp) {
            throw lastError || new Error('OpenAI Responses API failed');
          }
          const text = this.extractResponsesText(resp);
          // Get usage for Responses API
          const usage =
            (resp as any)?.usage || (resp as any)?.response?.usage || (resp as any)?.response?.usage_metadata;
          let parsed: any = undefined;
          // Try strict parse, then loose extraction for JSON embedded in text
          try {
            parsed = JSON.parse(text);
          } catch {
            const extracted = this.extractJsonObject(text);
            parsed = extracted ?? { response: text };
          }
          // Normalize expected fields
          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.response !== 'string') parsed.response = text;
            if (typeof parsed.done !== 'boolean') parsed.done = true;
            if (!('search_queries' in parsed)) parsed.search_queries = [];
          }
          return { parsed, raw: { content: text }, response_metadata: { usage } };
        }

        // Default: use Chat Completions API
        const payload = this.toOpenAIMessages(messages);
        const chatBody: any = {
          model: this.modelName,
          messages: payload,
          max_tokens: this.maxTokens,
          // Search-preview models via Chat Completions do not support response_format
          ...(this.isSearchPreviewModel() ? {} : { response_format: chatResponseFormat }),
          ...(rest as object),
        };
        // Only include sampling params for models that accept them; add web search options for preview
        if (this.isSearchPreviewModel()) {
          chatBody.web_search_options = {};
        } else if (this.temperature !== undefined) {
          // Only include temperature if explicitly set; omit to use provider default
          chatBody.temperature = this.temperature;
        }

        // Models don't have access to context - removed incorrect wrapper

        const retries = Math.max(0, this.maxRetries ?? 5);
        let resp: any = null;
        let text: string = '';
        let lastError: any = null;
        for (let retryNum = 0; retryNum <= retries; retryNum++) {
          try {
            resp = await this.client.chat.completions.create(chatBody as any, { signal });
            text = resp.choices?.[0]?.message?.content || '';
            if (!text || text.trim().length === 0) {
              throw new Error('Empty response text from OpenAI Chat Completions');
            }
            break;
          } catch (error: any) {
            const msg = String(error?.message || error);
            if (signal?.aborted || msg.includes('AbortError') || msg.includes('aborted')) {
              throw error;
            }
            lastError = error;
            if (retryNum === retries) {
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
        if (!text || text.trim().length === 0) {
          throw lastError || new Error('Failed to obtain response text from OpenAI Chat Completions');
        }
        let parsed: any = undefined;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { response: text };
        }
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.response !== 'string') parsed.response = text;
          if (typeof parsed.done !== 'boolean') parsed.done = true;
          if (!('search_queries' in parsed)) parsed.search_queries = [];
        }
        // Include usage data for token tracking
        return { parsed, raw: { content: text }, response_metadata: { usage: resp?.usage } };
      },
    };
  }

  async invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<{ content: string }> {
    const { signal, ...rest } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;
    if (this.shouldUseResponsesAPI()) {
      const { system, chatMessages } = this.splitSystem(messages);
      const input = this.toResponsesInput(chatMessages);
      const body: any = {
        model: this.modelName,
        input,
        max_output_tokens: this.maxTokens,
      };
      if (this.webSearchEnabled || this.isSearchPreviewModel()) {
        body.tools = [{ type: 'web_search' }];
      }
      if (system) {
        body.instructions = system;
      }

      // Models don't have access to context - removed incorrect wrapper

      const resp: any = await (this.client as any).responses.create(body, { signal });
      const text = this.extractResponsesText(resp);
      return { content: text };
    }

    const payload = this.toOpenAIMessages(messages);
    const chatBody: any = {
      model: this.modelName,
      messages: payload,
      max_tokens: this.maxTokens,
      ...(rest as object),
    };
    // For search-preview via Chat Completions: add web_search_options and omit sampling params
    if (this.isSearchPreviewModel()) {
      chatBody.web_search_options = {};
    } else if (this.temperature !== undefined) {
      // Only include temperature if explicitly set; omit to use provider default
      chatBody.temperature = this.temperature;
    }

    // Models don't have access to context - removed incorrect wrapper

    const resp = await this.client.chat.completions.create(chatBody as any, { signal });
    const text = resp.choices?.[0]?.message?.content || '';
    return { content: text };
  }

  private toOpenAIMessages(messages: BaseMessage[]) {
    const toChatContent = (content: any): any => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        // Map to OpenAI Chat Completions content parts
        return content
          .map(item => {
            if (item && typeof item === 'object') {
              if ('image_url' in item) {
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

  private toResponsesInput(messages: BaseMessage[]) {
    // Responses API expects array of content parts with specific typed keys like input_text, input_image, etc.
    const transformContent = (content: any): any[] => {
      if (typeof content === 'string') {
        return [{ type: 'input_text', text: content }];
      }
      if (Array.isArray(content)) {
        const parts: any[] = [];
        for (const item of content) {
          if (item && typeof item === 'object') {
            if ('image_url' in item && item.image_url && typeof item.image_url.url === 'string') {
              parts.push({
                type: 'input_image',
                image_url: item.image_url.url,
              });
            } else if (item.type === 'text' && typeof item.text === 'string') {
              parts.push({ type: 'input_text', text: item.text });
            }
          }
        }
        return parts.length > 0 ? parts : [{ type: 'input_text', text: '' }];
      }
      return [{ type: 'input_text', text: String(content ?? '') }];
    };

    const input: any[] = [];
    for (const m of messages) {
      const explicitRole = m && typeof (m as any).role === 'string' ? (m as any).role : '';
      const roleName = (m as any).constructor?.name;
      const contentParts = transformContent((m as any).content);
      const mapped =
        explicitRole ||
        (roleName === 'SystemMessage'
          ? 'system'
          : roleName === 'HumanMessage'
            ? 'user'
            : roleName === 'AIMessage'
              ? 'assistant'
              : 'user');
      input.push({ role: mapped, content: contentParts });
    }
    return input;
  }

  private splitSystem(messages: BaseMessage[]): { system: string | null; chatMessages: BaseMessage[] } {
    let system: string | null = null;
    const rest: BaseMessage[] = [];
    const flattenToText = (c: any): string => {
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) {
        try {
          const texts = c
            .map((p: any) => (p && typeof p === 'object' && typeof p.text === 'string' ? p.text : ''))
            .filter(Boolean);
          return texts.join('\n');
        } catch {
          return JSON.stringify(c);
        }
      }
      try {
        return JSON.stringify(c);
      } catch {
        return String(c ?? '');
      }
    };
    for (const m of messages) {
      const hasRole = m && typeof (m as any).role === 'string';
      const roleName = (m as any).constructor?.name;
      const isSystem = (hasRole && (m as any).role === 'system') || roleName === 'SystemMessage';
      if (isSystem) {
        const text = flattenToText((m as any).content);
        system = system ? `${system}\n${text}` : text;
      } else {
        rest.push(m);
      }
    }
    return { system, chatMessages: rest };
  }

  private isSearchPreviewModel(): boolean {
    const name = this.modelName ?? '';
    return name.includes('search-preview');
  }

  private shouldUseResponsesAPI(): boolean {
    const name = this.modelName ?? '';
    // Route only o*/gpt-5* to Responses API; search-preview must use Chat Completions per docs
    return /^o\d|^o-|^gpt-5/.test(name);
  }

  private extractResponsesText(resp: any): string {
    // Prefer output_text if present
    if (resp && typeof resp.output_text === 'string') {
      return resp.output_text;
    }
    // Try candidates-based content
    const out = resp?.output || resp?.response || resp?.data;
    if (Array.isArray(out)) {
      // Flatten any text fields
      for (const item of out) {
        const content = item?.content && Array.isArray(item.content) ? item.content : undefined;
        if (content) {
          for (const c of content) {
            if (typeof c?.text === 'string') return c.text;
          }
        }
        if (typeof item?.text === 'string') return item.text;
      }
    }
    // Fallback
    return '';
  }

  private extractJsonObject(text: string): Record<string, unknown> | null {
    try {
      const fence = text.match(/```json[\s\S]*?```/i) || text.match(/```[\s\S]*?```/);
      let candidate = fence ? fence[0] : text;
      candidate = candidate
        .replace(/```json/i, '')
        .replace(/```/g, '')
        .trim();
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
    const payload = this.toOpenAIMessages(messages);

    // Build request body - only include temperature for models that support it
    const body: any = {
      model: this.modelName,
      messages: payload,
      max_completion_tokens: this.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };

    // Reasoning models (o1, o3, gpt-5) and search-preview models don't support temperature
    if (!this.shouldUseResponsesAPI() && !this.isSearchPreviewModel()) {
      body.temperature = this.temperature;
    }

    const stream = (await this.client.chat.completions.create(body as any, { signal })) as any;

    let usage: any = null;
    for await (const chunk of stream as AsyncIterable<any>) {
      // Capture usage from final chunk
      if (chunk.usage) usage = chunk.usage;
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { text, done: false };
    }
    yield { text: '', done: true, usage };
  }
}
