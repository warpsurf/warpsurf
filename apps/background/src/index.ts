import 'webextension-polyfill';
import BrowserContext from './browser/context';
import { Executor } from './executor/executor';
import { createLogger } from './log';
import { TaskManager } from './task/task-manager';
import { MultiAgentWorkflow } from './workflows/multiagent/multiagent-workflow';

import { handleTestProviderMessage } from './workflows/models/provider-test';
import {
  closeTaskTabs as closeTaskTabsFn,
  closeTaskGroup as closeTaskGroupFn,
  closeAllTabsForSession as closeAllTabsForSessionFn,
} from './tabs/cleanup';
import { attachRuntimeListeners } from './listeners/runtime';
import { initInstrumentation } from './init/instrumentation';
import { attachSidePanelPortHandlers } from './ports/side-panel';
import { attachDashboardPortHandlers } from './ports/dashboard';
import { attachAgentManagerPortHandlers } from './ports/agent-manager';
import { workflowLogger } from './executor/workflow-logger';
import { SessionEventBus } from './events/session-event-bus';

import { registerCryptoHandlers } from './crypto';
import { extractMultipleTabs, isUrlAllowedByFirewall } from './workflows/shared/context/context-tab-extractor';
import {
  isTestMode,
  logMessageCall,
  logMessageSuccess,
  logMessageError,
  getTestLogs,
  clearTestLogs,
  getTestLogsJSON,
} from './test/instrumentation';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
let currentWorkflow: MultiAgentWorkflow | null = null;
// Guard against duplicate starts for the same sessionId
const runningWorkflowSessionIds = new Set<string>();
// Track active MultiAgentWorkflow instances by sessionId for robust cancellation
const workflowsBySession = new Map<string, MultiAgentWorkflow>();
const MAX_EVENT_BUFFER_SIZE = 500; // Prevent memory bloat
const eventBus = new SessionEventBus(MAX_EVENT_BUFFER_SIZE);

// Initialize task manager for parallel execution
const taskManager = new TaskManager({
  maxConcurrentTasks: 3, // Allow up to 3 parallel agents
  eventBus,
});

// Allow TabMirrorService to publish mirror updates through the event bus
// so all subscribers (side panel + agent manager) receive live previews.
taskManager.tabMirrorService.setEventBus(eventBus);

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

registerCryptoHandlers();

// Attach runtime listeners (tabs/debugger/storage/install)
attachRuntimeListeners({
  logger,
  browserContext,
  getCurrentExecutor: () => currentExecutor,
  getCurrentPort: () => currentPort,
});

// Setup context menus for quick actions
// Only create on install/update - this is the recommended pattern for context menus
chrome.runtime.onInstalled.addListener(() => {
  // First remove all existing menus to ensure clean state
  chrome.contextMenus.removeAll(() => {
    // Create explain-selection menu
    chrome.contextMenus.create(
      {
        id: 'explain-selection',
        title: 'Explain this',
        contexts: ['selection'],
      },
      () => {
        if (chrome.runtime.lastError) {
          logger.error('Failed to create explain-selection menu:', chrome.runtime.lastError.message);
        }
      },
    );

    // Create summarize-page menu
    chrome.contextMenus.create(
      {
        id: 'summarize-page',
        title: 'Summarize this page',
        contexts: ['page', 'frame', 'link', 'image', 'video', 'audio'],
      },
      () => {
        if (chrome.runtime.lastError) {
          logger.error('Failed to create summarize-page menu:', chrome.runtime.lastError.message);
        }
      },
    );

    // Create explain-image menu (only appears on right-click of an image)
    chrome.contextMenus.create(
      {
        id: 'explain-image',
        title: 'Explain image',
        contexts: ['image'],
      },
      () => {
        if (chrome.runtime.lastError) {
          logger.error('Failed to create explain-image menu:', chrome.runtime.lastError.message);
        } else {
          logger.info('Context menus created successfully');
        }
      },
    );
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.windowId) return;

  // Open the side panel immediately to preserve user gesture context.
  // Chrome requires sidePanel.open() to be called synchronously in the
  // user gesture handler — any await before it invalidates the gesture.
  const openPromise = chrome.sidePanel.open({ windowId: tab.windowId }).catch(error => {
    logger.error('Failed to open side panel', error);
  });

  // Now do async work to build the pending action
  (async () => {
    let pendingAction: {
      prompt: string;
      autoStart: boolean;
      workflowType: string;
      contextTabId?: number;
      errorMessage?: string;
      contextMenuAction?: string;
      infoMessage?: string;
      imageUrl?: string;
    } | null = null;

    const tabUrl = tab.url || '';
    const RESTRICTED_PREFIXES = [
      'chrome://',
      'chrome-extension://',
      'about:',
      'data:',
      'javascript:',
      'edge://',
      'brave://',
    ];
    const isRestricted = RESTRICTED_PREFIXES.some(prefix => tabUrl.startsWith(prefix));

    if (info.menuItemId === 'explain-selection' && info.selectionText) {
      // Determine if we can include page context (not restricted and allowed by firewall)
      let contextTabId: number | undefined;
      let infoMessage: string | undefined;
      if (isRestricted) {
        infoMessage = 'Page context unavailable (restricted page).';
      } else if (tab.id) {
        const allowedByFirewall = await isUrlAllowedByFirewall(tabUrl);
        if (allowedByFirewall) {
          contextTabId = tab.id;
        } else {
          infoMessage = 'Page context unavailable (blocked by firewall).';
        }
      }
      pendingAction = {
        prompt: `Explain this:\n\n${info.selectionText}`,
        autoStart: true,
        workflowType: 'chat',
        contextTabId,
        contextMenuAction: 'explain-selection',
        infoMessage,
      };
    } else if (info.menuItemId === 'summarize-page') {
      if (isRestricted) {
        pendingAction = {
          prompt: '',
          autoStart: false,
          workflowType: 'chat',
          errorMessage: `Cannot summarize this page. Browser system pages (like ${tabUrl.split('/')[0]}//...) are restricted and cannot be accessed by extensions for security reasons. Please try summarizing a regular web page instead.`,
        };
      } else {
        const allowedByFirewall = await isUrlAllowedByFirewall(tabUrl);
        if (!allowedByFirewall) {
          pendingAction = {
            prompt: '',
            autoStart: false,
            workflowType: 'chat',
            errorMessage: `Cannot summarize this page. The URL "${tabUrl}" is blocked by your firewall settings. You can adjust allowed/denied URLs in Settings > Web.`,
          };
        } else {
          pendingAction = {
            prompt: 'Summarize this page',
            autoStart: true,
            workflowType: 'chat',
            contextTabId: tab.id,
          };
        }
      }
    } else if (info.menuItemId === 'explain-image' && info.srcUrl) {
      let contextTabId: number | undefined;
      let infoMessage: string | undefined;
      if (isRestricted) {
        infoMessage = 'Page context unavailable (restricted page).';
      } else if (tab.id) {
        const allowedByFirewall = await isUrlAllowedByFirewall(tabUrl);
        if (allowedByFirewall) {
          contextTabId = tab.id;
        } else {
          infoMessage = 'Page context unavailable (blocked by firewall).';
        }
      }
      pendingAction = {
        prompt: 'Explain this image',
        autoStart: true,
        workflowType: 'chat',
        contextTabId,
        contextMenuAction: 'explain-image',
        infoMessage,
        imageUrl: info.srcUrl,
      };
    }

    if (pendingAction) {
      // Wait for panel to be open before setting the action, so the panel can pick it up
      await openPromise;
      await chrome.storage.session.set({ pendingAction });
    }
  })();
});

logger.info('background loaded');

// storage/install listeners moved to listeners/runtime

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    switch (message?.type) {
      case 'test_provider': {
        (async () => {
          logMessageCall('test_provider', message);
          try {
            await handleTestProviderMessage(message, sendResponse);
            logMessageSuccess('test_provider', { handled: true });
          } catch (e) {
            logMessageError('test_provider', e instanceof Error ? e.message : 'Failed');
          }
        })();
        return true;
      }

      case 'close_task_tabs': {
        const taskId = message?.taskId;
        (async () => {
          try {
            if (!taskId) return;
            logger.info(`[CloseTabs/msg] Requested close_task_tabs for taskId=${taskId}`);
            await closeTaskTabsFn(taskManager, taskId);
            try {
              currentPort?.postMessage({ type: 'tabs-closed', taskId });
            } catch {}
          } catch (e) {
            logger.error('[CloseTabs/msg] close_task_tabs failed', e);
          }
        })();
        break;
      }
      case 'close_task_group': {
        const groupId = message?.groupId;
        (async () => {
          try {
            if (typeof groupId !== 'number') return;
            logger.info(`[CloseTabs/msg] Requested close_task_group for groupId=${groupId}`);
            await closeTaskGroupFn(groupId);
            try {
              currentPort?.postMessage({ type: 'tabs-closed', groupId });
            } catch {}
          } catch (e) {
            logger.error('[CloseTabs/msg] close_task_group failed', e);
          }
        })();
        break;
      }
      case 'close_all_tabs_for_session': {
        const sessionId = message?.sessionId;
        (async () => {
          try {
            if (!sessionId) return;
            logger.info(`[CloseTabs/msg] Requested close_all_tabs_for_session for sessionId=${sessionId}`);
            await closeAllTabsForSessionFn(taskManager, String(sessionId));
            try {
              currentPort?.postMessage({ type: 'tabs-closed', sessionId });
            } catch {}
          } catch (e) {
            logger.error('[CloseTabs/msg] close_all_tabs_for_session failed', e);
          }
        })();
        break;
      }
      case 'extract_context_tabs': {
        const tabIds: number[] = Array.isArray(message.tabIds)
          ? message.tabIds.filter((id: any) => typeof id === 'number' && id > 0)
          : [];
        (async () => {
          logMessageCall('extract_context_tabs', { tabIds });
          try {
            if (tabIds.length === 0) {
              const response = { success: true, tabIds: [] };
              logMessageSuccess('extract_context_tabs', response);
              sendResponse(response);
              return;
            }
            const results = await extractMultipleTabs(tabIds);
            const extracted = Array.from(results.keys());
            logger.info(`[extract_context_tabs] Extracted ${extracted.length}/${tabIds.length} tabs`);
            const response = { success: true, tabIds: extracted };
            logMessageSuccess('extract_context_tabs', response);
            sendResponse(response);
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : 'Extraction failed';
            logger.error('[extract_context_tabs] Failed:', e);
            logMessageError('extract_context_tabs', errorMsg);
            sendResponse({ success: false, error: errorMsg });
          }
        })();
        return true; // Async response
      }
      case 'check_urls_firewall': {
        const urls: { tabId: number; url: string }[] = Array.isArray(message.urls) ? message.urls : [];
        (async () => {
          logMessageCall('check_urls_firewall', { urls });
          try {
            const results: { tabId: number; allowed: boolean }[] = [];
            for (const { tabId, url } of urls) {
              const allowed = await isUrlAllowedByFirewall(url);
              results.push({ tabId, allowed });
            }
            const response = { results };
            logMessageSuccess('check_urls_firewall', response);
            sendResponse(response);
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : 'Check failed';
            logger.error('[check_urls_firewall] Failed:', e);
            logMessageError('check_urls_firewall', errorMsg);
            sendResponse({ results: [], error: 'Check failed' });
          }
        })();
        return true; // Async response
      }
      default:
        try {
          logger.info('[runtime.onMessage] default branch hit', { type: (message as any)?.type, message });
        } catch {}
        break;
    }
  } catch {}
  return false;
});

// Setup connection listener for long-lived connections (e.g., side panel)
chrome.runtime.onConnect.addListener(async port => {
  // Delegated modular handlers
  if (port.name === 'dashboard') {
    attachDashboardPortHandlers(port, {
      taskManager,
      logger,
      setDashboardPort: (p: chrome.runtime.Port | undefined) => taskManager.setDashboardPort(p),
    });
    return;
  }
  if (port.name === 'agent-manager') {
    attachAgentManagerPortHandlers(port, {
      taskManager,
      logger,
      setAgentManagerPort: (p: chrome.runtime.Port | undefined) => taskManager.tabMirrorService.setAgentManagerPort(p),
      runningWorkflowSessionIds,
      workflowsBySession,
      getCurrentExecutor: () => currentExecutor,
      setCurrentExecutor: (e: any | null) => {
        currentExecutor = e;
      },
    });
    return;
  }
  if (port.name === 'side-panel-connection') {
    attachSidePanelPortHandlers(port, {
      taskManager,
      logger,
      getCurrentPort: () => {
        return currentPort;
      },
      setCurrentPort: (p: chrome.runtime.Port | null) => {
        currentPort = p;
      },
      getCurrentExecutor: () => currentExecutor,
      setCurrentExecutor: (e: any | null) => {
        currentExecutor = e;
      },
      workflowsBySession,
      runningWorkflowSessionIds,
      setCurrentWorkflow: (wf: any | null) => {
        currentWorkflow = wf;
      },
    });
    return;
  }
});

// Message handlers for cost and latency calculations (used by EstimationPopUp)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'calculate_cost') {
    (async () => {
      logMessageCall('calculate_cost', {
        modelName: message.modelName,
        inputTokens: message.inputTokens,
        outputTokens: message.outputTokens,
      });
      try {
        const { calculateCost } = await import('./utils/cost-calculator');
        const cost = calculateCost(message.modelName, message.inputTokens, message.outputTokens);
        const response = { cost };
        logMessageSuccess('calculate_cost', response);
        sendResponse(response);
      } catch (e) {
        logger.error('Failed to calculate cost:', e);
        logMessageError('calculate_cost', e instanceof Error ? e.message : 'Failed');
        sendResponse({ cost: 0 });
      }
    })();
    return true;
  }

  if (message.type === 'get_model_latency') {
    (async () => {
      logMessageCall('get_model_latency', { modelName: message.modelName });
      try {
        const { getModelLatency } = await import('./utils/latency-calculator');
        const latency = getModelLatency(message.modelName);
        logMessageSuccess('get_model_latency', latency);
        sendResponse(latency);
      } catch (e) {
        logger.error('Failed to get model latency:', e);
        logMessageError('get_model_latency', e instanceof Error ? e.message : 'Failed');
        sendResponse(null);
      }
    })();
    return true;
  }

  if (message.type === 'get_available_models') {
    (async () => {
      logMessageCall('get_available_models', {});
      try {
        const { getAllProvidersDecrypted } = await import('./crypto');
        const providers = await getAllProvidersDecrypted();

        const models: Array<{ provider: string; providerName: string; model: string }> = [];

        for (const [provider, config] of Object.entries(providers)) {
          if (!config?.apiKey || config.apiKey.trim() === '') continue;

          const providerModels = config.modelNames || [];
          models.push(
            ...providerModels.map((model: string) => ({
              provider,
              providerName: config.name || provider,
              model,
            })),
          );
        }

        const response = { models };
        logMessageSuccess('get_available_models', response);
        sendResponse(response);
      } catch (e) {
        logger.error('Failed to get available models:', e);
        logMessageError('get_available_models', e instanceof Error ? e.message : 'Failed');
        sendResponse({ models: [] });
      }
    })();
    return true;
  }

  if (message.type === 'get_provider_models') {
    (async () => {
      logMessageCall('get_provider_models', { provider: message.provider });
      try {
        const { initializeModelRegistry, getModelsForProvider } = await import('./utils/model-registry');
        await initializeModelRegistry();
        const models = getModelsForProvider(message.provider);
        const response = { ok: true, models };
        logMessageSuccess('get_provider_models', response);
        sendResponse(response);
      } catch (e) {
        logger.error('Failed to get provider models:', e);
        logMessageError('get_provider_models', e instanceof Error ? e.message : 'Failed');
        sendResponse({ ok: false, models: [] });
      }
    })();
    return true;
  }

  if (message.type === 'get_openrouter_providers') {
    (async () => {
      logMessageCall('get_openrouter_providers', {});
      try {
        const { initializeModelRegistry, getOpenRouterProviderGroups } = await import('./utils/model-registry');
        await initializeModelRegistry();
        const providers = getOpenRouterProviderGroups();
        const response = { ok: true, providers };
        logMessageSuccess('get_openrouter_providers', response);
        sendResponse(response);
      } catch (e) {
        logger.error('Failed to get OpenRouter providers:', e);
        logMessageError('get_openrouter_providers', e instanceof Error ? e.message : 'Failed');
        sendResponse({ ok: false, providers: [] });
      }
    })();
    return true;
  }

  if (message.type === 'get_openrouter_models_for_providers') {
    (async () => {
      logMessageCall('get_openrouter_models_for_providers', { enabledProviders: message.enabledProviders });
      try {
        const { getModelsForOpenRouterProviders } = await import('./utils/model-registry');
        const models = getModelsForOpenRouterProviders(message.enabledProviders || []);
        const response = { ok: true, models };
        logMessageSuccess('get_openrouter_models_for_providers', response);
        sendResponse(response);
      } catch (e) {
        logger.error('Failed to get OpenRouter models:', e);
        logMessageError('get_openrouter_models_for_providers', e instanceof Error ? e.message : 'Failed');
        sendResponse({ ok: false, models: [] });
      }
    })();
    return true;
  }

  if (message.type === 'refresh_model_registry') {
    (async () => {
      logMessageCall('refresh_model_registry', {});
      try {
        const { forceRefreshModelRegistry } = await import('./utils/model-registry');
        await forceRefreshModelRegistry();
        const response = { ok: true };
        logMessageSuccess('refresh_model_registry', response);
        sendResponse(response);
      } catch (e) {
        logger.error('Failed to refresh model registry:', e);
        logMessageError('refresh_model_registry', e instanceof Error ? e.message : 'Failed');
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (message.type === 'reinitialize_model_registry') {
    (async () => {
      logMessageCall('reinitialize_model_registry', {});
      try {
        const { reinitializeModelRegistry } = await import('./utils/model-registry');
        await reinitializeModelRegistry();
        const response = { ok: true };
        logMessageSuccess('reinitialize_model_registry', response);
        sendResponse(response);
      } catch (e) {
        logger.error('Failed to reinitialize model registry:', e);
        logMessageError('reinitialize_model_registry', e instanceof Error ? e.message : 'Failed');
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (message.type === 'get_pricing_cache_status') {
    (async () => {
      logMessageCall('get_pricing_cache_status', {});
      try {
        const { isUsingCachedPricing, getCachedPricingDate } = await import('./utils/model-registry');
        const response = {
          ok: true,
          isUsingCache: isUsingCachedPricing(),
          cacheDate: getCachedPricingDate(),
        };
        logMessageSuccess('get_pricing_cache_status', response);
        sendResponse(response);
      } catch (e) {
        logMessageError('get_pricing_cache_status', e instanceof Error ? e.message : 'Failed');
        sendResponse({ ok: false, isUsingCache: false, cacheDate: null });
      }
    })();
    return true;
  }

  // Test API endpoints - only available when __TEST__=true
  if (isTestMode()) {
    if (message.type === '__test_get_logs') {
      (async () => {
        const logs = await getTestLogs();
        sendResponse({ logs });
      })();
      return true;
    }

    if (message.type === '__test_clear_logs') {
      (async () => {
        await clearTestLogs();
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (message.type === '__test_get_logs_json') {
      (async () => {
        const json = await getTestLogsJSON();
        sendResponse({ json });
      })();
      return true;
    }
  }

  return false;
});

// Initialize instrumentation (cost calc, logging, updates)
(async () => {
  try {
    const summary = await initInstrumentation(logger);
    workflowLogger.extensionInitialized(
      summary.pricedModels,
      summary.latencyModels,
      summary.registryModels,
      summary.errors,
    );
  } catch {}
})();

// Initialize API (only when built with __API__=true)
import { initializeAPI } from './api';
initializeAPI(taskManager);
