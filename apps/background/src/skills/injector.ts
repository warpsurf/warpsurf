/**
 * Site Skills - Injector
 *
 * Formats and injects site skills into agent context.
 */

import { SystemMessage } from '@langchain/core/messages';
import type { SiteSkill, AggregatedSkills } from './types';
import { resolveSkillsForUrls } from './resolver';

const MAX_TOTAL_CHARS = 8000;
const MAX_PER_SKILL_CHARS = 3000;

/** Format a single skill for injection. */
function formatSkill(skill: SiteSkill, maxChars: number): string {
  let content = skill.content;
  if (content.length > maxChars) {
    content = content.slice(0, maxChars) + '\n...[truncated]';
  }
  return `<site domain="${skill.domain}" title="${skill.title}">\n${content}\n</site>`;
}

/** Format multiple skills into a context block. */
export function formatSkillsBlock(aggregated: AggregatedSkills): string {
  if (aggregated.skills.length === 0) return '';

  let remaining = MAX_TOTAL_CHARS;
  const parts: string[] = [];

  for (const skill of aggregated.skills) {
    if (remaining <= 0) break;
    const limit = Math.min(MAX_PER_SKILL_CHARS, remaining);
    const formatted = formatSkill(skill, limit);
    parts.push(formatted);
    remaining -= formatted.length;
  }

  return `<site_skills>
The following site-specific knowledge is available for pages you may interact with.
Use this information to navigate more efficiently.

${parts.join('\n\n')}
</site_skills>`;
}

/** Build a SystemMessage containing site skills for the given URLs. */
export function buildSkillsSystemMessage(urls: string[]): SystemMessage | null {
  if (!urls.length) return null;

  const aggregated = resolveSkillsForUrls(urls);
  if (aggregated.skills.length === 0) return null;

  return new SystemMessage(formatSkillsBlock(aggregated));
}
