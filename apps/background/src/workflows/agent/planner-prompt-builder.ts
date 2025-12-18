/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from '@src/workflows/shared/prompts/base-prompt';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '../shared/agent-types';
import { plannerSystemPromptTemplate } from './agent-planner-prompt';

export class PlannerPrompt extends BasePrompt {
  getSystemMessage(): SystemMessage {
    return new SystemMessage(plannerSystemPromptTemplate);
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return new HumanMessage('');
  }
}
