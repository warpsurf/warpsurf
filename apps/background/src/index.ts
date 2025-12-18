import 'webextension-polyfill';
import BrowserContext from './browser/context';
import { Executor } from './executor/executor';
import { createLogger } from './log';
import { TaskManager } from './task/task-manager';
import { MultiAgentWorkflow } from './workflows/multiagent/multiagent-workflow';

import { handleTestProviderMessage } from './workflows/models/provider-test';
import { closeTaskTabs as closeTaskTabsFn, closeTaskGroup as closeTaskGroupFn, closeAllTabsForSession as closeAllTabsForSessionFn } from './tabs/cleanup';
import { attachRuntimeListeners } from './listeners/runtime';
import { initInstrumentation } from './init/instrumentation';
import { attachSidePanelPortHandlers } from './ports/side-panel';
import { attachDashboardPortHandlers } from './ports/dashboard';
import { workflowLogger } from './executor/workflow-logger';

import { registerCryptoHandlers } from './crypto';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
let currentWorkflow: MultiAgentWorkflow | null = null;
// Guard against duplicate starts for the same sessionId
const runningWorkflowSessionIds = new Set<string>();
// Track active MultiAgentWorkflow instances by sessionId for robust cancellation
const workflowsBySession = new Map<string, MultiAgentWorkflow>();

// Initialize task manager for parallel execution
const taskManager = new TaskManager({
  maxConcurrentTasks: 3, // Allow up to 3 parallel agents
});

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

logger.info('background loaded');

// storage/install listeners moved to listeners/runtime

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    switch (message?.type) {
      case 'test_provider': {
        (async () => { await handleTestProviderMessage(message, sendResponse); })();
        return true;
      }
      
      case 'close_task_tabs': {
        const taskId = message?.taskId;
        (async () => {
          try {
            if (!taskId) return;
            logger.info(`[CloseTabs/msg] Requested close_task_tabs for taskId=${taskId}`);
            await closeTaskTabsFn(taskManager, taskId);
            try { currentPort?.postMessage({ type: 'tabs-closed', taskId }); } catch {}
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
            try { currentPort?.postMessage({ type: 'tabs-closed', groupId }); } catch {}
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
            try { currentPort?.postMessage({ type: 'tabs-closed', sessionId }); } catch {}
          } catch (e) {
            logger.error('[CloseTabs/msg] close_all_tabs_for_session failed', e);
          }
        })();
        break;
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
      getCurrentPort: () => currentPort,
      setDashboardPort: (p: chrome.runtime.Port | undefined) => taskManager.setDashboardPort(p),
    });
    return;
  }
  if (port.name === 'side-panel-connection') {
    attachSidePanelPortHandlers(port, {
      taskManager,
      logger,
      getCurrentPort: () => currentPort,
      setCurrentPort: (p: chrome.runtime.Port | null) => { currentPort = p; },
      getCurrentExecutor: () => currentExecutor,
      setCurrentExecutor: (e: any | null) => { currentExecutor = e; },
      workflowsBySession,
      runningWorkflowSessionIds,
      setCurrentWorkflow: (wf: any | null) => { currentWorkflow = wf; },
    });
    return;
  }
});

// Message handlers for cost and latency calculations (used by EstimationPopUp)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'calculate_cost') {
    (async () => {
      try {
        const { calculateCost } = await import('./utils/cost-calculator');
        const cost = calculateCost(
          message.modelName,
          message.inputTokens,
          message.outputTokens
        );
        sendResponse({ cost });
      } catch (e) {
        logger.error('Failed to calculate cost:', e);
        sendResponse({ cost: 0 });
      }
    })();
    return true; // Indicates async response
  }
  
  if (message.type === 'get_model_latency') {
    (async () => {
      try {
        const { getModelLatency } = await import('./utils/latency-calculator');
        const latency = getModelLatency(message.modelName);
        sendResponse(latency);
      } catch (e) {
        logger.error('Failed to get model latency:', e);
        sendResponse(null);
      }
    })();
    return true; // Indicates async response
  }
  
  if (message.type === 'get_available_models') {
    (async () => {
      try {
        const { getAllProvidersDecrypted } = await import('./crypto');
        const providers = await getAllProvidersDecrypted();
        
        const models: Array<{ provider: string; providerName: string; model: string }> = [];
        
        for (const [provider, config] of Object.entries(providers)) {
          if (!config?.apiKey || config.apiKey.trim() === '') continue;
          
          const providerModels = config.modelNames || [];
          // Include all models, not just those with pricing data
          // Models without pricing will display costs as NaN
          models.push(
            ...providerModels.map(model => ({
              provider,
              providerName: config.name || provider,
              model
            }))
          );
        }
        
        sendResponse({ models });
      } catch (e) {
        logger.error('Failed to get available models:', e);
        sendResponse({ models: [] });
      }
    })();
    return true;
  }

  // Model registry handlers
  if (message.type === 'get_provider_models') {
    (async () => {
      try {
        const { initializeModelRegistry, getModelsForProvider } = await import('./utils/model-registry');
        await initializeModelRegistry(); // Ensure initialized
        const models = getModelsForProvider(message.provider);
        sendResponse({ ok: true, models });
      } catch (e) {
        logger.error('Failed to get provider models:', e);
        sendResponse({ ok: false, models: [] });
      }
    })();
    return true;
  }

  if (message.type === 'get_openrouter_providers') {
    (async () => {
      try {
        const { initializeModelRegistry, getOpenRouterProviderGroups } = await import('./utils/model-registry');
        await initializeModelRegistry(); // Ensure initialized
        const providers = getOpenRouterProviderGroups();
        sendResponse({ ok: true, providers });
      } catch (e) {
        logger.error('Failed to get OpenRouter providers:', e);
        sendResponse({ ok: false, providers: [] });
      }
    })();
    return true;
  }

  if (message.type === 'get_openrouter_models_for_providers') {
    (async () => {
      try {
        const { getModelsForOpenRouterProviders } = await import('./utils/model-registry');
        const models = getModelsForOpenRouterProviders(message.enabledProviders || []);
        sendResponse({ ok: true, models });
      } catch (e) {
        logger.error('Failed to get OpenRouter models:', e);
        sendResponse({ ok: false, models: [] });
      }
    })();
    return true;
  }

  if (message.type === 'refresh_model_registry') {
    (async () => {
      try {
        const { forceRefreshModelRegistry } = await import('./utils/model-registry');
        await forceRefreshModelRegistry();
        sendResponse({ ok: true });
      } catch (e) {
        logger.error('Failed to refresh model registry:', e);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  // Reinitialize registry after changing live/cached mode setting
  if (message.type === 'reinitialize_model_registry') {
    (async () => {
      try {
        const { reinitializeModelRegistry } = await import('./utils/model-registry');
        await reinitializeModelRegistry();
        sendResponse({ ok: true });
      } catch (e) {
        logger.error('Failed to reinitialize model registry:', e);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  // Get cache status for UI display
  if (message.type === 'get_pricing_cache_status') {
    (async () => {
      try {
        const { isUsingCachedPricing, getCachedPricingDate } = await import('./utils/model-registry');
        sendResponse({
          ok: true,
          isUsingCache: isUsingCachedPricing(),
          cacheDate: getCachedPricingDate(),
        });
      } catch (e) {
        sendResponse({ ok: false, isUsingCache: false, cacheDate: null });
      }
    })();
    return true;
  }
  
  return false;
});

// Initialize instrumentation (cost calc, logging, updates)
(async () => { 
  try { 
    const summary = await initInstrumentation(logger);
    workflowLogger.extensionInitialized(summary.pricedModels, summary.latencyModels, summary.registryModels, summary.errors);
  } catch {} 
})();
