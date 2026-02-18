/**
 * Site Skills - Main exports
 *
 * Provides site-specific knowledge to help agents navigate efficiently.
 */

import { generalSettingsStore } from '@extension/storage';

// Build-time flag: default ON unless explicitly disabled
const SKILLS_AVAILABLE = process.env.__ENABLE_SITE_SKILLS__ !== 'false';

/** Check if site skills should be injected (build + runtime). */
export async function shouldInjectSkills(): Promise<boolean> {
  if (!SKILLS_AVAILABLE) return false;
  const settings = await generalSettingsStore.getSettings();
  return settings.enableSiteSkills !== false;
}

/** Synchronous check for build-time availability only. */
export function isSkillsAvailable(): boolean {
  return SKILLS_AVAILABLE;
}

// Re-export types and functions
export type { SiteSkill, ResolvedSkill, AggregatedSkills } from './types';
export { getSkillForDomain, hasSkill } from './loader';
export { resolveSkillForUrl, resolveSkillsForUrls, getUrlsFromTabIds } from './resolver';
export { buildSkillsSystemMessage, formatSkillsBlock } from './injector';
