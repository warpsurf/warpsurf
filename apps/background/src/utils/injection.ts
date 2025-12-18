// Utilities for safely injecting helper scripts into tabs

export function canInjectScripts(url: string | undefined): boolean {
  if (!url) return false;

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
    'brave://',
  ];

  return !RESTRICTED_URLS.some(prefix => url.startsWith(prefix));
}

async function isScriptInjected(tabId: number): Promise<boolean> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Object.prototype.hasOwnProperty.call(window, 'buildDomTree'),
    });
    return results[0]?.result || false;
  } catch (err) {
    console.error('Failed to check script injection status:', err);
    return false;
  }
}

async function isPageExtractorsInjected(tabId: number): Promise<boolean> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const hasMarkdown = typeof (window as any).turn2Markdown === 'function';
        const hasReadability = typeof (window as any).parserReadability === 'function';
        return hasMarkdown && hasReadability;
      },
    });
    return !!results[0]?.result;
  } catch (err) {
    console.error('Failed to check pageExtractors injection status:', err);
    return false;
  }
}

export async function injectBuildDomTree(tabId: number, url: string | undefined): Promise<void> {
  try {
    if (!canInjectScripts(url)) return;

    // Ensure buildDomTree is present
    const hasBuild = await isScriptInjected(tabId);
    if (!hasBuild) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['buildDomTree.js'],
      });
    }

    // Ensure pageExtractors is present regardless of buildDomTree status
    const hasExtractors = await isPageExtractorsInjected(tabId);
    if (!hasExtractors) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['pageExtractors.js'],
        });
      } catch (e) {
        console.warn('Failed to inject pageExtractors.js:', e);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Cannot access')) {
      console.log(`Cannot inject script into restricted page: ${url}`);
    } else {
      console.error('Failed to inject scripts:', err);
    }
  }
}


