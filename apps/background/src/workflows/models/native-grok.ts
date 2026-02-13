/**
 * Native Grok (xAI) model implementation using OpenAI SDK
 * xAI API is OpenAI-compatible with base URL https://api.x.ai/v1
 * Supports Live Search when enabled via search_parameters
 */

import OpenAI from 'openai';
import type { BaseMessage } from '@langchain/core/messages';
import type { ThinkingLevel } from '@extension/storage';
import { normalizeModelError, isNonRetryableError } from './model-error';

export interface NativeGrokArgs {
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  webSearch?: boolean;
  maxRetries?: number;
  thinkingLevel?: ThinkingLevel;
}

export class NativeGrokChatModel {
  public readonly modelName: string;
  private readonly client: OpenAI;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly webSearchEnabled: boolean;
  private readonly maxRetries?: number;
  private readonly thinkingLevel?: ThinkingLevel;

  constructor(args: NativeGrokArgs) {
    this.modelName = args.model;
    this.client = new OpenAI({
      apiKey: args.apiKey,
      baseURL: 'https://api.x.ai/v1',
    } as any);
    this.temperature = args.temperature;
    this.maxTokens = args.maxTokens;
    this.webSearchEnabled = !!args.webSearch;
    this.maxRetries = args.maxRetries;
    this.thinkingLevel = args.thinkingLevel;
  }

  /** Build reasoning_effort param. Only grok-3-mini supports it; grok-4 errors on it. */
  private getReasoningConfig(): Record<string, unknown> {
    if (!this.thinkingLevel || this.thinkingLevel === 'default') return {};
    const name = this.modelName.toLowerCase();
    // Only grok-3-mini supports reasoning_effort ('low' | 'high')
    if (!name.startsWith('grok-3-mini')) return {};
    const effort = this.thinkingLevel === 'off' || this.thinkingLevel === 'low' ? 'low' : 'high';
    return { reasoning_effort: effort };
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
          ...this.getReasoningConfig(),
          response_format: responseFormat,
          ...(rest as object),
        };

        // Add Live Search parameters if enabled
        if (this.webSearchEnabled) {
          chatBody.search_parameters = { mode: 'auto' };
        }

        const retries = Math.max(0, this.maxRetries ?? 5);
        let resp: any = null;
        let text: string = '';
        let lastError: any = null;

        for (let retryNum = 0; retryNum <= retries; retryNum++) {
          try {
            resp = await this.client.chat.completions.create(chatBody as any, { signal });
            text = resp.choices?.[0]?.message?.content || '';
            if (!text || text.trim().length === 0) {
              throw new Error('Empty response text from Grok');
            }
            break;
          } catch (error: any) {
            const msg = String(error?.message || error);
            if (signal?.aborted || msg.includes('AbortError') || msg.includes('aborted')) {
              throw error;
            }
            lastError = normalizeModelError(error, 'Grok', this.modelName);
            // Don't retry auth errors - fail immediately
            if (isNonRetryableError(lastError)) throw lastError;
            if (retryNum === retries) {
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }

        if (!text || text.trim().length === 0) {
          throw lastError || normalizeModelError(new Error('Failed to obtain response text'), 'Grok', this.modelName);
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

  async invoke(
    messages: BaseMessage[],
    options?: Record<string, unknown>,
  ): Promise<{ content: string; usage_metadata?: { input_tokens: number; output_tokens: number } }> {
    const { signal, ...rest } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;

    const payload = this.toOpenAIMessages(messages);
    const chatBody: any = {
      model: this.modelName,
      messages: payload,
      max_tokens: this.maxTokens,
      ...(this.temperature !== undefined && { temperature: this.temperature }),
      ...this.getReasoningConfig(),
      ...(rest as object),
    };

    // Add Live Search parameters if enabled
    if (this.webSearchEnabled) {
      chatBody.search_parameters = { mode: 'auto' };
    }

    const retries = Math.max(0, this.maxRetries ?? 5);
    let text: string = '';
    let usageMetadata: { input_tokens: number; output_tokens: number } | undefined;
    let lastError: any = null;

    for (let retryNum = 0; retryNum <= retries; retryNum++) {
      try {
        const resp = await this.client.chat.completions.create(chatBody as any, { signal });
        text = resp.choices?.[0]?.message?.content || '';
        // Extract usage metadata from response
        if (resp.usage) {
          usageMetadata = {
            input_tokens: resp.usage.prompt_tokens || 0,
            output_tokens: resp.usage.completion_tokens || 0,
          };
        }
        if (!text || text.trim().length === 0) {
          throw new Error('Empty response text from Grok');
        }
        break;
      } catch (error: any) {
        const msg = String(error?.message || error);
        if (signal?.aborted || msg.includes('AbortError') || msg.includes('aborted')) {
          throw error;
        }
        lastError = normalizeModelError(error, 'Grok', this.modelName);
        // Don't retry auth errors - fail immediately
        if (isNonRetryableError(lastError)) throw lastError;
        if (retryNum === retries) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    if (!text || text.trim().length === 0) {
      throw lastError || normalizeModelError(new Error('Failed to obtain response text'), 'Grok', this.modelName);
    }

    return { content: text, usage_metadata: usageMetadata };
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
    let stream: any;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: this.modelName,
          messages: this.toOpenAIMessages(messages),
          max_tokens: this.maxTokens,
          // Only include temperature if explicitly set; omit to use provider default
          ...(this.temperature !== undefined && { temperature: this.temperature }),
          // Add Live Search parameters if enabled
          ...(this.webSearchEnabled && { search_parameters: { mode: 'auto' } }),
          stream: true,
          stream_options: { include_usage: true },
        } as any,
        { signal },
      );
    } catch (error: any) {
      const msg = String(error?.message || error);
      if (signal?.aborted || msg.includes('AbortError') || msg.includes('aborted')) throw error;
      throw normalizeModelError(error, 'Grok', this.modelName);
    }

    let usage: any = null;
    try {
      for await (const chunk of stream as unknown as AsyncIterable<any>) {
        if (chunk.usage) usage = chunk.usage;
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield { text, done: false };
      }
    } catch (error: any) {
      const msg = String(error?.message || error);
      if (signal?.aborted || msg.includes('AbortError') || msg.includes('aborted')) throw error;
      throw normalizeModelError(error, 'Grok', this.modelName);
    }
    yield { text: '', done: true, usage };
  }
}
