export interface SerpSelectors {
  containers: string[];
  resultAnchors: string[];
  titleSelector?: string;
}

export interface SearchEngine {
  id: string;
  name: string;
  searchUrlTemplate: string;
  serpPattern: RegExp;
  resultSelectors: SerpSelectors;
  nextPageParam?: { name: string; increment: number };
}
