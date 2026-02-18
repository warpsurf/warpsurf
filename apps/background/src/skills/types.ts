/**
 * Site Skills - Type definitions
 */

export interface SiteSkill {
  /** Normalized domain (e.g., "amazon.com") */
  domain: string;
  /** Alternative domains that use the same skill */
  aliases?: string[];
  /** Human-readable name */
  title: string;
  /** Markdown content with site-specific guidance */
  content: string;
}

export interface ResolvedSkill {
  skill: SiteSkill | null;
  domain: string;
  matched: boolean;
}

export interface AggregatedSkills {
  skills: SiteSkill[];
  domains: string[];
  totalChars: number;
}
