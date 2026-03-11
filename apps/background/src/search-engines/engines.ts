import type { SearchEngine } from './types';

export const SEARCH_ENGINES: Record<string, SearchEngine> = {
  google: {
    id: 'google',
    name: 'Google',
    searchUrlTemplate: 'https://www.google.com/search?q={q}',
    serpPattern: /google\.[^/]+\/search/i,
    resultSelectors: {
      containers: ['#search', 'body'],
      resultAnchors: ['a[href] h3', 'div.yuRUbf > a[href]', 'div.MjjYud a[href]', 'div.g a[href]'],
      titleSelector: 'h3',
    },
    nextPageParam: { name: 'start', increment: 10 },
  },
  duckduckgo: {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    searchUrlTemplate: 'https://duckduckgo.com/?q={q}',
    serpPattern: /duckduckgo\.com\/?\?/i,
    resultSelectors: {
      containers: ['body'],
      resultAnchors: ['article[data-testid="result"] a[data-testid="result-title-a"]', '.result__a'],
    },
    nextPageParam: undefined,
  },
  bing: {
    id: 'bing',
    name: 'Bing',
    searchUrlTemplate: 'https://www.bing.com/search?q={q}',
    serpPattern: /bing\.com\/search/i,
    resultSelectors: {
      containers: ['#b_results', 'body'],
      resultAnchors: ['li.b_algo h2 a', '.b_algo a'],
    },
    nextPageParam: { name: 'first', increment: 10 },
  },
  ecosia: {
    id: 'ecosia',
    name: 'Ecosia',
    searchUrlTemplate: 'https://www.ecosia.org/search?q={q}',
    serpPattern: /ecosia\.org\/search/i,
    resultSelectors: {
      containers: ['.mainline-results', 'body'],
      resultAnchors: ['.result__link', 'a.result-title'],
    },
    nextPageParam: { name: 'p', increment: 1 },
  },
  qwant: {
    id: 'qwant',
    name: 'Qwant',
    searchUrlTemplate: 'https://www.qwant.com/?q={q}',
    serpPattern: /qwant\.com\/\?/i,
    resultSelectors: {
      containers: ['[data-testid="webResults"]', 'body'],
      resultAnchors: ['[data-testid="webResult"] a', '.result__url'],
    },
    nextPageParam: { name: 'p', increment: 1 },
  },
  yahoo: {
    id: 'yahoo',
    name: 'Yahoo',
    searchUrlTemplate: 'https://search.yahoo.com/search?p={q}',
    serpPattern: /search\.yahoo\.com\/search/i,
    resultSelectors: {
      containers: ['#web', 'body'],
      resultAnchors: ['.algo-sr a', 'h3.title a'],
    },
    nextPageParam: { name: 'b', increment: 10 },
  },
  startpage: {
    id: 'startpage',
    name: 'Startpage',
    searchUrlTemplate: 'https://www.startpage.com/sp/search?query={q}',
    serpPattern: /startpage\.com\/sp\/search/i,
    resultSelectors: {
      containers: ['.mainline-results', 'body'],
      resultAnchors: ['.w-gl__result-title'],
    },
    nextPageParam: { name: 'page', increment: 1 },
  },
  brave: {
    id: 'brave',
    name: 'Brave Search',
    searchUrlTemplate: 'https://search.brave.com/search?q={q}',
    serpPattern: /search\.brave\.com\/search/i,
    resultSelectors: {
      containers: ['#results', 'body'],
      resultAnchors: ['.snippet a.result-header'],
    },
    nextPageParam: { name: 'offset', increment: 10 },
  },
};
