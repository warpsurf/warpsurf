export * from './shared-types';
export * from './disclaimers';
export * from './result';
export * from './safe-operations';

function isInjectableUrl(url?: string | null): boolean {
  if (!url) return false;
  return /^https?:\/\//.test(url) || /^file:\/\//.test(url);
}

async function findInjectableTabId(preferredTabId?: number): Promise<number | null> {
  try {
    if (typeof preferredTabId === 'number') return preferredTabId;

    // 1) Try the active tab in the last focused window
    const [candidate] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (candidate?.id && isInjectableUrl(candidate.url)) return candidate.id;

    // 2) Try active tabs across all windows
    const actives = await chrome.tabs.query({ active: true });
    const activeHttp = actives.find(t => t.id && isInjectableUrl(t.url));
    if (activeHttp?.id) return activeHttp.id;

    // 3) Fallback to any http(s)/file tab
    const anyHttp = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file://*/*'] });
    const anyCandidate = anyHttp.find(t => t.id && isInjectableUrl(t.url));
    if (anyCandidate?.id) return anyCandidate.id;
  } catch {}
  return null;
}

export async function startPageFlash(targetTabId?: number): Promise<{ ok: boolean; message?: string }> {
  try {
    const tabId = await findInjectableTabId(targetTabId);
    if (!tabId) return { ok: false, message: 'No eligible tab found. Focus a webpage and try again.' };

    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const w = window as unknown as { __nanoFlash?: { el: HTMLDivElement | null; interval: number | null } };
        if (!w.__nanoFlash) w.__nanoFlash = { el: null, interval: null };
        const state = w.__nanoFlash;
        if (!state.el || !document.body.contains(state.el)) {
          const el = document.createElement('div');
          el.setAttribute('data-nano-flash', '');
          const style = el.style as CSSStyleDeclaration;
          style.position = 'fixed';
          style.top = '0';
          style.left = '0';
          style.right = '0';
          style.bottom = '0';
          style.pointerEvents = 'none';
          style.border = '4px solid #f59e0b';
          style.boxShadow = '0 0 0 9999px rgba(245,158,11,0.12) inset';
          style.zIndex = '2147483647';
          style.transition = 'opacity 200ms ease-in-out';
          style.opacity = '0.2';
          document.documentElement.appendChild(el);
          state.el = el;
        }
        if (state.interval) window.clearInterval(state.interval);
        state.interval = window.setInterval(() => {
          if (!state.el?.isConnected) return;
          state.el.style.opacity = state.el.style.opacity === '0.2' ? '0.65' : '0.2';
        }, 600);
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: 'Injection failed. Check site permissions and try again.' };
  }
}

export async function stopPageFlash(targetTabId?: number): Promise<{ ok: boolean; message?: string }> {
  try {
    const tabId = await findInjectableTabId(targetTabId);
    if (!tabId) return { ok: false, message: 'No eligible tab found.' };

    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const w = window as unknown as { __nanoFlash?: { el: HTMLDivElement | null; interval: number | null } };
        const state = w.__nanoFlash;
        if (!state) return;
        if (state.interval) {
          window.clearInterval(state.interval);
          state.interval = null;
        }
        if (state.el) {
          try { state.el.remove(); } catch {}
          state.el = null;
        }
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: 'Stop failed. Try again.' };
  }
}
