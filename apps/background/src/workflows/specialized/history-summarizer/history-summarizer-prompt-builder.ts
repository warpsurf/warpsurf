import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BasePrompt } from '@src/workflows/shared/prompts/base-prompt';
import { systemPrompt } from './history-summarizer-prompt';
import type { AgentContext } from '@src/workflows/shared/agent-types';

/**
 * Simple prompt for History Summariser agent
 * This agent doesn't need browser state, just the history data passed via setHistory()
 */
export class HistorySummariserPrompt extends BasePrompt {
  getSystemMessage(): SystemMessage {
    return new SystemMessage(systemPrompt);
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    // History Summariser doesn't use browser state
    // The actual history data is passed via the agent's setHistory() method
    // and formatted in the agent's execute() method
    return new HumanMessage('Ready to analyze history.');
  }
}

