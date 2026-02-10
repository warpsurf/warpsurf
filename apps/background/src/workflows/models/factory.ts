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
  const temperature = modelConfig.parameters?.temperature as number | undefined;
  const maxTokens = (modelConfig.parameters?.maxOutputTokens ?? 8192) as number;
  const thinkingLevel = modelConfig.thinkingLevel;

  switch (modelConfig.provider) {
    case ProviderTypeEnum.OpenAI:
      return new NativeOpenAIChatModel({
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        temperature,
        maxTokens,
        thinkingLevel,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;

    case ProviderTypeEnum.Anthropic:
      return new NativeAnthropicChatModel({
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        maxTokens,
        thinkingLevel,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;

    case ProviderTypeEnum.Gemini:
      return new NativeGeminiChatModel({
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        maxTokens,
        thinkingLevel,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;

    case ProviderTypeEnum.Grok:
      return new NativeGrokChatModel({
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        maxTokens,
        thinkingLevel,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;

    case ProviderTypeEnum.OpenRouter:
      return new NativeOpenRouterChatModel({
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        temperature,
        maxTokens,
        thinkingLevel,
        webSearch: !!modelConfig.webSearch,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 5) as number,
      }) as unknown as BaseChatModel;

    case ProviderTypeEnum.CustomOpenAI:
    default: {
      if (!providerConfig.baseUrl) {
        throw new Error('Base URL is required for OpenAI-compatible providers');
      }
      return new NativeCustomOpenAIChatModel({
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        temperature,
        maxTokens,
        maxRetries: (modelConfig.parameters?.maxRetries ?? 3) as number,
      }) as unknown as BaseChatModel;
    }
  }
}
