import { SystemMessage } from '@langchain/core/messages';
import { workerSystemPromptTemplate } from './multiagent-worker-prompt';

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