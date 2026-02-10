/**
 * Native OpenRouter model implementation using OpenAI SDK
 * OpenRouter API is OpenAI-compatible with base URL https://openrouter.ai/api/v1
 * Requires HTTP-Referer and X-Title headers for proper attribution
 * See: https://openrouter.ai/docs/quickstart
 */

import OpenAI from 'openai';
import type { BaseMessage } from '@langchain/core/messages';
import type { ThinkingLevel } from '@extension/storage';

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_REFERER = 'https://warpsurf.ai';
const DEFAULT_TITLE = 'warpsurf';

export interface NativeOpenRouterArgs {
  model: string;
  apiKey: string;
  baseUrl?: string;
  httpReferer?: string;
  xTitle?: string;
  temperature?: number;
  maxTokens?: number;
  webSearch?: boolean;
  maxRetries?: number;
  thinkingLevel?: ThinkingLevel;
}

export class NativeOpenRouterChatModel {
  public readonly modelName: string;
  private readonly client: OpenAI;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly webSearchEnabled: boolean;
  private readonly maxRetries?: number;
  private readonly thinkingLevel?: ThinkingLevel;

  constructor(args: NativeOpenRouterArgs) {
    this.modelName = args.model;
    this.client = new OpenAI({
      apiKey: args.apiKey,
      baseURL: args.baseUrl || DEFAULT_OPENROUTER_BASE_URL,
      defaultHeaders: {
        'HTTP-Referer': args.httpReferer || DEFAULT_REFERER,
        'X-Title': args.xTitle || DEFAULT_TITLE,
      },
    } as any);
    this.temperature = args.temperature;
    this.maxTokens = args.maxTokens;
    this.webSearchEnabled = !!args.webSearch;
    this.maxRetries = args.maxRetries;
    this.thinkingLevel = args.thinkingLevel;
  }

  /**
   * Build provider-specific thinking params based on the model prefix.
   * OpenRouter passes these through to the underlying provider.
   */
  private getThinkingConfig(): Record<string, unknown> {
    if (!this.thinkingLevel || this.thinkingLevel === 'default') return {};
    const prefix = this.modelName.split('/')[0];
    const model = this.modelName.split('/').slice(1).join('/');

    if (prefix === 'openai' && /^(o1|o3|o4|gpt-5)/.test(model)) {
      const effort = this.thinkingLevel === 'off' ? 'low' : this.thinkingLevel;
      return { reasoning: { effort } };
    }
    if (prefix === 'google' && /^gemini-(2\.5|3-)/.test(model)) {
      const budgetMap: Record<string, number> = { off: 0, low: 2048, medium: 8192, high: 24576 };
      return { reasoning: { thinking_budget: budgetMap[this.thinkingLevel] ?? -1 } };
    }
    // For anthropic and other providers on OpenRouter, the thinking param
    // is typically handled via provider-specific headers or not supported.
    return {};
  }

  withStructuredOutput(schema: any, opts?: { includeRaw?: boolean; name?: string }) {
    return {
      invoke: async (messages: BaseMessage[], options?: Record<string, unknown>) => {
        const { signal, ...rest } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;

        const schemaName = (schema as any)?.title || opts?.name || 'ModelOutput';
        const responseFormat = schema
          ? ({ type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } } as any)
          : ({ type: 'text' } as any);

        const payload = this.toOpenAIMessages(messages);
        const chatBody: any = {
          model: this.modelName,
          messages: payload,
          max_tokens: this.maxTokens,
          ...(this.temperature !== undefined && { temperature: this.temperature }),
          ...this.getThinkingConfig(),
          response_format: responseFormat,
          ...(rest as object),
        };

        const retries = Math.max(0, this.maxRetries ?? 5);
        let resp: any = null;
        let text: string = '';
        let lastError: any = null;

        for (let retryNum = 0; retryNum <= retries; retryNum++) {
          try {
            resp = await this.client.chat.completions.create(chatBody as any, { signal });
            text = resp.choices?.[0]?.message?.content || '';
            if (!text || text.trim().length === 0) {
              throw new Error('Empty response text from OpenRouter');
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
          throw lastError || new Error('Failed to obtain response text from OpenRouter');
        }

        // SDK-level token logging disabled - handled by llm-fetch-logger.ts

        let parsed: any = undefined;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Try to extract JSON from text
          const extracted = this.extractJsonObject(text);
          parsed = extracted ?? { response: text };
        }

        // Normalize expected fields
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.response !== 'string') parsed.response = text;
          if (typeof parsed.done !== 'boolean') parsed.done = true;
          if (!('search_queries' in parsed)) parsed.search_queries = [];
        }

        return { parsed, raw: { content: text }, response_metadata: { usage: resp?.usage } };
      },
    };
  }

  async invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<{ content: string }> {
    const { signal, ...rest } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;

    const payload = this.toOpenAIMessages(messages);
    const chatBody: any = {
      model: this.modelName,
      messages: payload,
      max_tokens: this.maxTokens,
      ...(this.temperature !== undefined && { temperature: this.temperature }),
      ...this.getThinkingConfig(),
      ...(rest as object),
    };

    const retries = Math.max(0, this.maxRetries ?? 5);
    let text: string = '';
    let lastError: any = null;

    for (let retryNum = 0; retryNum <= retries; retryNum++) {
      try {
        const resp = await this.client.chat.completions.create(chatBody as any, { signal });
        text = resp.choices?.[0]?.message?.content || '';
        if (!text || text.trim().length === 0) {
          throw new Error('Empty response text from OpenRouter');
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
      throw lastError || new Error('Failed to obtain response text from OpenRouter');
    }

    // SDK-level token logging disabled - handled by llm-fetch-logger.ts

    return { content: text };
  }

  private toOpenAIMessages(messages: BaseMessage[]) {
    const toChatContent = (content: any): any => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
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
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { text, done: false };
    }
    yield { text: '', done: true, usage };
  }
}
