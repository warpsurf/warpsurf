/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from '@src/workflows/shared/prompts/base-prompt';
import { type HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext, VisionMode } from '../shared/agent-types';
import {
  navigatorSystemPromptTemplate,
  regionPreferenceGuidance,
  screenshotVisionGuidance,
  coordinateClickGuidance,
} from './agent-navigator-prompt';

export class NavigatorPrompt extends BasePrompt {
  private systemMessage: SystemMessage;

  constructor(
    private readonly maxActionsPerStep = 10,
    private readonly preferredRegion?: string,
    private readonly useVision: VisionMode = 'auto',
    private readonly enableCoordinateClick = false,
  ) {
    super();

    const promptTemplate = navigatorSystemPromptTemplate;

    let regionSection = '';
    if (this.preferredRegion) {
      regionSection = regionPreferenceGuidance.replace('{{preferred_region}}', this.preferredRegion);
    }

    let visionSection = '';
    if (this.useVision === 'auto') {
      visionSection = screenshotVisionGuidance;
      if (this.enableCoordinateClick) {
        visionSection += coordinateClickGuidance;
      }
    }

    const formattedPrompt = promptTemplate
      .replace('{{max_actions}}', this.maxActionsPerStep.toString())
      .replace('{{region_preference_section}}', regionSection)
      .replace('{{vision_guidance_section}}', visionSection)
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
