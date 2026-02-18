import { createChatModel } from '@src/workflows/models/factory';
import { AgentNameEnum, chatHistoryStore } from '@extension/storage';
import { getAllProvidersDecrypted, getAllAgentModelsDecrypted } from '@src/crypto';
import { createLogger } from '@src/log';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { TitleGeneratorPrompt } from './title-generator-prompt';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

const logger = createLogger('TitleGenerator');

class TitleGeneratorService {
  private llm: BaseChatModel | null = null;
  private initPromise: Promise<void> | null = null;
  private generatedSessions = new Set<string>();

  async initialize(): Promise<void> {
    if (this.llm) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      const providers = await getAllProvidersDecrypted();
      if (Object.keys(providers).length === 0) {
        logger.warning('No providers configured');
        return;
      }

      const agentModels = await getAllAgentModelsDecrypted();
      let model = agentModels[AgentNameEnum.Auto];

      if (!model) {
        model = agentModels[AgentNameEnum.AgentPlanner];
        if (!model) {
          logger.warning('No auto or planner model available');
          return;
        }
      }

      const providerConfig = providers[model.provider];
      if (!providerConfig) {
        logger.warning(`Provider '${model.provider}' not found`);
        return;
      }

      this.llm = createChatModel(providerConfig, model);
      logger.info('Title generator initialized');
    } catch (error) {
      logger.error('Failed to initialize:', error);
    }
  }

  async generateTitle(sessionId: string, fallbackPrompt?: string): Promise<string | null> {
    if (this.generatedSessions.has(sessionId)) {
      return null;
    }

    await this.initialize();
    if (!this.llm) return null;

    try {
      const session = await chatHistoryStore.getSession(sessionId);
      const messages = session?.messages || [];

      // Build conversation text from messages, or use fallback prompt
      let conversationText = messages
        .slice(0, 6)
        .map(m => `${m.actor}: ${m.content}`)
        .join('\n')
        .trim();

      // If no messages or only system messages, use the fallback prompt
      if (!conversationText || !messages.some(m => m.actor === 'user')) {
        if (fallbackPrompt) {
          conversationText = `user: ${fallbackPrompt}`;
        } else {
          return null;
        }
      }

      const response = await this.llm.invoke([
        new SystemMessage(TitleGeneratorPrompt),
        new HumanMessage(conversationText),
      ]);

      const title = String(response.content || '')
        .trim()
        .replace(/^["']|["']$/g, '');

      if (title && title.length > 0 && title.length < 100) {
        this.generatedSessions.add(sessionId);
        await chatHistoryStore.updateTitle(sessionId, title);
        await this.updateDashboardStorage(sessionId, title);
        logger.info(`Generated title for ${sessionId}: "${title}"`);
        return title;
      }
    } catch (error) {
      logger.error(`Failed to generate title for ${sessionId}:`, error);
    }

    return null;
  }

  hasGeneratedTitle(sessionId: string): boolean {
    return this.generatedSessions.has(sessionId);
  }

  clearSession(sessionId: string): void {
    this.generatedSessions.delete(sessionId);
  }

  private async updateDashboardStorage(sessionId: string, title: string): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['agent_dashboard_running', 'agent_dashboard_completed']);
      const running = Array.isArray(result.agent_dashboard_running) ? result.agent_dashboard_running : [];
      const completed = Array.isArray(result.agent_dashboard_completed) ? result.agent_dashboard_completed : [];

      let updated = false;
      const updateTitle = (arr: any[]) =>
        arr.map((a: any) => {
          if (a.sessionId === sessionId) {
            updated = true;
            return { ...a, sessionTitle: title };
          }
          return a;
        });

      const newRunning = updateTitle(running);
      const newCompleted = updateTitle(completed);

      if (updated) {
        await chrome.storage.local.set({
          agent_dashboard_running: newRunning,
          agent_dashboard_completed: newCompleted,
        });
      }
    } catch (e) {
      logger.error('Failed to update dashboard storage:', e);
    }
  }
}

export const titleGenerator = new TitleGeneratorService();
