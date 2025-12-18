import { createLogger } from '@src/log';
import { tabExists } from '@src/utils';
import type { BuildDomTreeArgs, RawDomTreeNode, RawDomElementNode, BuildDomTreeResult } from './raw_types';
// Types used for cross-frame stitching
export interface FrameInfo {
  frameId: number;
  computedHeight: number;
  computedWidth: number;
  href: string | null;
  name: string | null;
  title: string | null;
}

import { type DOMState, type DOMBaseNode, DOMElementNode, DOMTextNode } from './views';
import type { ViewportInfo } from './history/view';
import { isNewTabPage } from '../util';

const logger = createLogger('DOMService');

// Helper function to ensure pageExtractors script (parserReadability/turn2Markdown) is injected on the top frame
async function ensurePageExtractorsInjected(tabId: number): Promise<void> {
  try {
    // Get tab info to check URL
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url;

    // Check if URL allows script injection
    const RESTRICTED_URLS = [
      'chrome://',
      'chrome-extension://',
      'https://chromewebstore.google.com',
      'javascript:',
      'data:',
      'file:',
      'about:',
      'edge://',
      'opera://',
      'vivaldi://',
      'brave://'
    ];

    if (url && RESTRICTED_URLS.some(prefix => url.startsWith(prefix))) {
      throw new Error(`Cannot inject scripts into restricted URL: ${url}`);
    }

    // Check if helpers are already present
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const hasMarkdown = typeof (window as any).turn2Markdown === 'function';
        const hasReadability = typeof (window as any).parserReadability === 'function';
        return hasMarkdown && hasReadability;
      },
    });

    if (!results[0]?.result) {
      // Inject the helpers if not already present
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['pageExtractors.js'],
      });
      logger.debug('pageExtractors.js injected successfully');
    }
  } catch (err) {
    logger.error('Failed to inject pageExtractors script:', err);
    throw new Error(`Failed to inject page extractor script: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Helper function to ensure buildDomTree script is injected on the top frame
async function ensureBuildDomTreeInjected(tabId: number): Promise<void> {
  try {
    // Get tab info to check URL
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url;
    
    // Check if URL allows script injection
    const RESTRICTED_URLS = [
      'chrome://',
      'chrome-extension://',
      'https://chromewebstore.google.com',
      'javascript:',
      'data:',
      'file:',
      'about:',
      'edge://',
      'opera://',
      'vivaldi://',
      'brave://'
    ];
    
    if (url && RESTRICTED_URLS.some(prefix => url.startsWith(prefix))) {
      throw new Error(`Cannot inject scripts into restricted URL: ${url}`);
    }
    
    // Check if script is already injected
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Object.prototype.hasOwnProperty.call(window, 'buildDomTree'),
    });
    
    if (!results[0]?.result) {
      // Inject the script if not already present
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['buildDomTree.js'],
      });
      logger.debug('buildDomTree.js injected successfully');
    }
  } catch (err) {
    logger.error('Failed to inject buildDomTree script:', err);
    throw new Error(`Failed to inject DOM building script: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Function to check which frames already have the script injected
async function scriptInjectedFrames(tabId: number): Promise<Map<number, boolean>> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => Object.prototype.hasOwnProperty.call(window, 'buildDomTree'),
    });
    return new Map(results.map(result => [result.frameId, result.result || false]));
  } catch (err) {
    // Fall back gracefully if allFrames check fails (e.g., missing permissions)
    logger.warning('Failed to check script injection status across frames; falling back to top-frame only:', err);
    return new Map();
  }
}

// Exported function to inject buildDomTree into frames that need it
export async function injectBuildDomTreeScripts(tabId: number) {
  try {
    const injectedFrames = await scriptInjectedFrames(tabId);
    // If we couldn't enumerate frames, inject into top frame only
    if (injectedFrames.size === 0) {
      await ensureBuildDomTreeInjected(tabId);
      return;
    }

    // If all reported frames already injected, nothing to do
    if (Array.from(injectedFrames.values()).every(v => v)) {
      return;
    }

    const frameIdsToInject = Array.from(injectedFrames.keys()).filter(id => !injectedFrames.get(id));
    if (frameIdsToInject.length === 0) return;

    await chrome.scripting.executeScript({
      target: { tabId, frameIds: frameIdsToInject },
      files: ['buildDomTree.js'],
    });
  } catch (err) {
    logger.error('Failed to inject buildDomTree scripts:', err);
    // As a last resort, try top-frame injection so we at least have main frame
    try {
      await ensureBuildDomTreeInjected(tabId);
    } catch (e) {
      // Swallow to avoid crashing caller; _buildDomTree handles empty DOM fallback
    }
  }
}

export interface ReadabilityResult {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string;
  dir: string;
  siteName: string;
  lang: string;
  publishedTime: string;
}

declare global {
  interface Window {
    buildDomTree: (args: BuildDomTreeArgs) => RawDomTreeNode | null;
    turn2Markdown: (selector?: string) => string;
    parserReadability: () => ReadabilityResult | null;
  }
}

/**
 * Get the markdown content for the current page.
 * @param tabId - The ID of the tab to get the markdown content for.
 * @param selector - The selector to get the markdown content for. If not provided, the body of the entire page will be converted to markdown.
 * @returns The markdown content for the selected element on the current page.
 */
export async function getMarkdownContent(tabId: number, selector?: string): Promise<string> {
  // Ensure page extractors are available before attempting markdown extraction
  await ensurePageExtractorsInjected(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: sel => {
      return window.turn2Markdown(sel);
    },
    args: [selector || ''], // Pass the selector as an argument
  });

  const result = results[0]?.result;
  if (!result) {
    throw new Error('Failed to get markdown content');
  }
  return result as string;
}

/**
 * Get the readability content for the current page.
 * @param tabId - The ID of the tab to get the readability content for.
 * @returns The readability content for the current page.
 */
export async function getReadabilityContent(tabId: number): Promise<ReadabilityResult> {
  // Ensure page extractors are available before attempting readability extraction
  await ensurePageExtractorsInjected(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      return window.parserReadability();
    },
  });
  const result = results[0]?.result;
  if (!result) {
    throw new Error('Failed to get readability content');
  }
  return result as ReadabilityResult;
}

/**
 * Get the clickable elements for the current page.
 * @param tabId - The ID of the tab to get the clickable elements for.
 * @param url - The URL of the page.
 * @param showHighlightElements - Whether to show the highlight elements.
 * @param focusElement - The element to focus on.
 * @param viewportExpansion - The viewport expansion to use.
 * @returns A DOMState object containing the clickable elements for the current page.
 */
export async function getClickableElements(
  tabId: number,
  url: string,
  showHighlightElements = true,
  focusElement = -1,
  viewportExpansion = 0,
  debugMode = false,
): Promise<DOMState> {
  const [elementTree, selectorMap] = await _buildDomTree(
    tabId,
    url,
    showHighlightElements,
    focusElement,
    viewportExpansion,
    debugMode,
  );
  return { elementTree, selectorMap };
}

async function _buildDomTree(
  tabId: number,
  url: string,
  showHighlightElements = true,
  focusElement = -1,
  viewportExpansion = 0,
  debugMode = false,
): Promise<[DOMElementNode, Map<number, DOMElementNode>]> {
  // If URL is new tab or restricted, return a minimal DOM tree
  if (isNewTabPage(url) || url.startsWith('chrome://')) {
    const elementTree = new DOMElementNode({
      tagName: 'body',
      xpath: '',
      attributes: {},
      children: [],
      isVisible: false,
      isInteractive: false,
      isTopElement: false,
      isInViewport: false,
      parent: null,
    });
    return [elementTree, new Map<number, DOMElementNode>()];
  }

  // Ensure buildDomTree script is injected before using it (prefer all-frames injection)
  await injectBuildDomTreeScripts(tabId);
  
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: args => {
        // Check if buildDomTree exists before calling it
        if (typeof window.buildDomTree !== 'function') {
          return { error: 'buildDomTree function not found in page context' };
        }
        try {
          const result = window.buildDomTree(args);
          // Ensure result has the expected structure
          if (!result || typeof result !== 'object') {
            return { error: 'buildDomTree returned invalid result' };
          }
          return result;
        } catch (e) {
          return { error: `buildDomTree execution failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
      args: [
        {
          showHighlightElements,
          focusHighlightIndex: focusElement,
          viewportExpansion,
          debugMode,
        },
      ],
    });
  } catch (err) {
    logger.error('Failed to execute script:', err);
    // If the error is about the tab not existing or being closed, return empty DOM
    if (err instanceof Error && (err.message.includes('No tab with id') || err.message.includes('Cannot access'))) {
      logger.debug('Tab no longer exists or is inaccessible, returning empty DOM tree');
      const elementTree = new DOMElementNode({
        tagName: 'body',
        xpath: '',
        attributes: {},
        children: [],
        isVisible: false,
        isInteractive: false,
        isTopElement: false,
        isInViewport: false,
        parent: null,
      });
      return [elementTree, new Map<number, DOMElementNode>()];
    }
    throw new Error(`Failed to execute DOM building script: ${err instanceof Error ? err.message : String(err)}`);
  }

  // First cast to unknown, then to BuildDomTreeResult
  let evalPage = results[0]?.result as unknown as BuildDomTreeResult;
  
  // Check for error response
  if (evalPage && typeof evalPage === 'object' && 'error' in evalPage) {
    throw new Error(`Failed to build DOM tree: ${evalPage.error}`);
  }
  
  if (!evalPage || !evalPage.map || !evalPage.rootId) {
    throw new Error('Failed to build DOM tree: No result returned or invalid structure');
  }

  // Log performance metrics in debug mode
  if (debugMode && evalPage.perfMetrics) {
    logger.debug('DOM Tree Building Performance Metrics:', evalPage.perfMetrics);
  }

  // Attempt to build DOM trees for visible iframes that failed to load in main frame, then stitch
  try {
    const visibleIframesFailedLoading = _visibleIFramesFailedLoading(evalPage);
    const visibleIframesFailedLoadingCount = Object.values(visibleIframesFailedLoading).length;
    if (visibleIframesFailedLoadingCount > 0) {
      // Requires webNavigation permission; wrap in try/catch to avoid breaking without permission
      const tabFrames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => undefined);
      if (tabFrames && Array.isArray(tabFrames)) {
        const subFrames = (tabFrames ?? []).filter(frame => frame.frameId !== results[0].frameId).sort();

        // Obtain frame info for subframes
        const frameInfoResultsRaw = await Promise.all(
          subFrames.map(async frame => {
            try {
              const r = await chrome.scripting.executeScript({
                target: { tabId, frameIds: [frame.frameId] },
                func: frameId => ({
                  frameId,
                  computedHeight: window.innerHeight,
                  computedWidth: window.innerWidth,
                  href: window.location.href,
                  name: window.name,
                  title: document.title,
                }),
                args: [frame.frameId],
              });
              return r[0]?.result;
            } catch {
              return null;
            }
          }),
        );
        const frameInfoResults = frameInfoResultsRaw.filter(Boolean) as FrameInfo[];

        const frameTreeResult = await constructFrameTree(
          tabId,
          showHighlightElements,
          focusElement,
          viewportExpansion,
          debugMode,
          evalPage,
          frameInfoResults,
          _getMaxID(evalPage),
          _getMaxHighlightIndex(evalPage),
        );
        evalPage = frameTreeResult.resultPage;
      }
    }
  } catch (e) {
    // Non-fatal; proceed with main frame only
    logger.debug('Cross-frame DOM stitching skipped or failed:', e);
  }

  return _constructDomTree(evalPage);
}

/**
 * Constructs a DOM tree from the evaluated page data.
 * @param evalPage - The result of building the DOM tree.
 * @returns A tuple containing the DOM element tree and selector map.
 */
function _constructDomTree(evalPage: BuildDomTreeResult): [DOMElementNode, Map<number, DOMElementNode>] {
  const jsNodeMap = evalPage.map;
  const jsRootId = evalPage.rootId;

  const selectorMap = new Map<number, DOMElementNode>();
  const nodeMap: Record<string, DOMBaseNode> = {};

  // First pass: create all nodes
  for (const [id, nodeData] of Object.entries(jsNodeMap)) {
    const [node] = _parse_node(nodeData);
    if (node === null) {
      continue;
    }

    nodeMap[id] = node;

    // Add to selector map if it has a highlight index
    if (node instanceof DOMElementNode && node.highlightIndex !== undefined && node.highlightIndex !== null) {
      selectorMap.set(node.highlightIndex, node);
    }
  }

  // Second pass: build the tree structure
  for (const [id, node] of Object.entries(nodeMap)) {
    if (node instanceof DOMElementNode) {
      const nodeData = jsNodeMap[id];
      const childrenIds = 'children' in nodeData ? nodeData.children : [];

      for (const childId of childrenIds) {
        if (!(childId in nodeMap)) {
          continue;
        }

        const childNode = nodeMap[childId];

        childNode.parent = node;
        node.children.push(childNode);
      }
    }
  }

  const htmlToDict = nodeMap[jsRootId];

  if (htmlToDict === undefined || !(htmlToDict instanceof DOMElementNode)) {
    throw new Error('Failed to parse HTML to dictionary');
  }

  return [htmlToDict, selectorMap];
}

/**
 * Parse a raw DOM node and return the node object and its children IDs.
 * @param nodeData - The raw DOM node data to parse.
 * @returns A tuple containing the parsed node and an array of child IDs.
 */
export function _parse_node(nodeData: RawDomTreeNode): [DOMBaseNode | null, string[]] {
  if (!nodeData) {
    return [null, []];
  }

  // Process text nodes immediately
  if ('type' in nodeData && nodeData.type === 'TEXT_NODE') {
    const textNode = new DOMTextNode(nodeData.text, nodeData.isVisible, null);
    return [textNode, []];
  }

  // At this point, nodeData is RawDomElementNode (not a text node)
  // TypeScript needs help to narrow the type
  const elementData = nodeData as Exclude<RawDomTreeNode, { type: string }>;

  // Process viewport info if it exists
  let viewportInfo: ViewportInfo | undefined = undefined;
  if ('viewport' in nodeData && typeof nodeData.viewport === 'object' && nodeData.viewport) {
    const viewportObj = nodeData.viewport as { width: number; height: number };
    viewportInfo = {
      width: viewportObj.width,
      height: viewportObj.height,
      scrollX: 0,
      scrollY: 0,
    };
  }

  const elementNode = new DOMElementNode({
    tagName: elementData.tagName,
    xpath: elementData.xpath,
    attributes: elementData.attributes ?? {},
    children: [],
    isVisible: elementData.isVisible ?? false,
    isInteractive: elementData.isInteractive ?? false,
    isTopElement: elementData.isTopElement ?? false,
    isInViewport: elementData.isInViewport ?? false,
    highlightIndex: elementData.highlightIndex ?? null,
    shadowRoot: elementData.shadowRoot ?? false,
    parent: null,
    viewportInfo: viewportInfo,
  });

  const childrenIds = elementData.children || [];

  return [elementNode, childrenIds];
}

// ---------------- Cross-frame helpers (visible iframe stitching) ----------------

function _getMaxHighlightIndex(result: BuildDomTreeResult, priorMaxHighlightIndex?: number): number {
  return Math.max(
    priorMaxHighlightIndex ?? -1,
    ...Object.values(_getRawDomTreeNodes(result))
      .filter(node => (node as RawDomElementNode).highlightIndex != null)
      .map(node => ((node as RawDomElementNode).highlightIndex ?? -1)),
  );
}

function _getMaxID(result: BuildDomTreeResult, priorMaxId?: number): number {
  return Math.max(priorMaxId ?? -1, parseInt(result.rootId));
}

function _getMaxNodeIdInMap(result: BuildDomTreeResult): number {
  const ids = Object.keys(result.map)
    .map(k => parseInt(k))
    .filter(n => !Number.isNaN(n));
  return ids.length > 0 ? Math.max(...ids) : -1;
}

function _getRawDomTreeNodes(result: BuildDomTreeResult, tagName?: string): Record<string, RawDomElementNode> {
  const nodes: Record<string, RawDomElementNode> = {};
  for (const [id, nodeData] of Object.entries(result.map)) {
    if (!nodeData || ('type' in (nodeData as any) && (nodeData as any).type === 'TEXT_NODE')) {
      continue;
    }
    const elementData = nodeData as RawDomElementNode;
    if (tagName != null) {
      if (!elementData.tagName || elementData.tagName !== tagName) continue;
    }
    nodes[id] = elementData;
  }
  return nodes;
}

function _visibleIFramesFailedLoading(result: BuildDomTreeResult): Record<string, RawDomElementNode> {
  const iframeNodes = _getRawDomTreeNodes(result, 'iframe');
  return Object.fromEntries(
    Object.entries(iframeNodes).filter(([, iframeNode]) => {
      const error = iframeNode.attributes['error'];
      const height = parseInt(iframeNode.attributes['computedHeight']);
      const width = parseInt(iframeNode.attributes['computedWidth']);
      return error != null && height > 0 && width > 0;
    }),
  );
}

function _locateMatchingIframeNode(
  iframeNodes: Record<string, RawDomElementNode>,
  frameInfo: FrameInfo,
  strictComparison: boolean = true,
): RawDomElementNode | undefined {
  const result = Object.values(iframeNodes).find(iframeNode => {
    const frameHeight = parseInt(iframeNode.attributes['computedHeight']);
    const frameWidth = parseInt(iframeNode.attributes['computedWidth']);
    const frameName = iframeNode.attributes['name'];
    const frameUrl = iframeNode.attributes['src'];
    const frameTitle = iframeNode.attributes['title'];
    let heightMatch = false;
    let widthMatch = false;
    const nameMatch = !frameName || !frameInfo.name || frameInfo.name === frameName;
    let urlMatch: boolean;
    let titleMatch: boolean;
    if (strictComparison) {
      heightMatch = frameInfo.computedHeight === frameHeight;
      widthMatch = frameInfo.computedWidth === frameWidth;
      urlMatch = !frameUrl || !frameInfo.href || frameInfo.href === frameUrl;
      titleMatch = !frameTitle || !frameInfo.title || frameInfo.title === frameTitle;
    } else {
      const heightDifference = Math.abs(frameInfo.computedHeight - frameHeight);
      heightMatch = heightDifference < 10 || heightDifference / Math.max(frameInfo.computedHeight, frameHeight, 1) < 0.1;
      const widthDifference = Math.abs(frameInfo.computedWidth - frameWidth);
      widthMatch = widthDifference < 10 || widthDifference / Math.max(frameInfo.computedWidth, frameWidth, 1) < 0.1;
      urlMatch = true;
      titleMatch = true;
    }
    return heightMatch && widthMatch && nameMatch && urlMatch && titleMatch;
  });
  if (result == null && strictComparison) {
    return _locateMatchingIframeNode(iframeNodes, frameInfo, false);
  }
  return result;
}

async function constructFrameTree(
  tabId: number,
  showHighlightElements: boolean,
  focusElement: number,
  viewportExpansion: number,
  debugMode: boolean,
  parentFramePage: BuildDomTreeResult,
  allFramesInfo: FrameInfo[],
  startingNodeId: number,
  startingHighlightIndex: number,
): Promise<{ maxNodeId: number; maxHighlightIndex: number; resultPage: BuildDomTreeResult }> {
  const parentIframesFailedLoading = _visibleIFramesFailedLoading(parentFramePage);
  const failedLoadingFrames = allFramesInfo.filter(frameInfo => {
    return _locateMatchingIframeNode(parentIframesFailedLoading, frameInfo) != null;
  });

  let maxNodeId = startingNodeId;
  let maxHighlightIndex = startingHighlightIndex;

  for (const subFrame of failedLoadingFrames) {
    // Evaluate only on the specific subframe id, and continue numbering ids/highlights
    const subFrameResult = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [subFrame.frameId] },
      func: args => {
        // Access buildDomTree from the window context of the target page
        // @ts-ignore
        return window.buildDomTree({ ...args });
      },
      args: [
        {
          showHighlightElements,
          focusHighlightIndex: focusElement,
          viewportExpansion,
          startId: maxNodeId + 1,
          startHighlightIndex: maxHighlightIndex + 1,
          debugMode,
        },
      ],
    });

    let subFramePage = subFrameResult[0]?.result as unknown as BuildDomTreeResult;
    if (!subFramePage || !subFramePage.map || !subFramePage.rootId) {
      continue;
    }
    if (debugMode && (subFramePage as any).perfMetrics) {
      logger.debug('DOM Tree Building Performance Metrics (sub-frame' + subFrameResult[0].frameId + '):', (subFramePage as any).perfMetrics);
    }

    // Remap IDs and highlight indices to avoid collisions with parent
    const idOffset = Math.max(maxNodeId, _getMaxNodeIdInMap(parentFramePage)) + 1;
    const highlightOffset = Math.max(maxHighlightIndex, _getMaxHighlightIndex(parentFramePage)) + 1;
    subFramePage = _remapFrameResultIdsAndHighlights(subFramePage, idOffset, highlightOffset);

    maxNodeId = Math.max(maxNodeId, _getMaxNodeIdInMap(subFramePage));
    maxHighlightIndex = Math.max(maxHighlightIndex, _getMaxHighlightIndex(subFramePage));

    // Merge lookup maps
    parentFramePage.map = {
      ...parentFramePage.map,
      ...subFramePage.map,
    };

    const iframeNode = _locateMatchingIframeNode(parentIframesFailedLoading, subFrame);
    if (!iframeNode) {
      continue;
    }

    // Attach subframe root to iframe node children
    (iframeNode.children as any).push(subFramePage.rootId);

    // Recursively process nested iframes
    const childrenIframesFailedLoading = _visibleIFramesFailedLoading(subFramePage);
    if (Object.keys(childrenIframesFailedLoading).length > 0) {
      const result = await constructFrameTree(
        tabId,
        showHighlightElements,
        focusElement,
        viewportExpansion,
        debugMode,
        subFramePage,
        allFramesInfo,
        maxNodeId,
        maxHighlightIndex,
      );
      maxNodeId = Math.max(maxNodeId, result.maxNodeId);
      maxHighlightIndex = Math.max(maxHighlightIndex, result.maxHighlightIndex);
    }
  }

  return { maxNodeId, maxHighlightIndex, resultPage: parentFramePage };
}

function _remapFrameResultIdsAndHighlights(
  framePage: BuildDomTreeResult,
  idOffset: number,
  highlightOffset: number,
): BuildDomTreeResult {
  const idMap = new Map<string, string>();
  // Build id mapping
  for (const oldId of Object.keys(framePage.map)) {
    const numeric = parseInt(oldId);
    const newId = Number.isNaN(numeric) ? `${oldId}_${idOffset}` : String(numeric + idOffset);
    idMap.set(oldId, newId);
  }

  // Remap nodes
  const newMap: Record<string, RawDomTreeNode> = {} as any;
  for (const [oldId, nodeData] of Object.entries(framePage.map)) {
    const newId = idMap.get(oldId)!;
    if ('type' in (nodeData as any) && (nodeData as any).type === 'TEXT_NODE') {
      newMap[newId] = { ...(nodeData as any) };
      continue;
    }
    const elementData = nodeData as RawDomElementNode;
    const remappedChildren = (elementData.children || []).map(cid => idMap.get(cid) || cid);
    const remappedNode: RawDomElementNode = {
      ...elementData,
      children: remappedChildren,
      highlightIndex:
        elementData.highlightIndex != null ? (elementData.highlightIndex as number) + highlightOffset : elementData.highlightIndex,
    };
    newMap[newId] = remappedNode as unknown as RawDomTreeNode;
  }

  const newRootId = idMap.get(framePage.rootId) || framePage.rootId;
  return { rootId: newRootId, map: newMap, perfMetrics: framePage.perfMetrics };
}

export async function removeHighlights(tabId: number): Promise<void> {
  try {
    if (!await tabExists(tabId)) return; // Tab closed, nothing to remove
    
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        // Remove the highlight container and all its contents
        const container = document.getElementById('playwright-highlight-container');
        if (container) {
          container.remove();
        }

        // Remove highlight attributes from elements
        const highlightedElements = document.querySelectorAll('[browser-user-highlight-id^="playwright-highlight-"]');
        for (const el of Array.from(highlightedElements)) {
          el.removeAttribute('browser-user-highlight-id');
        }
      },
    });
  } catch (error: any) {
    // Only log as error if it's not a tab-not-found issue
    const msg = String(error?.message || '');
    if (msg.includes('No tab with') || msg.includes('Invalid tab') || msg.includes('Cannot access')) {
      logger.debug(`removeHighlights: Tab ${tabId} inaccessible, skipping`);
    } else {
      logger.error('Failed to remove highlights:', error);
    }
  }
}

/**
 * Get the scroll information for the current page.
 * @param tabId - The ID of the tab to get the scroll information for.
 * @returns A tuple containing the number of pixels above and below the current scroll position.
 */
// export async function getScrollInfo(tabId: number): Promise<[number, number]> {
//   const results = await chrome.scripting.executeScript({
//     target: { tabId: tabId },
//     func: () => {
//       const scroll_y = window.scrollY;
//       const viewport_height = window.innerHeight;
//       const total_height = document.documentElement.scrollHeight;
//       return {
//         pixels_above: scroll_y,
//         pixels_below: total_height - (scroll_y + viewport_height),
//       };
//     },
//   });

//   const result = results[0]?.result;
//   if (!result) {
//     throw new Error('Failed to get scroll information');
//   }
//   return [result.pixels_above, result.pixels_below];
// }

export async function getScrollInfo(tabId: number): Promise<[number, number, number]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      const scrollY = window.scrollY;
      const visualViewportHeight = window.visualViewport?.height || window.innerHeight;
      const scrollHeight = document.body.scrollHeight;
      return {
        scrollY: scrollY,
        visualViewportHeight: visualViewportHeight,
        scrollHeight: scrollHeight,
      };
    },
  });

  const result = results[0]?.result;
  if (!result) {
    throw new Error('Failed to get scroll information');
  }
  return [result.scrollY, result.visualViewportHeight, result.scrollHeight];
}
