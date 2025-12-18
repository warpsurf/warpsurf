import type { z } from 'zod';
import type { AgentContext, AgentOutput } from './agent-types';
import type { BasePrompt } from '@src/workflows/shared/prompts/base-prompt';
type BaseMessage = any;
import { createLogger } from '@src/log';
import type { Action } from '@src/workflows/agent/actions/builder';
import { convertInputMessages, extractJsonFromModelOutput, removeThinkTags } from '@src/workflows/shared/messages/utils';
import { isAbortedError, ResponseTimeoutError } from './agent-errors';
import { convertZodToJsonSchema } from '@src/utils';
import { globalTokenTracker, type TokenUsage } from '@src/utils/token-tracker';
import { calculateCost } from '@src/utils/cost-calculator';
import { generalSettingsStore } from '@extension/storage';

const logger = createLogger('agent');

interface TimeoutSignalResult {
  signal: AbortSignal;
  isTimeout: () => boolean;
  cleanup: () => void;
}

/** Create an AbortSignal that fires when either the user aborts or timeout expires */
function createTimeoutSignal(userSignal: AbortSignal, timeoutMs: number): TimeoutSignalResult {
  const controller = new AbortController();
  let timedOut = false;
  
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new ResponseTimeoutError(timeoutMs / 1000));
  }, timeoutMs);
  
  // Abort if user cancels
  userSignal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
    controller.abort(userSignal.reason);
  }, { once: true });
  
  // Clean up timeout if controller aborts for other reasons
  controller.signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true });
  
  return {
    signal: controller.signal,
    isTimeout: () => timedOut,
    cleanup: () => clearTimeout(timeoutId),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallOptions = Record<string, any>;

// Update options to use Zod schema
export interface BaseAgentOptions {
  chatLLM: any;
  context: AgentContext;
  prompt: BasePrompt;
}
export interface ExtraAgentOptions {
  id?: string;
  toolCallingMethod?: string;
  callOptions?: CallOptions;
}

/**
 * Base class for all agents
 * @param T - The Zod schema for the model output
 * @param M - The type of the result field of the agent output
 */
export abstract class BaseAgent<T extends z.ZodType, M = unknown> {
  protected id: string;
  protected chatLLM: any;
  protected prompt: BasePrompt;
  protected context: AgentContext;
  protected actions: Record<string, Action> = {};
  protected modelOutputSchema: T;
  protected toolCallingMethod: string | null;
  protected chatModelLibrary: string;
  protected modelName: string;
  protected withStructuredOutput: boolean;
  protected callOptions?: CallOptions;
  protected modelOutputToolName: string;
  protected logger: ReturnType<typeof createLogger>;
  declare ModelOutput: z.infer<T>;

  constructor(modelOutputSchema: T, options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    // base options
    this.modelOutputSchema = modelOutputSchema;
    this.chatLLM = options.chatLLM;
    this.prompt = options.prompt;
    this.context = options.context;
    this.chatModelLibrary = this.chatLLM.constructor.name;
    this.modelName = this.getModelName();
    this.withStructuredOutput = this.setWithStructuredOutput();
    // extra options
    this.id = extraOptions?.id || 'agent';
    this.toolCallingMethod = this.setToolCallingMethod(extraOptions?.toolCallingMethod);
    this.callOptions = extraOptions?.callOptions;
    this.modelOutputToolName = `${this.id}_output`;
    this.logger = createLogger(this.id);
  }

  // Set the model name
  private getModelName(): string {
    if ('modelName' in this.chatLLM) {
      return this.chatLLM.modelName as string;
    }
    if ('model_name' in this.chatLLM) {
      return this.chatLLM.model_name as string;
    }
    if ('model' in this.chatLLM) {
      return this.chatLLM.model as string;
    }
    return 'Unknown';
  }

  // Set the tool calling method
  private setToolCallingMethod(toolCallingMethod?: string): string | null {
    if (toolCallingMethod === 'auto') {
      switch (this.chatModelLibrary) {
        case 'ChatGoogleGenerativeAI':
          return null;
        case 'ChatOpenAI':
        case 'AzureChatOpenAI':
        case 'ChatGroq':
        case 'ChatXAI':
          return 'function_calling';
        default:
          return null;
      }
    }
    return toolCallingMethod || null;
  }

  // Set whether to use structured output based on the model name
  private setWithStructuredOutput(): boolean {
    if (this.modelName === 'deepseek-reasoner' || this.modelName === 'deepseek-r1') {
      return false;
    }
    return true;
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    // Get timeout from settings and create combined signal
    const settings = await generalSettingsStore.getSettings();
    const timeoutMs = (settings.responseTimeoutSeconds ?? 120) * 1000;
    const { signal, isTimeout, cleanup } = createTimeoutSignal(this.context.controller.signal, timeoutMs);

    // Use structured output when supported by the model wrapper; otherwise fall back
    if (this.withStructuredOutput && typeof (this.chatLLM?.withStructuredOutput) === 'function') {
      // Convert Zod schema to JSON Schema to support native SDKs (OpenAI, Gemini, etc.)
      const jsonSchema = convertZodToJsonSchema(this.modelOutputSchema, this.modelOutputToolName, true);
      let structuredLlm: any;
      try {
        structuredLlm = this.chatLLM.withStructuredOutput(jsonSchema, {
          includeRaw: true,
          name: this.modelOutputToolName,
        });
      } catch (e) {
        logger.warning(`[${this.modelName}] Model lacks withStructuredOutput; falling back to unstructured parsing`);
        structuredLlm = null;
      }

      if (structuredLlm) {
        try {
          const response = await structuredLlm.invoke(inputMessages, {
            signal,
            ...this.callOptions,
          });
          cleanup();

          // Log token usage with this agent's taskId - the response came back to us
          this.logTokenUsage(response, inputMessages);

          if (response.parsed) {
            return response.parsed;
          }
          logger.error('Failed to parse response', response);
          throw new Error('Could not parse response with structured output');
        } catch (error: any) {
          cleanup();
          const msg = String(error?.message || error);
          const isAbortLike = msg.includes('signal is aborted') || msg.includes('Request aborted') || msg.includes('AbortError');
          
          // If error looks like abort/timeout, check if we have real error info
          if (isAbortedError(error) || isAbortLike) {
            // User cancelled
            if (this.context.stopped) {
              throw new Error('AbortError: request was aborted');
            }
            // Our timeout fired - throw timeout error
            if (isTimeout()) {
              throw new ResponseTimeoutError(timeoutMs / 1000);
            }
            // Some other abort (SDK internal?) - still report as abort
            throw new Error('AbortError: request was aborted');
          }
          
          // Real API error - propagate immediately with actual message
          throw error;
        }
      }
    }

    // Without structured output support, need to extract JSON from model output manually
    const convertedInputMessages = convertInputMessages(inputMessages, this.modelName);
    let response;
    try {
      response = await this.chatLLM.invoke(convertedInputMessages, {
        signal,
        ...this.callOptions,
      });
      cleanup();
    } catch (error: any) {
      cleanup();
      const msg = String(error?.message || error);
      const isAbortLike = msg.includes('signal is aborted') || msg.includes('Request aborted') || msg.includes('AbortError');
      
      // If error looks like abort/timeout, check why
      if (isAbortedError(error) || isAbortLike) {
        if (this.context.stopped) {
          throw new Error('AbortError: request was aborted');
        }
        if (isTimeout()) {
          throw new ResponseTimeoutError(timeoutMs / 1000);
        }
        throw new Error('AbortError: request was aborted');
      }
      
      // Real API error - propagate immediately
      throw error;
    }

    // Log token usage with this agent's taskId
    this.logTokenUsage(response, convertedInputMessages);

    if (typeof response.content === 'string') {
      response.content = removeThinkTags(response.content);
      try {
        const extractedJson = extractJsonFromModelOutput(response.content);
        const parsed = this.validateModelOutput(extractedJson);
        if (parsed) {
          return parsed;
        }
      } catch (error) {
        const errorMessage = `Failed to extract JSON from response: ${error}`;
        throw new Error(errorMessage);
      }
    }
    const errorMessage = `Failed to parse response: ${response}`;
    logger.error(errorMessage);
    throw new Error('Could not parse response');
  }

  // Execute the agent and return the result
  abstract execute(): Promise<AgentOutput<M>>;

  // Helper method to validate metadata
  protected validateModelOutput(data: unknown): this['ModelOutput'] | undefined {
    if (!this.modelOutputSchema || !data) return undefined;
    try {
      return this.modelOutputSchema.parse(data);
    } catch (error) {
      logger.error('validateModelOutput', error);
      throw new Error('Could not validate model output');
    }
  }

  /**
   * Extract token usage from LangChain response and log it with this agent's taskId.
   */
  protected logTokenUsage(response: any, inputMessages: BaseMessage[]): void {
    try {
      const taskId = this.context?.taskId;
      if (!taskId) {
        return;
      }

      // Extract usage from various LangChain response formats
      let inputTokens = 0;
      let outputTokens = 0;
      let thoughtTokens = 0;
      let webSearchCount = 0;

      // Try multiple paths to find usage metadata
      const metadata = response?.response_metadata || response?.raw?.response_metadata;
      const rawUsage = response?.raw?.usage_metadata;
      const directUsage = response?.usage_metadata;
      
      // OpenAI/Anthropic format: token_usage or usage in metadata
      if (metadata?.token_usage || metadata?.usage) {
        const usage = metadata.token_usage || metadata.usage;
        inputTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
        outputTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
        thoughtTokens = Number(usage.thinking_tokens || usage.reasoning_tokens || 0);
        webSearchCount = Number(usage.server_tool_use?.web_search_requests || 0);
      }
      // Gemini format in metadata.usage_metadata
      else if (metadata?.usage_metadata) {
        const usage = metadata.usage_metadata;
        inputTokens = Number(usage.promptTokenCount || usage.prompt_token_count || usage.input_tokens || 0);
        outputTokens = Number(usage.candidatesTokenCount || usage.candidates_token_count || usage.output_tokens || 0);
        thoughtTokens = Number(usage.thoughtsTokenCount || usage.thoughts_token_count || 0);
      }
      // Gemini format directly on raw response
      else if (rawUsage) {
        inputTokens = Number(rawUsage.promptTokenCount || rawUsage.input_tokens || 0);
        outputTokens = Number(rawUsage.candidatesTokenCount || rawUsage.output_tokens || 0);
        thoughtTokens = Number(rawUsage.thoughtsTokenCount || rawUsage.thoughts_token_count || 0);
      }
      // Gemini format directly on response
      else if (directUsage) {
        inputTokens = Number(directUsage.promptTokenCount || directUsage.input_tokens || 0);
        outputTokens = Number(directUsage.candidatesTokenCount || directUsage.output_tokens || 0);
        thoughtTokens = Number(directUsage.thoughtsTokenCount || directUsage.thoughts_token_count || 0);
      }

      const totalTokens = inputTokens + outputTokens + thoughtTokens;
      const hasUsageData = totalTokens > 0;

      // Determine provider from model library
      let provider = 'LLM';
      if (this.chatModelLibrary.includes('Google') || this.chatModelLibrary.includes('Gemini')) {
        provider = 'Google Gemini';
      } else if (this.chatModelLibrary.includes('OpenAI') || this.chatModelLibrary.includes('Azure')) {
        provider = 'OpenAI';
      } else if (this.chatModelLibrary.includes('Anthropic')) {
        provider = 'Anthropic';
      } else if (this.chatModelLibrary.includes('Groq')) {
        provider = 'Groq';
      } else if (this.chatModelLibrary.includes('XAI')) {
        provider = 'xAI';
      }

      // Cost is -1 (unavailable) if we don't have actual token counts from API
      const cost = hasUsageData 
        ? calculateCost(this.modelName, inputTokens, outputTokens + thoughtTokens, webSearchCount)
        : -1;
      const roleStamp = String(this.id || 'agent').replace(/-/g, '_');

      // Build request summary for logging
      const requestSummary = {
        messages: inputMessages.slice(-5).map((m: any) => ({
          role: m?._getType?.() || m?.role || 'unknown',
          content: String(m?.content || '').slice(0, 2000)
        }))
      };

      // Build response summary
      const responseSummary = response?.parsed || response?.content || response;

      const usage: TokenUsage = {
        inputTokens,
        outputTokens: outputTokens + thoughtTokens,
        totalTokens,
        thoughtTokens,
        webSearchCount,
        timestamp: Date.now(),
        provider,
        modelName: this.modelName,
        cost,
        taskId,
        role: roleStamp,
        request: requestSummary,
        response: responseSummary,
      };

      // Use addTokenUsage directly - each agent invoke should be logged
      // Generate unique apiCallId for this specific call
      const callId = `${taskId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      globalTokenTracker.addTokenUsage(callId, usage);
    } catch (e) {
      this.logger.debug('logTokenUsage: Error', e);
    }
  }
}
