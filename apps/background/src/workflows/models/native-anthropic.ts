/**
 * Native Anthropic model implementation with optional web search support
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ThinkingLevel } from '@extension/storage';
// Relax message types to avoid strict dependency on LangChain at build time
type BaseMessage = any;

type WithStructuredOutputResult = {
  invoke: (messages: BaseMessage[], options?: Record<string, unknown>) => Promise<{ parsed: any; raw: any }>;
};

export interface NativeAnthropicArgs {
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  webSearch?: boolean;
  maxRetries?: number;
  thinkingLevel?: ThinkingLevel;
}

export class NativeAnthropicChatModel {
  public readonly modelName: string;
  private readonly client: Anthropic;
  private readonly temperature?: number;
  private readonly maxTokens: number;
  private readonly webSearchEnabled: boolean;
  private readonly maxRetries?: number;
  private readonly thinkingLevel?: ThinkingLevel;

  constructor(args: NativeAnthropicArgs) {
    this.modelName = args.model;
    // Enable browser usage in extension context to satisfy CORS header requirements
    this.client = new Anthropic({ apiKey: args.apiKey, dangerouslyAllowBrowser: true } as any);
    this.temperature = args.temperature;
    this.webSearchEnabled = !!args.webSearch;
    this.maxRetries = args.maxRetries;
    this.thinkingLevel = args.thinkingLevel;

    // When thinking is enabled, max_tokens must exceed budget_tokens
    const requestedMax = args.maxTokens ?? 2048;
    const thinkingBudget = this.getThinkingBudget();
    const minTokens = thinkingBudget > 0 ? thinkingBudget + 1024 : 256;
    this.maxTokens = Math.max(minTokens, Math.min(65536, requestedMax));
  }

  /** Whether this model supports extended thinking */
  private isThinkingCapable(): boolean {
    const l = this.modelName.toLowerCase();
    return /^claude-(opus-4|sonnet-4|sonnet-3-7|3-7-sonnet|haiku-4-5)/.test(l);
  }

  /** Get the thinking budget tokens for the configured level. 0 = thinking disabled. */
  private getThinkingBudget(): number {
    if (!this.isThinkingCapable()) return 0;
    switch (this.thinkingLevel) {
      case 'low':
        return 2048;
      case 'medium':
        return 8192;
      case 'high':
        return 32768;
      default:
        return 0; // 'off', 'default', undefined -> no thinking
    }
  }

  /** Build the thinking and temperature params for a request. */
  private getThinkingParams(): Record<string, unknown> {
    const budget = this.getThinkingBudget();
    if (budget <= 0) {
      // No thinking: include temperature normally
      return this.temperature !== undefined ? { temperature: this.temperature } : {};
    }
    // Anthropic: temperature must be omitted (or set to 1) when thinking is enabled
    return { thinking: { type: 'enabled', budget_tokens: budget } };
  }

  withStructuredOutput(_schema: any, _opts?: { includeRaw?: boolean; name?: string }): WithStructuredOutputResult {
    return {
      invoke: async (messages: BaseMessage[], options?: Record<string, unknown>) => {
        const { system, chatMessages } = this.splitSystem(messages);
        const anthropicMessages = this.toAnthropicMessages(chatMessages);

        const { signal, ...rest } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;

        const retries = Math.max(0, this.maxRetries ?? 5);
        let resp: any = null;
        let text: string = '';
        let lastError: any = null;
        for (let retryNum = 0; retryNum <= retries; retryNum++) {
          try {
            resp = await this.client.messages.create(
              {
                model: this.modelName,
                max_tokens: this.maxTokens,
                ...this.getThinkingParams(),
                system: system || undefined,
                messages: anthropicMessages,
                ...(rest as object),
              } as any,
              { signal },
            );
            text = this.extractText(resp);
            if (!text || text.trim().length === 0) {
              throw new Error('Empty response text from Anthropic');
            }
            break;
          } catch (error: any) {
            // Respect aborts immediately
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
          throw lastError || new Error('Failed to obtain response text from Anthropic');
        }
        let parsed: any = undefined;
        try {
          parsed = JSON.parse(text);
        } catch (_) {
          // Try to extract JSON from text (handles code blocks, preambles, etc.)
          const extracted = this.extractJsonObject(text);
          parsed = extracted ?? { response: text };
        }

        // Handle nested JSON case: if response field contains JSON string, try to extract it
        if (parsed && typeof parsed === 'object' && typeof (parsed as any).response === 'string') {
          const nestedJson = this.extractJsonObject((parsed as any).response as string);
          if (nestedJson && typeof nestedJson.response === 'string') {
            parsed = nestedJson;
          }
        }

        // Normalize expected fields for compatibility
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
    const { system, chatMessages } = this.splitSystem(messages);
    const anthropicMessages = this.toAnthropicMessages(chatMessages);

    const { signal, ...rest } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;
    const retries = Math.max(0, this.maxRetries ?? 5);
    let text: string = '';
    let lastError: any = null;
    for (let retryNum = 0; retryNum <= retries; retryNum++) {
      try {
        const resp = await this.client.messages.create(
          {
            model: this.modelName,
            max_tokens: this.maxTokens,
            ...this.getThinkingParams(),
            system: system || undefined,
            messages: anthropicMessages,
            tools: this.webSearchEnabled
              ? [
                  {
                    type: 'web_search_20250305',
                    name: 'web_search',
                    max_uses: 5,
                  },
                ]
              : undefined,
            ...(rest as object),
          } as any,
          { signal },
        );
        text = this.extractText(resp);
        if (!text || text.trim().length === 0) {
          throw new Error('Empty response text from Anthropic');
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
      throw lastError || new Error('Failed to obtain response text from Anthropic');
    }
    return { content: text };
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

  private toAnthropicMessages(messages: BaseMessage[]) {
    const normalizeBlocks = (content: any): any[] => {
      // Anthropic Messages API expects content blocks like { type: 'text', text } or { type: 'image', source: { type: 'base64', media_type, data } }
      if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
      }
      if (Array.isArray(content)) {
        const blocks: any[] = [];
        for (const item of content) {
          if (item && typeof item === 'object') {
            if ('image_url' in item && item.image_url && typeof item.image_url.url === 'string') {
              const url: string = item.image_url.url as string;
              if (url.startsWith('data:image/')) {
                const [meta, b64] = url.split(',');
                const mediaType = meta.replace('data:', '').replace(';base64', '');
                blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } });
              } else {
                // If it's a remote URL, include a text fallback reference
                blocks.push({ type: 'text', text: `Image: ${url}` });
              }
              continue;
            }
            if (item.type === 'text' && typeof item.text === 'string') {
              blocks.push({ type: 'text', text: item.text });
              continue;
            }
          }
        }
        return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
      }
      return [{ type: 'text', text: String(content ?? '') }];
    };

    return messages
      .filter(m => {
        const hasRole = m && typeof (m as any).role === 'string';
        const roleName = (m as any).constructor?.name;
        return !((hasRole && (m as any).role === 'system') || roleName === 'SystemMessage');
      })
      .map(m => {
        const hasRole = m && typeof (m as any).role === 'string';
        const roleName = (m as any).constructor?.name;
        const contentBlocks = normalizeBlocks((m as any).content);
        if ((hasRole && (m as any).role === 'assistant') || roleName === 'AIMessage') {
          return { role: 'assistant', content: contentBlocks } as const;
        }
        // Default: user for human/unknown
        return { role: 'user', content: contentBlocks } as const;
      });
  }

  private extractText(resp: any): string {
    // Anthropic Messages API response: resp.content is an array of content blocks
    const blocks = resp?.content || [];
    for (const b of blocks) {
      if (b.type === 'text' && typeof b.text === 'string') {
        return b.text;
      }
    }
    return '';
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
    const { system, chatMessages } = this.splitSystem(messages);

    // Use the stream() method for more reliable streaming
    const stream = this.client.messages.stream(
      {
        model: this.modelName,
        max_tokens: this.maxTokens,
        ...this.getThinkingParams(),
        system: system || undefined,
        messages: this.toAnthropicMessages(chatMessages),
      } as any,
      { signal },
    );

    // Process text events as they arrive
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield { text: event.delta.text, done: false };
      }
    }

    // Get final message with usage after stream completes
    const finalMessage = await stream.finalMessage();
    const usage = finalMessage.usage
      ? {
          input_tokens: finalMessage.usage.input_tokens,
          output_tokens: finalMessage.usage.output_tokens,
        }
      : null;

    yield { text: '', done: true, usage };
  }
}
