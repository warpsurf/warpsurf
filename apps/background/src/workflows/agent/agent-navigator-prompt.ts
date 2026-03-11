import {
  workerBaseSystemPromptTemplate,
  regionPreferenceGuidance,
  searchEngineGuidance,
  screenshotVisionGuidance,
  coordinateClickGuidance,
} from '@src/workflows/shared/prompts/worker-prompt';

export { regionPreferenceGuidance, searchEngineGuidance, screenshotVisionGuidance, coordinateClickGuidance };

const isLegacyNavigation = process.env.__LEGACY_NAVIGATION__ === 'true';

const siteSearchSection = isLegacyNavigation
  ? ''
  : `
## CRITICAL CRITICAL CRITICAL DIRECT SITE SEARCH - MANDATORY

**When navigating to a website to search for something, you MUST include the \`search_query\` parameter in your \`go_to_url\` action.**

Examples:
\`{"go_to_url": {"url": "walmart.com", "search_query": "coffee maker"}}\`
\`{"go_to_url": {"url": "target.com", "search_query": "running shoes"}}\`
\`{"go_to_url": {"url": "reddit.com", "search_query": "programming tips"}}\`
\`{"go_to_url": {"url": "stackoverflow.com", "search_query": "async await"}}\`
\`{"go_to_url": {"url": "imdb.com", "search_query": "christopher nolan"}}\`

**Do NOT:**
- Navigate to the homepage first, then use the search box
- Go to site.com without search_query, then click search, then type
- Open a site and manually interact with search elements

The \`search_query\` parameter takes you directly to search results in one step.

**Fallback (ONLY if search_query fails with captcha/block):**
1. Navigate to homepage WITHOUT search_query
2. Use the site's search box manually
3. Last resort: DuckDuckGo or Bing

`;

const siteSearchNavRule = isLegacyNavigation
  ? ''
  : `
- **SITE SEARCH**: When navigating to a site to search, ALWAYS use \`go_to_url\` with \`search_query\` parameter. Do NOT go to the homepage first and then use the search box manually.`;

const navigatorPreamble = `You are an AI agent designed to automate browser tasks. Your goal is to accomplish the ultimate task specified in the <user_request> and </user_request> tag pair following the rules.`;

const navigatorPostSections = `
18. PLAN TRACKING:

- Your current plan (if any) is shown in <browser_state> with status markers:
  [x] done, [>] current, [ ] pending, [-] skipped
- To advance the plan, include "current_plan_item": <index> in your top-level response
  (all steps before that index are automatically marked done)
- Focus on completing the current [>] step before advancing
- If the plan seems wrong or the situation has changed, the planner will revise it
`;

export const navigatorSystemPromptTemplate = workerBaseSystemPromptTemplate
  .replace('{{role_preamble}}', navigatorPreamble)
  .replace('{{site_search_section}}', siteSearchSection)
  .replace('{{site_search_guidance}}', '')
  .replace('{{site_search_nav_rule}}', siteSearchNavRule)
  .replace('{{post_sections}}', navigatorPostSections);
