import {
  workerBaseSystemPromptTemplate,
  siteSearchSection,
  siteSearchNavRule,
  regionPreferenceGuidance,
  searchEngineGuidance,
  screenshotVisionGuidance,
  coordinateClickGuidance,
} from '@src/workflows/shared/prompts/worker-prompt';
import { getSearchEngine, buildSearchUrl } from '@src/search-engines';
import { SystemMessage } from '@langchain/core/messages';
import type { VisionMode } from '@src/workflows/shared/agent-types';

const workerPreamble = `You are an AI browser automation agent in a multi-agent workflow. Your goal is to accomplish the task specified in the <user_request> and </user_request> tag pair following the rules.`;

const multiagentPostSections = `
18. MULTI-AGENT WORKFLOW:

- If a plan is provided (json wrapped by the <plan> tag), follow the instructions in the next_steps exactly first. If no plan is provided, just continue with the task.
- Do not attempt unrelated steps or the overall task.
- Before navigating anywhere, always review your currently open tabs. A previous step may have already opened or prepared a page you need. Use switch_tab to go to it instead of opening a duplicate.
- CRITICAL: When the subtask goal is achieved, you MUST include ALL findings, data, and results in your done action text. Your done output is the ONLY information passed to downstream workers. If you omit it, the next worker cannot use it. Output the actual data — not a summary of what you did.
- If the subtask is marked no_browse, do not perform any navigation or search unless the subtask prompt explicitly includes a navigation/search action.
`;

export const workerSystemPromptTemplate = workerBaseSystemPromptTemplate
  .replace('{{role_preamble}}', workerPreamble)
  .replace('{{site_search_section}}', siteSearchSection)
  .replace('{{site_search_guidance}}', '')
  .replace('{{site_search_nav_rule}}', siteSearchNavRule)
  .replace('{{post_sections}}', multiagentPostSections);

export class CrewPrompt {
  private readonly systemMessage: SystemMessage;

  constructor(
    maxActionsPerStep: number,
    preferredRegion?: string,
    useVision: VisionMode = 'auto',
    enableCoordinateClick = false,
    defaultSearchEngine?: string,
  ) {
    let regionSection = '';
    if (preferredRegion) {
      regionSection = regionPreferenceGuidance.replace('{{preferred_region}}', preferredRegion);
    }

    const engine = getSearchEngine(defaultSearchEngine ?? 'google');
    const exampleUrl = buildSearchUrl(engine, 'your search terms');
    const searchSection = searchEngineGuidance
      .replace('{{search_engine_name}}', engine.name)
      .replace('{{search_engine_url_example}}', exampleUrl);

    let visionSection = '';
    if (useVision === 'auto') {
      visionSection = screenshotVisionGuidance;
      if (enableCoordinateClick) {
        visionSection += coordinateClickGuidance;
      }
    }

    const formatted = workerSystemPromptTemplate
      .replace('{{max_actions}}', String(maxActionsPerStep))
      .replace('{{region_preference_section}}', regionSection)
      .replace('{{search_engine_section}}', searchSection)
      .replace('{{vision_guidance_section}}', visionSection)
      .trim();
    this.systemMessage = new SystemMessage(formatted);
  }

  getSystemMessage(): SystemMessage {
    return this.systemMessage;
  }
}
