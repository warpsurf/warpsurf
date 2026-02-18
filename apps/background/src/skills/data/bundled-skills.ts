/**
 * Bundled site skills - Auto-generated
 *
 * Run: pnpm generate-skills
 * Generated: 2026-02-18T16:59:52.426Z
 * Total skills: 6
 */

import type { SiteSkill } from '../types';

export const BUNDLED_SKILLS: SiteSkill[] = [
  {
    domain: 'amazon.com',
    aliases: [
      'amazon.co.uk',
      'amazon.de',
      'amazon.fr',
      'amazon.es',
      'amazon.it',
      'amazon.ca',
      'amazon.com.au',
      'amazon.co.jp',
      'amazon.in',
    ],
    title: 'Amazon',
    content:
      '# Amazon Site Knowledge\n\n## Page Structure\n- Search results show price, rating, and Prime eligibility inline - no need to click into each product for basic info\n- Product pages have multiple seller options - scroll to "Other Sellers on Amazon" for alternatives\n- "Sponsored" labels indicate paid placements, not necessarily best matches\n\n## Common Gotchas\n- First result is often sponsored, not best match - check 2-3 results\n- "Currently unavailable" products still appear in search - check availability before clicking\n- Prices shown may be for used/renewed items - verify "New" vs "Used" in listing\n\n## Efficient Navigation\n- Left sidebar has brand, price range, and rating filters - faster than scrolling pages\n- "Sort by: Price Low to High" helps find deals quickly\n- Reviews summary at top of product page shows common praise/complaints',
  },
  {
    domain: 'github.com',
    title: 'GitHub',
    content:
      '# GitHub Navigation\n\n## Keyboard Shortcuts\n- Press `/` to focus search\n- Press `t` for file finder in repos\n- Press `g c` to go to Code tab\n- Press `g i` to go to Issues\n- Press `g p` to go to Pull Requests\n\n## Repository Navigation\n- Code tab shows files and README\n- Issues tab for bug reports and features\n- Pull requests tab for code reviews\n- Actions tab for CI/CD workflows\n\n## Search\n- Global search bar at top\n- Use `repo:owner/name` to scope search\n- Use `is:issue` or `is:pr` to filter type\n- Use `is:open` or `is:closed` for status\n\n## Common Actions\n- Fork button at top right of repo\n- Star button next to fork\n- Clone URL in green "Code" dropdown\n- New issue: Issues tab → "New issue" button\n- New PR: Pull requests tab → "New pull request"',
  },
  {
    domain: 'google.com',
    aliases: [
      'google.co.uk',
      'google.de',
      'google.fr',
      'google.es',
      'google.it',
      'google.ca',
      'google.com.au',
      'google.co.jp',
      'google.co.in',
    ],
    title: 'Google Search',
    content:
      '# Google Search Navigation\n\n## Search\n- Main search input: `textarea[name="q"]`\n- Search button: `input[name="btnK"]`\n- "I\'m Feeling Lucky": `input[name="btnI"]`\n\n## Results Page\n- Search results are in `#search` container\n- Each result has `h3` for title, cite for URL\n- Use extract_google_results action for structured data\n- "People also ask" section is expandable\n\n## Filtering\n- Tools button reveals date/type filters\n- Tabs: All, Images, Videos, News, Shopping, Maps\n- Use `&tbs=qdr:d` for past 24 hours in URL\n\n## Tips\n- Add `site:example.com` to search within a site\n- Use quotes for exact phrase matching\n- Use `-term` to exclude results',
  },
  {
    domain: 'linkedin.com',
    title: 'LinkedIn',
    content:
      '# LinkedIn Navigation\n\n## Search\n- Search bar at top: `.search-global-typeahead__input`\n- Filter by People, Jobs, Companies, Posts after search\n- Use search filters in left sidebar\n\n## Profile Navigation\n- Profile sections are collapsible cards\n- Experience, Education, Skills sections\n- "Connect" button to send connection request\n- "Message" button for InMail\n\n## Jobs\n- Jobs tab in main navigation\n- "Easy Apply" for quick applications\n- Save jobs with bookmark icon\n- Job alerts via bell icon\n\n## Feed\n- Home tab shows feed\n- Like, Comment, Repost buttons under posts\n- "Start a post" at top of feed\n\n## Tips\n- LinkedIn has aggressive rate limiting\n- Wait between rapid actions\n- Some features require login',
  },
  {
    domain: 'wikipedia.org',
    aliases: ['en.wikipedia.org', 'de.wikipedia.org', 'fr.wikipedia.org', 'es.wikipedia.org', 'ja.wikipedia.org'],
    title: 'Wikipedia',
    content:
      '# Wikipedia Navigation\n\n## Search\n- Search input: `#searchInput` or `#searchform input`\n- Search suggestions appear as you type\n- Press Enter to search or go to exact match\n\n## Article Structure\n- Table of contents at top (collapsible)\n- Infobox on right side with key facts\n- References at bottom\n- "See also" section for related articles\n\n## Navigation\n- Language links in sidebar for other languages\n- Categories at bottom of articles\n- Internal links are blue, external have icon\n\n## Tips\n- Use `/wiki/Article_Name` URL format\n- Underscores replace spaces in URLs\n- Mobile version at `en.m.wikipedia.org`',
  },
  {
    domain: 'youtube.com',
    aliases: ['youtu.be'],
    title: 'YouTube',
    content:
      '# YouTube Navigation\n\n## Search\n- Search input: `input#search`\n- Search button: `button#search-icon-legacy`\n- Voice search available via microphone icon\n\n## Video Player\n- Play/Pause: click video or press `k`\n- Fullscreen: `f` key or button\n- Mute: `m` key\n- Skip: `j` (back 10s), `l` (forward 10s)\n- Speed: Settings gear → Playback speed\n\n## Video Page\n- Subscribe button below video\n- Like/Dislike buttons\n- Share button for link\n- Description expandable below title\n- Comments section below description\n\n## Navigation\n- Home: YouTube logo or Home in sidebar\n- Subscriptions: sidebar menu\n- Library: sidebar for history, playlists\n- Shorts: vertical short-form videos\n\n## Tips\n- Add `&t=120` to URL to start at 2 minutes\n- Use `?v=VIDEO_ID` format for direct links',
  },
];
