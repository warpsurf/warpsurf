import { createChatModel } from '@src/workflows/models/factory';
import { agentModelStore, AgentNameEnum } from '@extension/storage';
import { getAllProvidersDecrypted } from '@src/crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { createLogger } from '@src/log';

const logger = createLogger('TriageTabChoice');

/**
 * Decide whether the agent should use the current tab based on the user's request.
 * Returns true when the task clearly refers to the currently visible page/tab (e.g., "on this page", "this tab", "fill the form here").
 * Defaults to false (prefer new tab) on uncertainty or failures.
 */
export async function decideUseCurrentTab(userQuery: string): Promise<boolean> {

  return false;

  // returning false by default until read_current_tab is implemented
  try {
    const providers = await getAllProvidersDecrypted();
    if (Object.keys(providers).length === 0) {
      logger.warning('[useCurrentTab] No providers configured, defaulting to false');
      return false;
    }

    const agentModels = await agentModelStore.getAllAgentModels();
    // Prefer dedicated Auto model, fallback to AgentPlanner
    const triageModel = agentModels[AgentNameEnum.Auto] || agentModels[AgentNameEnum.AgentPlanner];
    if (!triageModel) {
      logger.warning('[useCurrentTab] No triage/planner model configured, defaulting to false');
      return false;
    }

    const providerCfg = providers[triageModel.provider];
    if (!providerCfg) {
      logger.warning('[useCurrentTab] Provider config missing for triage/planner model, defaulting to false');
      return false;
    }

    const llm: BaseChatModel = createChatModel(providerCfg, triageModel);

    const system = [
      'You are a helpful assistant that performs a small triage role in a chrome extension.',
      'Your job is to decide if the user query below requires operating in the currently visible browser tab.',
      'In almost every single case, you should return {false}, this instructs the browser agent to open or work in a new tab. This is the default behavior.',
      'Please only return {true} if the user clearly and explicitly indicates they want to operate on the page or tab that is currently showing',
      'If you are unsure, you should always return {false}.',
    ].join('\n');

    const user = [
      'User query:',
      userQuery,
      '',
      'Respond with just "{true}" or "{false}"',
    ].join('\n');

    const res = await llm.invoke([
      new SystemMessage(system),
      new HumanMessage(user),
    ] as any);

    const text = typeof (res as any)?.content === 'string'
      ? (res as any).content
      : JSON.stringify((res as any)?.content ?? '');

    // First try to parse simple boolean outputs like "{true}", "true", "{ false }"
    try {
      const simple = text.match(/\{?\s*(true|false)\s*\}?/i);
      if (simple && simple[1]) {
        const val = String(simple[1]).toLowerCase() === 'true';
        logger.info(`[useCurrentTab] Simple boolean parsed: ${val}`);
        return val;
      }
    } catch {}

    // Fallback: Extract first JSON object and check for useCurrentTab property
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const val = !!parsed?.useCurrentTab;
        logger.info(`[useCurrentTab] JSON parsed (useCurrentTab): ${val}`);
        return val;
      }
    } catch {
      logger.warning('[useCurrentTab] Failed to parse JSON object; defaulting to false');
    }
  } catch (e) {
    logger.warning('[useCurrentTab] Error during decision, defaulting to false', e);
  }
  return false;
}

