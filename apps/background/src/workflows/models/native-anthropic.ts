/**
 * Native Anthropic model implementation with optional web search support
 */

import Anthropic from '@anthropic-ai/sdk';
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
}

export class NativeAnthropicChatModel {
  public readonly modelName: string;
  private readonly client: Anthropic;
  private readonly temperature?: number;
  private readonly maxTokens: number;
  private readonly webSearchEnabled: boolean;
  private readonly maxRetries?: number;

  constructor(args: NativeAnthropicArgs) {
    this.modelName = args.model;
    // Enable browser usage in extension context to satisfy CORS header requirements
    this.client = new Anthropic({ apiKey: args.apiKey, dangerouslyAllowBrowser: true } as any);
    this.temperature = args.temperature;
    this.maxTokens = Math.max(256, Math.min(8192, args.maxTokens ?? 2048));
    this.webSearchEnabled = !!args.webSearch;
    this.maxRetries = args.maxRetries;
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
                temperature: this.temperature,
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
            temperature: this.temperature,
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
}
