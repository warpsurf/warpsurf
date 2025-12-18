/**
 * Unified model interface to replace LangChain's BaseChatModel
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ModelResponse {
  content: string;
  tool_calls?: ToolCall[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    web_search_count?: number;
  };
}

export interface ModelOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  responseFormat?: {
    type: 'json_object' | 'text';
    schema?: any;
  };
  tools?: Tool[];
  webSearch?: boolean;
}

export interface Tool {
  type: string;
  name?: string;
  description?: string;
  parameters?: any;
  // For Google search grounding
  googleSearch?: {};
  // For Anthropic web search
  max_uses?: number;
}

export interface ChatModel {
  invoke(messages: Message[], options?: ModelOptions): Promise<ModelResponse>;
  withStructuredOutput?(schema: any, options?: any): ChatModel;
  modelName: string;
  supportsTools: boolean;
  supportsWebSearch: boolean;
}

export interface ModelConfig {
  provider: string;
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  webSearch?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  parameters?: Record<string, unknown>;
}

