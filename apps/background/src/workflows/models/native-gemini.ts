/**
 * Native Google Gemini model implementation using @google/generative-ai
 * Supports Google Search grounding when enabled.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { BaseMessage } from '@langchain/core/messages';

export interface NativeGeminiArgs {
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  webSearch?: boolean;
  maxRetries?: number;
}

export class NativeGeminiChatModel {
  public readonly modelName: string;
  private readonly client: GoogleGenerativeAI;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly webSearchEnabled: boolean;
  private readonly maxRetries?: number;

  constructor(args: NativeGeminiArgs) {
    this.modelName = args.model;
    // Google SDK expects the API key string in the constructor
    this.client = new GoogleGenerativeAI(args.apiKey as any);
    this.temperature = args.temperature;
    this.maxTokens = args.maxTokens;
    this.webSearchEnabled = !!args.webSearch;
    this.maxRetries = args.maxRetries;
  }

  withStructuredOutput(schema: any, _opts?: { includeRaw?: boolean; name?: string }) {
    return {
      invoke: async (messages: BaseMessage[], options?: Record<string, unknown>) => {
        const { system, chatMessages } = this.splitSystem(messages);
        const contents = this.toGeminiContents(chatMessages);

        // Build request per Google SDK suggested structure
        const model = this.client.getGenerativeModel({ model: this.modelName });
        
        // Models don't have access to context - removed incorrect wrapper

        // Gemini does not support using tools together with responseMimeType: 'application/json'
        // When web search tools are enabled, drop structured response hints and parse JSON from text.
        const useStructuredHints = !this.webSearchEnabled;

        const requestBody: any = {
          contents,
          systemInstruction: system || undefined,
          generationConfig: {
            temperature: this.temperature,
            maxOutputTokens: this.maxTokens,
            ...(useStructuredHints
              ? {
                  responseMimeType: 'application/json',
                  responseSchema: schema || undefined,
                }
              : {}),
          },
          tools: this.webSearchEnabled ? [{ googleSearch: {} }] : undefined,
        };

        const { signal } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;
        
        // Models don't have access to context
        
        const retries = Math.max(0, this.maxRetries ?? 5);
        let resp: any = null;
        let text: string = '';
        let lastError: any = null;
        for (let retryNum = 0; retryNum <= retries; retryNum++) {
          try {
            resp = await model.generateContent(requestBody as any, { signal });
            text = resp.response?.text() ?? '';
            if (!text || text.trim().length === 0) {
              throw new Error('Empty response text from Gemini');
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
          throw (lastError || new Error('Failed to obtain response text from Gemini'));
        }

        // Note: Actual token logging is handled by llm-fetch-logger.ts to prevent duplicates
        let parsed: any = undefined;
        if (useStructuredHints) {
          // Expect raw JSON text
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { response: text, done: true };
          }
        } else {
          // Tools enabled: model may wrap JSON in code fences; try to extract a JSON object
          const extracted = this.extractJsonObject(text);
          if (extracted) {
            parsed = extracted;
          } else {
            parsed = { response: text, done: true };
          }
        }
        // If response is still a code block, try to parse nested JSON once more
        if (parsed && typeof parsed === 'object' && typeof (parsed as any).response === 'string') {
          const nested = this.extractJsonObject((parsed as any).response as string);
          if (nested) {
            parsed = nested;
          }
        }
        // Normalize fields expected by callers
        if (parsed && typeof parsed === 'object') {
          if (typeof (parsed as any).response !== 'string') {
            (parsed as any).response = typeof text === 'string' ? text : String(text);
          }
          if (typeof (parsed as any).done !== 'boolean') {
            (parsed as any).done = true;
          }
          if (!('search_queries' in (parsed as any))) {
            (parsed as any).search_queries = [];
          }
        }
        // Gemini returns usage in response.usageMetadata
        const usageMetadata = resp?.response?.usageMetadata;
        return { parsed, raw: { content: text }, usage_metadata: usageMetadata };
      },
    };
  }

  async invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<{ content: string }> {
    const { system, chatMessages } = this.splitSystem(messages);
    const contents = this.toGeminiContents(chatMessages);
    const model = this.client.getGenerativeModel({ model: this.modelName });

    const { signal } = (options || {}) as { signal?: AbortSignal } & Record<string, unknown>;
    const requestBody: any = {
      contents,
      systemInstruction: system || undefined,
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens,
      },
      tools: this.webSearchEnabled ? [{ googleSearch: {} }] : undefined,
    };
    
    // Models don't have access to context - removed incorrect wrapper
    
    // Models don't have access to context
    
    const retries = Math.max(0, this.maxRetries ?? 5);
    let text: string = '';
    let lastError: any = null;
    for (let retryNum = 0; retryNum <= retries; retryNum++) {
      try {
        const resp = await model.generateContent(requestBody as any, { signal });
        text = resp.response?.text() ?? '';
        if (!text || text.trim().length === 0) {
          throw new Error('Empty response text from Gemini');
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
      throw (lastError || new Error('Failed to obtain response text from Gemini'));
    }

    // Note: Actual token logging is handled by llm-fetch-logger.ts to prevent duplicates
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
            .map((p: any) => (p && typeof p === 'object' && typeof p.text === 'string') ? p.text : '')
            .filter(Boolean);
          return texts.join('\n');
        } catch { return JSON.stringify(c); }
      }
      try { return JSON.stringify(c); } catch { return String(c ?? ''); }
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

  private toGeminiContents(messages: BaseMessage[]) {
    const normalizeParts = (content: any): any[] => {
      // Gemini expects parts as e.g., { text: string } or { inlineData: { mimeType, data } }
      if (typeof content === 'string') {
        return [{ text: content }];
      }
      if (Array.isArray(content)) {
        const parts: any[] = [];
        for (const item of content) {
          if (item && typeof item === 'object') {
            // Handle OpenAI-style image_url blocks
            if ('image_url' in item && item.image_url && typeof item.image_url.url === 'string') {
              const url: string = item.image_url.url as string;
              // Accept data URLs; if http(s) url, pass as { fileData: { fileUri } } is not supported client-side here, so keep as text hint
              if (url.startsWith('data:image/')) {
                const [meta, b64] = url.split(',');
                const mime = meta.replace('data:', '').replace(';base64', '');
                parts.push({ inlineData: { mimeType: mime, data: b64 } });
              } else {
                // Fallback: include as text reference if not data URL
                parts.push({ text: `Image: ${url}` });
              }
              continue;
            }
            if (item.type === 'text' && typeof item.text === 'string') {
              parts.push({ text: item.text });
              continue;
            }
          }
        }
        return parts.length > 0 ? parts : [{ text: '' }];
      }
      return [{ text: String(content ?? '') }];
    };

    const contents: any[] = [];
    for (const m of messages) {
      const hasRole = m && typeof (m as any).role === 'string';
      const role = (m as any).constructor?.name;
      if ((hasRole && (m as any).role === 'system') || role === 'SystemMessage') {
        // system handled in systemInstruction
        continue;
      }
      const parts = normalizeParts((m as any).content);
      if ((hasRole && (m as any).role === 'assistant') || role === 'AIMessage') {
        contents.push({ role: 'model', parts });
      } else {
        contents.push({ role: 'user', parts });
      }
    }
    return contents;
  }

  private extractJsonObject(text: string): Record<string, unknown> | null {
    try {
      // Strip common code fences
      const fenceMatch = text.match(/```json[\s\S]*?```/i) || text.match(/```[\s\S]*?```/);
      let candidate = fenceMatch ? fenceMatch[0] : text;
      candidate = candidate.replace(/```json/i, '').replace(/```/g, '').trim();
      // Find first JSON object if extra prose remains
      const firstBrace = candidate.indexOf('{');
      const lastBrace = candidate.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonSlice = candidate.slice(firstBrace, lastBrace + 1);
        return JSON.parse(jsonSlice) as Record<string, unknown>;
      }
      // Direct parse attempt
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

