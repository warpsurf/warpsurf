import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLogger } from '@src/log';
import { buildCompactionSystemPrompt } from './compaction-prompt';

type BaseChatModel = any;

const logger = createLogger('MessageCompactor');

/**
 * Call an LLM to summarize serialized agent history into a procedural memory.
 * Returns the summary string, or null if the call fails.
 */
export async function compactHistory(
  llm: BaseChatModel,
  serializedHistory: string,
  summaryMaxChars = 6000,
): Promise<string | null> {
  try {
    const response = await llm.invoke([
      new SystemMessage(buildCompactionSystemPrompt(summaryMaxChars)),
      new HumanMessage(serializedHistory),
    ]);
    let summary = String(response?.content ?? '').trim();
    if (!summary) return null;
    if (summary.length > summaryMaxChars) summary = summary.slice(0, summaryMaxChars) + '…';
    return summary;
  } catch (e) {
    logger.warning('Message compaction LLM call failed:', e);
    return null;
  }
}
