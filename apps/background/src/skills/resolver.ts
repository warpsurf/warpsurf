/**
 * Site Skills - Resolver
 *
 * Resolves URLs to site skills using domain normalization.
 */

import { normalizeUrlForLookup } from '@src/utils/search-pattern-resolver';
import { getSkillForDomain } from './loader';
import type { ResolvedSkill, SiteSkill, AggregatedSkills } from './types';

/** Resolve skill for a single URL. */
export function resolveSkillForUrl(url: string): ResolvedSkill {
  const domain = normalizeUrlForLookup(url);
  const skill = getSkillForDomain(domain);
  return { skill: skill || null, domain, matched: !!skill };
}

/**
 * Resolve skills for multiple URLs, deduplicating by skill's primary domain.
 * Returns skills in URL order (first URL = highest priority).
 */
export function resolveSkillsForUrls(urls: string[]): AggregatedSkills {
  const seenSkillDomains = new Set<string>();
  const skills: SiteSkill[] = [];
  let totalChars = 0;

  for (const url of urls) {
    const domain = normalizeUrlForLookup(url);
    const skill = getSkillForDomain(domain);
    if (!skill) continue;

    // Deduplicate by skill's primary domain (handles aliases like amazon.com/amazon.co.uk)
    if (seenSkillDomains.has(skill.domain)) continue;

    seenSkillDomains.add(skill.domain);
    skills.push(skill);
    totalChars += skill.content.length;
  }

  return { skills, domains: Array.from(seenSkillDomains), totalChars };
}

/** Get URLs from tab IDs. */
export async function getUrlsFromTabIds(tabIds: number[]): Promise<string[]> {
  const urls: string[] = [];
  for (const tabId of tabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && /^https?:/i.test(tab.url)) {
        urls.push(tab.url);
      }
    } catch {
      // Tab may no longer exist
    }
  }
  return urls;
}
