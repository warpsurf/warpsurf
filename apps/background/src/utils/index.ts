// Re-export all utilities
export { repairJsonString } from './json';
export { convertZodToJsonSchema } from './schema';
export { getCurrentTimestampStr } from './time';

/** Check if a tab exists. Returns the tab or null. */
export const tabExists = (tabId: number) => 
  chrome.tabs.get(tabId).catch(() => null);
