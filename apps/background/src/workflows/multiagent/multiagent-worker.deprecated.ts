/**
 * @deprecated Superseded by roles/crew-prompt.ts — CrewPrompt replaces WorkerPrompt.
 * Retained for backward compatibility. Do not add new features.
 */
import { SystemMessage } from '@langchain/core/messages';
import { workerSystemPromptTemplate } from './multiagent-worker-prompt.deprecated';

export class WorkerPrompt {
  private readonly systemMessage: SystemMessage;

  constructor(private readonly maxActionsPerStep: number) {
    const formatted = workerSystemPromptTemplate.replace('{{max_actions}}', String(maxActionsPerStep)).trim();
    this.systemMessage = new SystemMessage(formatted);
  }

  getSystemMessage(): SystemMessage {
    return this.systemMessage;
  }
}
