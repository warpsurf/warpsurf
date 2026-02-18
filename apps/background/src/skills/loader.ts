/**
 * Site Skills - Loader
 *
 * Loads and caches site skills from bundled data.
 */

import type { SiteSkill } from './types';
import { BUNDLED_SKILLS } from './data/bundled-skills';

let skillCache: Map<string, SiteSkill> | null = null;

/** Get the skills database, indexed by domain. */
export function getSkillsDatabase(): Map<string, SiteSkill> {
  if (!skillCache) {
    skillCache = new Map();
    for (const skill of BUNDLED_SKILLS) {
      skillCache.set(skill.domain, skill);
      for (const alias of skill.aliases || []) {
        skillCache.set(alias, skill);
      }
    }
  }
  return skillCache;
}

/** Get skill for a normalized domain. */
export function getSkillForDomain(normalizedDomain: string): SiteSkill | undefined {
  return getSkillsDatabase().get(normalizedDomain);
}

/** Check if a skill exists for a domain. */
export function hasSkill(normalizedDomain: string): boolean {
  return getSkillsDatabase().has(normalizedDomain);
}
