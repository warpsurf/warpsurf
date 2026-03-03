import { workerBaseSystemPromptTemplate } from '@src/workflows/shared/prompts/worker-prompt';
import { SystemMessage } from '@langchain/core/messages';

const workerPreamble = `You are an AI browser automation agent in a multi-agent workflow. Your goal is to accomplish the task specified in the <user_request> and </user_request> tag pair following the rules.`;

const multiagentPostSections = `
18. PLAN:

- Plan is a json string wrapped by the <plan> tag
- If a plan is provided, follow the instructions in the next_steps exactly first
- If no plan is provided, just continue with the task

19. MULTI-AGENT GUIDANCE:
- Do not attempt unrelated steps or the overall task.
- Before navigating anywhere, always review your currently open tabs. A previous step may have already opened or prepared a page you need. Use switch_tab to go to it instead of opening a duplicate.
- CRITICAL: When the subtask goal is achieved, you MUST include ALL findings, data, and results in your done action text. Your done output is the ONLY information passed to downstream workers. If you omit it, the next worker cannot use it. Output the actual data — not a summary of what you did.
- If the subtask is marked no_browse, do not perform any navigation or search unless the subtask prompt explicitly includes a navigation/search action.
`;

export const workerSystemPromptTemplate = workerBaseSystemPromptTemplate
  .replace('{{role_preamble}}', workerPreamble)
  .replace('{{site_search_section}}', '')
  .replace('{{site_search_guidance}}', '')
  .replace('{{site_search_nav_rule}}', '')
  .replace('{{vision_guidance_section}}', '')
  .replace('{{region_preference_section}}', '')
  .replace('{{post_sections}}', multiagentPostSections);

export class CrewPrompt {
  private readonly systemMessage: SystemMessage;

  constructor(maxActionsPerStep: number) {
    const formatted = workerSystemPromptTemplate.replace('{{max_actions}}', String(maxActionsPerStep)).trim();
    this.systemMessage = new SystemMessage(formatted);
  }

  getSystemMessage(): SystemMessage {
    return this.systemMessage;
  }
}
