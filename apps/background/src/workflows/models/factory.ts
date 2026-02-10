import { type ProviderConfig, type ModelConfig, ProviderTypeEnum } from '@extension/storage';
// Avoid hard dependency errors on LangChain packages; dynamically import only where needed.
// Replace langchain chat models with native implementations where possible
import { NativeAnthropicChatModel } from './native-anthropic';
import { NativeCustomOpenAIChatModel } from './native-custom-openai';
import { NativeGeminiChatModel } from './native-gemini';
import { NativeGrokChatModel } from './native-grok';
import { NativeOpenAIChatModel } from './native-openai';
import { NativeOpenRouterChatModel } from './native-openrouter';
type BaseChatModel = any;

// create a chat model based on the agent name, the model name and provider
export function createChatModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): BaseChatModel {
  // Temperature is undefined when user wants provider's default; only pass through if explicitly set
  const temperature = modelConfig.parameters?.temperature as number | undefined;
  const maxTokens = (modelConfig.parameters?.maxOutputTokens ?? 8192) as number;
  const apiKey = providerConfig.apiKey || '';

  switch (modelConfig.provider) {
    case ProviderTypeEnum.OpenAI: {
      // Use native OpenAI SDK
      return new NativeOpenAIChatModel({
        model: modelConfig.modelName,
        apiKey,
        baseUrl: providerConfig.baseUrl,
        temperature,
        maxTokens,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;
    }
    case ProviderTypeEnum.Anthropic: {
      // Use native Anthropic SDK with optional web search
      return new NativeAnthropicChatModel({
        model: modelConfig.modelName,
        apiKey,
        temperature,
        maxTokens,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;
    }
    case ProviderTypeEnum.Gemini: {
      // Use native Google GenAI SDK with Google Search grounding
      return new NativeGeminiChatModel({
        model: modelConfig.modelName,
        apiKey,
        temperature,
        maxTokens,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;
    }
    case ProviderTypeEnum.Grok: {
      // Use native Grok (xAI) SDK with Live Search support
      return new NativeGrokChatModel({
        model: modelConfig.modelName,
        apiKey,
        temperature,
        maxTokens,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;
    }
    case ProviderTypeEnum.OpenRouter: {
      // Use dedicated OpenRouter implementation with proper attribution headers
      // See: https://openrouter.ai/docs/quickstart
      return new NativeOpenRouterChatModel({
        model: modelConfig.modelName,
        apiKey,
        baseUrl: providerConfig.baseUrl,
        temperature,
        maxTokens,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;
    }
    case ProviderTypeEnum.CustomOpenAI:
    default: {
      // OpenAI-compatible provider (CustomOpenAI) - for LM Studio, Ollama, vLLM, etc.
      // Uses standard Chat Completions API without OpenAI-specific features
      if (!providerConfig.baseUrl) {
        throw new Error('Base URL is required for OpenAI-compatible providers');
      }
      return new NativeCustomOpenAIChatModel({
        model: modelConfig.modelName,
        apiKey, // May be empty for local models
        baseUrl: providerConfig.baseUrl,
        temperature,
        maxTokens,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 3) as number,
      }) as unknown as BaseChatModel;
    }
  }
}
