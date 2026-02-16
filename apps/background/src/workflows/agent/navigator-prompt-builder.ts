/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from '@src/workflows/shared/prompts/base-prompt';
import { type HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '../shared/agent-types';
import { navigatorSystemPromptTemplate, regionPreferenceGuidance } from './agent-navigator-prompt';

export class NavigatorPrompt extends BasePrompt {
  private systemMessage: SystemMessage;

  constructor(
    private readonly maxActionsPerStep = 10,
    private readonly preferredRegion?: string,
  ) {
    super();

    const promptTemplate = navigatorSystemPromptTemplate;

    // Build the region preference section if a region is set
    let regionSection = '';
    if (this.preferredRegion) {
      regionSection = regionPreferenceGuidance.replace('{{preferred_region}}', this.preferredRegion);
    }

    // Format the template with the maxActionsPerStep and region preference
    const formattedPrompt = promptTemplate
      .replace('{{max_actions}}', this.maxActionsPerStep.toString())
      .replace('{{region_preference_section}}', regionSection)
      .trim();
    this.systemMessage = new SystemMessage(formattedPrompt);
  }

  getSystemMessage(): SystemMessage {
    /**
     * Get the system prompt for the agent.
     *
     * @returns SystemMessage containing the formatted system prompt
     */
    return this.systemMessage;
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return await this.buildBrowserStateUserMessage(context);
  }
}
