import type { Result } from './result';
import { success, failure } from './result';

export function safePostMessage(port: chrome.runtime.Port | null | undefined, message: any): boolean {
  if (!port?.name) {
    return false;
  }
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

export async function safeStorageGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? fallback;
  } catch {
    return fallback;
  }
}

export async function safeStorageSet(key: string, value: any): Promise<boolean> {
  try {
    await chrome.storage.local.set({ [key]: value });
    return true;
  } catch {
    return false;
  }
}

export async function safeStorageRemove(key: string): Promise<boolean> {
  try {
    await chrome.storage.local.remove(key);
    return true;
  } catch {
    return false;
  }
}

export async function safeTabUpdate(
  tabId: number,
  updateProperties: chrome.tabs.UpdateProperties,
): Promise<Result<chrome.tabs.Tab, Error>> {
  try {
    const tab = await chrome.tabs.update(tabId, updateProperties);
    if (!tab) {
      return failure(new Error('Tab update returned undefined'));
    }
    return success(tab);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function safeTabRemove(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.remove(tabId);
    return true;
  } catch {
    return false;
  }
}

export function safeClearInterval(intervalId: number | undefined): void {
  if (intervalId !== undefined) {
    try {
      clearInterval(intervalId);
    } catch {
      // Already cleared
    }
  }
}

export async function safeDebuggerDetach(target: chrome.debugger.Debuggee): Promise<boolean> {
  try {
    await chrome.debugger.detach(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDebuggerAttached(target: chrome.debugger.Debuggee): Promise<boolean> {
  try {
    await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: '1' });
    return true;
  } catch {
    return false;
  }
}

export async function safeTabsQuery(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  try {
    return await chrome.tabs.query(queryInfo);
  } catch {
    return [];
  }
}

export async function safeTabHighlight(
  highlightInfo: chrome.tabs.HighlightInfo,
): Promise<boolean> {
  try {
    await chrome.tabs.highlight(highlightInfo);
    return true;
  } catch {
    return false;
  }
}

