import { jsonrepair } from 'jsonrepair';
import { createLogger } from '@src/log';

const logger = createLogger('Utils');

/**
 * Fix malformed action string using the jsonrepair library
 * Only called when initial JSON.parse fails
 */
export function repairJsonString(actionString: string): string {
  try {
    // Use jsonrepair to fix malformed JSON
    const repairedJson = jsonrepair(actionString.trim());
    logger.info('Successfully repaired JSON string', { original: actionString, repaired: repairedJson });
    return repairedJson;
  } catch (error) {
    // If jsonrepair fails, log the error and return the original string
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warning('jsonrepair failed to fix JSON string', { original: actionString, error: errorMessage });
    return actionString.trim();
  }
}

