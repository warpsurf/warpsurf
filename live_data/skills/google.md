---
domain: google.com
aliases:
  - google.co.uk
  - google.de
  - google.fr
  - google.es
  - google.it
  - google.ca
  - google.com.au
  - google.co.jp
  - google.co.in
title: Google Search
---

# Google Search Navigation

## Search
- Main search input: `textarea[name="q"]`
- Search button: `input[name="btnK"]`
- "I'm Feeling Lucky": `input[name="btnI"]`

## Results Page
- Search results are in `#search` container
- Each result has `h3` for title, cite for URL
- Use extract_google_results action for structured data
- "People also ask" section is expandable

## Filtering
- Tools button reveals date/type filters
- Tabs: All, Images, Videos, News, Shopping, Maps
- Use `&tbs=qdr:d` for past 24 hours in URL

## Tips
- Add `site:example.com` to search within a site
- Use quotes for exact phrase matching
- Use `-term` to exclude results
