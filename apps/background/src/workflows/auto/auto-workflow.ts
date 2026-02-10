import { createChatModel } from '@src/workflows/models/factory';
import { AgentNameEnum, getDefaultDisplayNameFromProviderId, generalSettingsStore } from '@extension/storage';
import { getAllProvidersDecrypted, getAllAgentModelsDecrypted } from '@src/crypto';
import { createLogger } from '@src/log';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { SystemPrompt } from './auto-prompt';
import { logLLMUsage, globalTokenTracker } from '@src/utils/token-tracker';
import { getChatHistoryForSession } from '@src/workflows/shared/utils/chat-history';

interface TabMetadata {
  id: number;
  title: string;
  url: string;
}

const logger = createLogger('AutoWorkflow');

export type AutoAction = 'request_more_info' | 'chat' | 'search' | 'agent' | 'tool';

export interface AutoResult {
  action: AutoAction;
  confidence: number;
  reasoning?: string;
  /** When action is 'tool', indicates what to do after tool calls complete. */
  afterTool?: 'chat' | 'search' | 'agent' | 'none';
}

/**
 * Analyzes user requests to determine the most appropriate workflow.
 * Routes tasks to Chat, Search, or Agent workflows based on complexity and requirements.
 */
export class AutoWorkflow {
  private autoLLM: BaseChatModel | null = null;

  async initialize(): Promise<void> {
    try {
      logger.info('Starting auto service initialization...');

      const providers = await getAllProvidersDecrypted();
      logger.info(`Found ${Object.keys(providers).length} providers:`, Object.keys(providers));

      if (Object.keys(providers).length === 0) {
        logger.warning('No LLM providers configured for auto');
        return;
      }

      const agentModels = await getAllAgentModelsDecrypted();
      logger.info(`Found agent models:`, Object.keys(agentModels));

      let autoModel = agentModels[AgentNameEnum.Auto];
      let modelSource = 'dedicated auto model';

      if (!autoModel) {
        logger.info('No auto model configured, falling back to planner model');
        autoModel = agentModels[AgentNameEnum.AgentPlanner];
        modelSource = 'planner model fallback';

        if (!autoModel) {
          logger.warning('No planner model available for auto fallback');
          return;
        }
      }

      logger.info(`Using ${modelSource} for auto:`, autoModel);

      const autoProviderConfig = providers[autoModel.provider];
      if (!autoProviderConfig) {
        logger.warning(`Provider '${getDefaultDisplayNameFromProviderId(autoModel.provider)}' not found`);
        return;
      }

      this.autoLLM = createChatModel(autoProviderConfig, autoModel);
      logger.info(`Auto service initialized successfully using ${modelSource}`);
    } catch (error) {
      logger.error('Failed to initialize auto service:', error);
    }
  }

  /**
   * Get metadata for context tabs (title, url, id) without extracting content.
   */
  private async getContextTabsMetadata(tabIds: number[]): Promise<TabMetadata[]> {
    const metadata: TabMetadata[] = [];
    for (const tabId of tabIds) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && tab.title) {
          metadata.push({
            id: tabId,
            title: tab.title,
            url: tab.url,
          });
        }
      } catch (e) {
        logger.debug(`Could not get metadata for tab ${tabId}:`, e);
      }
    }
    return metadata;
  }

  /**
   * Build the context tabs section for the prompt (metadata only, no content).
   */
  private buildContextTabsSection(tabsMetadata: TabMetadata[]): string {
    if (tabsMetadata.length === 0) return '';

    const lines = tabsMetadata.map(tab => `- Tab ID: ${tab.id}, Title: "${tab.title}", URL: ${tab.url}`);

    return `\n\n[Tabs added as context by user]
The user has added the following tabs as context for their request:
${lines.join('\n')}

Consider these tabs when determining the appropriate action. If the request relates to content from these tabs (e.g., "summarise these tabs"), the chat action is appropriate.`;
  }

  async triageRequest(request: string, sessionId?: string, contextTabIds?: number[]): Promise<AutoResult> {
    logger.info(`Auto request: "${request}"`);

    // If LLM is not initialized, try to initialize it now
    if (!this.autoLLM) {
      logger.info('Auto LLM not initialized, attempting to initialize...');
      await this.initialize();
    }

    // If still no LLM available, use fallback logic
    if (!this.autoLLM) {
      logger.warning('Auto LLM not available, using fallback logic');
      return this.fallbackTriage(request);
    }

    // Get context tabs metadata if provided
    let contextTabsSection = '';
    if (contextTabIds && contextTabIds.length > 0) {
      const tabsMetadata = await this.getContextTabsMetadata(contextTabIds);
      contextTabsSection = this.buildContextTabsSection(tabsMetadata);
      logger.info(`Added ${tabsMetadata.length} context tabs metadata to auto prompt`);
    }

    const systemPrompt = `${SystemPrompt}${contextTabsSection}

Here is the request:
${request}`;

    // Get timeout from settings
    const settings = await generalSettingsStore.getSettings();
    const timeoutMs = (settings.responseTimeoutSeconds ?? 120) * 1000;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      // Build messages with chat history context
      const messages: BaseMessage[] = [new SystemMessage(systemPrompt)];

      // Inject chat history if session ID is available
      if (sessionId) {
        const historyBlock = await getChatHistoryForSession(sessionId, {
          latestTaskText: request,
          stripUserRequestTags: true,
        });
        if (historyBlock) {
          messages.push(new SystemMessage(historyBlock));
        }
      }

      messages.push(new HumanMessage(request));

      logger.debug(`Starting Auto API Request for: ${request}`);

      const response = await this.autoLLM.invoke(messages, { signal: controller.signal });
      clearTimeout(timeoutId);

      // Log token usage with the session ID
      const taskId = sessionId || globalTokenTracker.getCurrentTaskId() || 'unknown';
      const modelName = (this.autoLLM as any)?.modelName || (this.autoLLM as any)?.model || 'unknown';
      logLLMUsage(response, { taskId, role: 'auto', modelName, inputMessages: messages });

      logger.info(`Raw auto response: ${response.content}`);

      if (typeof response.content === 'string') {
        // Try to parse JSON from the response
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          logger.info(`Parsed auto result: ${JSON.stringify(parsed)}`);
          if (parsed.action && ['request_more_info', 'chat', 'search', 'agent', 'tool'].includes(parsed.action)) {
            // Enforce no 'request_more_info' usage
            const normalizedAction = parsed.action === 'request_more_info' ? 'chat' : parsed.action;
            const result: AutoResult = {
              action: normalizedAction as AutoAction,
              confidence: parsed.confidence || 0.8,
              reasoning: parsed.reasoning,
            };
            if (normalizedAction === 'tool') {
              result.afterTool = ['chat', 'search', 'agent', 'none'].includes(parsed.after_tool)
                ? parsed.after_tool
                : 'none';
            }
            return result;
          }
        }
      }

      // Fallback to browser_use if parsing fails
      logger.warning('Failed to parse auto response, using fallback');
      return this.fallbackTriage(request);
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (timedOut) {
        logger.warning('Auto request timed out, using fallback');
      } else {
        const msg = String(error?.message || error);
        if (msg.includes('abort')) {
          logger.info('Auto request cancelled');
        } else {
          logger.error('Auto request failed:', error);
        }
      }
      return this.fallbackTriage(request);
    }
  }

  private fallbackTriage(request: string): AutoResult {
    const lower = request.toLowerCase();

    // Check for tool/settings-related requests FIRST (highest priority)
    const toolPatterns = [
      'turn on',
      'turn off',
      'enable',
      'disable',
      'toggle',
      'set temperature',
      'set max',
      'set timeout',
      'switch model',
      'change model',
      'use model',
      'what model',
      'show settings',
      'current settings',
      'add tabs to context',
      'add my tabs',
      'include tabs',
      'vision mode',
      'useVision',
    ];
    if (toolPatterns.some(p => lower.includes(p))) {
      return { action: 'tool', confidence: 0.7, afterTool: 'none', reasoning: 'Detected settings/tool request' };
    }

    // Check for current/news related queries
    if (['current', 'latest', 'news', 'today', 'weather'].some(k => lower.includes(k))) {
      return { action: 'search', confidence: 0.7, reasoning: 'Detected as requiring current information' };
    }

    // Check for simple questions
    if (['what is', 'who is', 'explain', 'define', 'how does', 'why'].some(k => lower.includes(k))) {
      return { action: 'chat', confidence: 0.7, reasoning: 'Detected as a simple question' };
    }

    // Default to browser use for complex tasks
    return { action: 'agent', confidence: 0.5, reasoning: 'Defaulting to browser use for potentially complex task' };
  }
}
