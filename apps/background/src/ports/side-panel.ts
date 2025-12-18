import { warningsSettingsStore, agentModelStore, generalSettingsStore, AgentNameEnum, getDefaultDisplayNameFromProviderId } from '@extension/storage';
import { safePostMessage, safeStorageRemove } from '@extension/shared/lib/utils';
import { initializeCostCalculator } from '../utils/cost-calculator';
import { canInjectScripts, injectBuildDomTree } from '../utils/injection';
import { handleNewTask, handleFollowUpTask } from '../executor/task-handlers';
import { subscribeToExecutorEvents } from '../workflows/shared/subscribe-to-executor-events';
import { handleGetTokenLog, handleGetCombinedTokenLog, handleGetErrorLog, handleGetAgentLog, handleGetSessionLogs, handleGetCombinedSessionLogs } from '../logs/handlers';
import { focusTab, takeControl, handBackControl } from '../tabs/control-handlers';
import { closeTaskTabs as closeTaskTabsFn, closeTaskGroup as closeTaskGroupFn, closeAllTabsForSession as closeAllTabsForSessionFn } from '../tabs/cleanup';
import { sendTabMirror, sendAllMirrorsForCleanup, setPreviewVisibility } from '../tabs/handlers';
import { MultiAgentWorkflow } from '../workflows/multiagent/multiagent-workflow';
import { createChatModel } from '../workflows/models/factory';
import { getAllProvidersDecrypted } from '../crypto';

type BaseChatModel = any;

export type SidePanelDeps = {
  taskManager: any;
  logger: { info: Function; error: Function; debug?: Function };
  getCurrentPort: () => chrome.runtime.Port | null;
  setCurrentPort: (p: chrome.runtime.Port | null) => void;
  getCurrentExecutor: () => any | null;
  setCurrentExecutor: (e: any | null) => void;
  workflowsBySession: Map<string, MultiAgentWorkflow>;
  runningWorkflowSessionIds: Set<string>;
  setCurrentWorkflow: (wf: MultiAgentWorkflow | null) => void;
};

export function attachSidePanelPortHandlers(port: chrome.runtime.Port, deps: SidePanelDeps): void {
  const { taskManager, logger, getCurrentPort, setCurrentPort, getCurrentExecutor, setCurrentExecutor, workflowsBySession, runningWorkflowSessionIds, setCurrentWorkflow } = deps;

  logger.info('Side panel connected');
  setCurrentPort(port);
  taskManager.setSidePanelPort(port);

  // If a pending shortcut/omnibox session exists, notify the panel to adopt it immediately
  try {
    chrome.storage.local.get('pending_shortcut').then(res => {
      try {
        const pending = (res as any)?.pending_shortcut;
        if (pending && pending.text) {
          try { port.postMessage({ type: 'shortcut', data: { text: String(pending.text || '') } }); } catch {}
          // Clear after notifying to avoid re-adoption on reconnect
          safeStorageRemove('pending_shortcut');}
      } catch {}
    }).catch(() => {});
  } catch {}

  port.onMessage.addListener(async (message: any) => {
    try {
      // Global guard: block task-start actions until first-run disclaimer accepted
      const typeStr = String((message as any)?.type || '');
      if (typeStr === 'new_task' || typeStr === 'follow_up_task' || typeStr === 'start_multi_agent_workflow_v2') {
        try {
          const w = await warningsSettingsStore.getWarnings();
          if (!w.hasAcceptedFirstRun) {
            safePostMessage(port, { type: 'error', error: 'Please accept the liability disclaimer in the extension to continue.' });
            return;
          }
        } catch {
          safePostMessage(port, { type: 'error', error: 'Please accept the liability disclaimer in the extension to continue.' });
            return;
        }
      }

      switch (message.type) {
        case 'new_task': {
          await handleNewTask(message, {
            taskManager,
            logger,
            currentPort: getCurrentPort(),
            getCurrentExecutor,
            setCurrentExecutor,
          });
          return;
        }
        case 'follow_up_task': {
          await handleFollowUpTask(message, {
            taskManager,
            logger,
            currentPort: getCurrentPort(),
            getCurrentExecutor,
            setCurrentExecutor,
          });
          return;
        }
        case 'approve_estimation': {
          try {
            const sessionId = String(message.sessionId || message.taskId || '');
            const selectedModel = message.selectedModel ? String(message.selectedModel) : undefined;
            
            if (!sessionId) {
              safePostMessage(port, { type: 'error', error: 'Missing sessionId' });
            return;
            }
            
            // If a different model was selected, temporarily update the navigator model
            if (selectedModel) {
              try {
                const { agentModelStore, AgentNameEnum } = await import('@extension/storage');
                const providers = await getAllProvidersDecrypted();
                const agentModels = await agentModelStore.getAllAgentModels();
                const navigatorModel = agentModels[AgentNameEnum.Navigator];
                
                if (navigatorModel && navigatorModel.modelName !== selectedModel) {
                  // Find the provider for this model
                  let modelProvider: string | null = null;
                  for (const [provider, config] of Object.entries(providers)) {
                    if (config.modelNames?.includes(selectedModel)) {
                      modelProvider = provider;
                      break;
                    }
                  }
                  
                  if (modelProvider) {
                    // Update navigator model temporarily
                    await agentModelStore.setAgentModel(AgentNameEnum.Navigator, {
                      provider: modelProvider,
                      modelName: selectedModel,
                      parameters: navigatorModel.parameters,
                      webSearch: navigatorModel.webSearch
                    });
                    logger.info(`[Estimation] Temporarily updated navigator model to ${selectedModel} for this task`);
                  } else {
                    logger.error(`[Estimation] Could not find provider for selected model ${selectedModel}`);
                  }
                }
              } catch (e) {
                logger.error('[Estimation] Failed to update navigator model:', e);
                // Continue anyway - don't fail the approval
              }
            }
            
            const { approveEstimation } = await import('../executor/task-handlers');
            const estimation = message.estimation;
            approveEstimation(sessionId, estimation);
            logger.info(`[Estimation] Approved for session ${sessionId}${selectedModel ? ` with model ${selectedModel}` : ''}${estimation ? ' (with recalculated estimation)' : ''}`);
            safePostMessage(port, { type: 'success' });
            return;
          } catch (e) {
            logger.error('[Estimation] Approval failed:', e);
            safePostMessage(port, { type: 'error', error: 'Failed to approve estimation' });
            return;
          }
        }
        case 'cancel_estimation': {
          try {
            const sessionId = String(message.sessionId || message.taskId || '');
            if (!sessionId) {
              safePostMessage(port, { type: 'error', error: 'Missing sessionId' });
            return;
            }
            const { cancelEstimation } = await import('../executor/task-handlers');
            cancelEstimation(sessionId);
            logger.info(`[Estimation] Cancelled for session ${sessionId}`);
            safePostMessage(port, { type: 'success' });
            return;
          } catch (e) {
            logger.error('[Estimation] Cancellation failed:', e);
            safePostMessage(port, { type: 'error', error: 'Failed to cancel estimation' });
            return;
          }
        }
        case 'cancel_task': {
          const requestId = message.requestId;
          const id = String(message.sessionId || message.taskId || '').trim();
          
          if (!id) {
            safePostMessage(port, { type: 'cancel_task_result', requestId, sessionId: id, success: false, error: 'Missing taskId/sessionId' });
            return;
          }

          try {
            // Cancel any pending estimation
            try {
              const { cancelEstimation } = await import('../executor/task-handlers');
              cancelEstimation(id);
              const { Actors, ExecutionState } = await import('../workflows/shared/event/types');
              port.postMessage({
                type: 'execution', actor: Actors.ESTIMATOR, state: ExecutionState.ESTIMATION_CANCELLED,
                data: { taskId: id, step: 0, maxSteps: 0, details: 'Workflow cancelled by user' },
                timestamp: Date.now()
              });
            } catch {} // Estimation might not exist

            // Find workflow - try exact match, then partial match for ID normalization issues
            let wf = workflowsBySession.get(id);
            if (!wf) {
              for (const [sessionId, workflow] of workflowsBySession.entries()) {
                if (sessionId.includes(id) || id.includes(sessionId)) {
                  wf = workflow;
                  break;
                }
              }
            }

            if (wf) {
              await wf.cancelAll();
              workflowsBySession.delete(id);
              for (const [key, w] of workflowsBySession.entries()) {
                if (w === wf) workflowsBySession.delete(key);
              }
              try { await (taskManager as any).tabMirrorService?.freezeMirrorsForSession?.(id); } catch {}
              
              safePostMessage(port, { type: 'cancel_task_result', requestId, sessionId: id, success: true, workflowCancelled: true, taskCancelled: false });
              return;
            }

            // Single-agent task cancellation
            await taskManager.cancelTask(id);
            try { await (taskManager as any).cancelAllForParentSession?.(id); } catch {}
            try { (taskManager as any).tabMirrorService?.freezeMirrorsForSession?.(id); } catch {}
            
            safePostMessage(port, { type: 'cancel_task_result', requestId, sessionId: id, success: true, workflowCancelled: false, taskCancelled: true });
            return;
          } catch (e) {
            logger.error('[cancel_task] Failed:', e);
            safePostMessage(port, { type: 'cancel_task_result', requestId, sessionId: id, success: false, error: e instanceof Error ? e.message : 'Failed to cancel task' });
            return;
          }
        }
        case 'start_multi_agent_workflow_v2': {
          try {
            const sessionId: string = String(message.sessionId || '');
            const query: string = String(message.query || '').trim();
            const maxWorkersOverride: number | undefined = typeof message.maxWorkersOverride === 'number' ? message.maxWorkersOverride : undefined;
            if (!sessionId || !query) {
              safePostMessage(port, { type: 'error', error: 'Missing sessionId or query for workflow v2' });
            return;
            }
            // Prevent duplicate starts for same session
            if (runningWorkflowSessionIds.has(sessionId)) {
              safePostMessage(port, { type: 'error', error: 'Workflow already running for this session' });
            return;
            }

            // Resolve providers and agent models
            const providers = await getAllProvidersDecrypted();
            const agentModels = await agentModelStore.getAllAgentModels();

            // Choose planner: MultiagentPlanner -> AgentPlanner -> AgentNavigator
            const plannerCfg = agentModels[AgentNameEnum.MultiagentPlanner] || agentModels[AgentNameEnum.AgentPlanner] || agentModels[AgentNameEnum.AgentNavigator];
            if (!plannerCfg) {
              safePostMessage(port, { type: 'error', error: 'Please set a Planner model in Settings' });
            return;
            }
            const plannerProvider = providers[plannerCfg.provider];
            if (!plannerProvider) {
              const name = getDefaultDisplayNameFromProviderId(plannerCfg.provider);
              return port.postMessage({ type: 'error', error: `Provider '${name}' not found. Please add an API key for ${name} in Settings.` });
            }
            const plannerLLM: BaseChatModel = createChatModel(plannerProvider, plannerCfg);

            // Compute max workers from settings with optional override
            const settings = await generalSettingsStore.getSettings();
            const maxWorkers = Math.max(1, Math.min(32, (typeof maxWorkersOverride === 'number' && maxWorkersOverride > 0) ? maxWorkersOverride : (settings?.maxWorkerAgents ?? 3)));

            // Create orchestrator and start
            const orchestrator = new MultiAgentWorkflow(taskManager, port, String(sessionId), { maxWorkers });
            // Optional: inject a dedicated Refiner model if configured
            try {
              const refinerCfg = agentModels[AgentNameEnum.MultiagentRefiner];
              if (refinerCfg && providers[refinerCfg.provider]) {
                (orchestrator as any).setRefinerModel(createChatModel(providers[refinerCfg.provider], refinerCfg));
              }
            } catch {}
            runningWorkflowSessionIds.add(sessionId);
            setCurrentWorkflow(orchestrator);
            workflowsBySession.set(sessionId, orchestrator);
            safePostMessage(port, { type: 'workflow_started', data: { sessionId } });// Start async; errors are posted back to UI
            (async () => {
              try {
                await orchestrator.start(query, plannerLLM);
              } catch (e) {
                safePostMessage(port, { type: 'workflow_ended', ok: false, error: e instanceof Error ? e.message : 'Workflow failed' });} finally {
                runningWorkflowSessionIds.delete(sessionId);
                setCurrentWorkflow(null);
                try { workflowsBySession.delete(sessionId); } catch {}
                // Freeze mirrors when the orchestrator ends so previews remain
                try { await (taskManager as any).tabMirrorService?.freezeMirrorsForSession?.(String(sessionId)); } catch {}
              }
            })();
            return;
          } catch (e) {
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to start workflow v2' });
            return;
          }
        }
        case 'panel_opened': {
          // Prewarm: initialize provider costs, inject DOM/mardown helpers in active tab
          try {
            await initializeCostCalculator();
          } catch {}
          try {
            const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (active?.id && canInjectScripts(active.url)) {
              await injectBuildDomTree(active.id, active.url);
            }
          } catch {}
          break;
        }
        case 'heartbeat':
          safePostMessage(port, { type: 'heartbeat_ack' });
          break;
        case 'panel_log':
          logger.info('[Panel]', (message as any)?.message);
          break;
        case 'panel_error':
          logger.error('[Panel]', (message as any)?.message);
          break;
        case 'judge_evaluate': {
          try {
            const payload = (message as any)?.data || {};
            const question: string = String(payload.question || '').trim();
            const groundTruthCSV: string = String(payload.groundTruthCSV || '');
            const agentOutput: string = String(payload.agentOutput || '');
            const evaluationJson: string = String(payload.evaluationJson || '');
            const judgeSessionId: string = String(payload.sessionId || '');
            if (!question || !groundTruthCSV || !agentOutput || !evaluationJson) {
              return port.postMessage({ type: 'judge_result', error: 'Missing judge payload fields', data: { sessionId: judgeSessionId } });
            }
            // Choose judge model: AgentValidator -> Chat -> AgentNavigator
            const providers = await getAllProvidersDecrypted();
            const agentModels = await agentModelStore.getAllAgentModels();
            const judgeModel = agentModels[AgentNameEnum.AgentValidator] || agentModels[AgentNameEnum.Chat] || agentModels[AgentNameEnum.AgentNavigator];
            if (!judgeModel) {
              return port.postMessage({ type: 'judge_result', error: 'No judge model configured. Please set Validator, Chat, or Navigator in Agent Settings.', data: { sessionId: judgeSessionId } });
            }
            const judgeLLM: BaseChatModel = createChatModel(providers[judgeModel.provider], judgeModel);
            const system = [
              'You are an impartial evaluation judge. Evaluate a model-generated markdown table against a CSV ground truth using the provided evaluation schema.',
              'Return ONLY a compact JSON object. Do not include explanations outside JSON.',
              'Evaluation guidance for metrics:',
              '- exact_match: case-insensitive trim, normalize internal whitespace; must match exactly after normalization.',
              '- url_match: compare normalized URLs; host + path should refer to same entity; ignore trailing slashes, http/https.',
              '- number_near: compare numeric values allowing relative tolerance specified by criterion (e.g., 0.05 = 5%).',
              '- llm_judge: use the provided criterion text to decide approximate semantic equivalence.',
              'Preprocess steps like norm_str and extract_number should be applied before metric checks.',
            ].join('\n');
            const user = JSON.stringify({
              question,
              evaluation: evaluationJson,
              ground_truth_csv: groundTruthCSV,
              agent_markdown: agentOutput,
              output_schema: {
                overall_pass: 'boolean',
                summary: 'short string',
                issues: 'array of { row_key: string, column: string, reason: string }',
              },
              instructions: 'Align rows using evaluation.unique_columns. Ensure all evaluation.required columns appear. For each required column, apply its metric. Produce JSON: {overall_pass, summary, issues} where overall_pass=false if any required field fails. Keep JSON under 2KB.'
            });
            let resultText = '';
            try {
              const res = await (judgeLLM as any).invoke([{ role: 'system', content: system }, { role: 'user', content: user }] as any);
              resultText = typeof (res as any)?.content === 'string' ? (res as any).content : JSON.stringify((res as any)?.content ?? '');
            } catch (e) {
              return port.postMessage({ type: 'judge_result', error: e instanceof Error ? e.message : 'Judge invocation failed', data: { sessionId: judgeSessionId } });
            }
            return port.postMessage({ type: 'judge_result', data: { sessionId: judgeSessionId, result: resultText } });
          } catch (e) {
            safePostMessage(port, { type: 'judge_result', error: e instanceof Error ? e.message : 'Judge failed' });
            return;
          }
        }
        case 'get_token_log': {
          try { handleGetTokenLog(port, String(message.taskId || '')); } catch (e) { safePostMessage(port, { type: 'token_log', error: e instanceof Error ? e.message : 'Failed to get token log' });
            return; }
          break;
        }
        case 'get_error_log': {
          try { handleGetErrorLog(port, String(message.sessionId || '')); } catch (e) { safePostMessage(port, { type: 'error_log', error: e instanceof Error ? e.message : 'Failed to get error log' });
            return; }
          break;
        }
        case 'get_agent_log': {
          try { handleGetAgentLog(port, taskManager as any, String(message.taskId || '')); } catch (e) { safePostMessage(port, { type: 'agent_log', error: e instanceof Error ? e.message : 'Failed to get agent log' });
            return; }
          break;
        }
        case 'get_combined_token_log': {
          try { handleGetCombinedTokenLog(port, taskManager as any, String(message.sessionId || '')); } catch (e) { safePostMessage(port, { type: 'combined_token_log', error: e instanceof Error ? e.message : 'Failed to get combined token log' });
            return; }
          break;
        }
        case 'get_session_logs': {
          try { handleGetSessionLogs(port, taskManager as any, String(message.sessionId || '')); } catch (e) { safePostMessage(port, { type: 'session_logs', error: e instanceof Error ? e.message : 'Failed to get session logs' });
            return; }
          break;
        }
        case 'get_combined_session_logs': {
          try { handleGetCombinedSessionLogs(port, taskManager as any, String(message.sessionId || '')); } catch (e) { safePostMessage(port, { type: 'combined_session_logs', error: e instanceof Error ? e.message : 'Failed to get combined session logs' });
            return; }
          break;
        }
        case 'summarise_history': {
          try {
            logger.info('[HistoryContext] Received summarise_history message');
            
            // Verify privacy consent before proceeding
            const warnings = await warningsSettingsStore.getWarnings();
            if (!warnings.hasAcceptedHistoryPrivacyWarning) {
              return port.postMessage({
                type: 'error',
                error: 'History privacy warning must be accepted before using this feature. Enable history context in Agent Settings.'
              });
            }
            
            // Get configurable settings
            const settings = await generalSettingsStore.getSettings();
            const windowHours = typeof message.windowHours === 'number' 
              ? message.windowHours 
              : (settings.historySummaryWindowHours || 24);
            const maxRawItems = settings.historySummaryMaxRawItems || 1000;
            const maxProcessedItems = settings.historySummaryMaxProcessedItems || 50;
            logger.info(`[HistoryContext] Window: ${windowHours}h, maxRaw: ${maxRawItems}, maxProcessed: ${maxProcessedItems}`);
            
            // Import modules dynamically
            logger.info('[HistoryContext] Importing modules...');
            const { fetchBrowserHistory } = await import('@src/browser/history/fetcher');
            const { preprocessHistory } = await import('@src/browser/history/preprocessor');
            const { HistorySummarizerWorkflow } = await import('@src/workflows/specialized/history-summarizer');
            const { storeHistoryContext } = await import('@src/workflows/shared/context/history-context');
            logger.info('[HistoryContext] Modules imported successfully');

            // Step 1: Fetch raw history
            logger.info('[HistoryContext] Fetching browser history...');
            
            const rawHistory = await fetchBrowserHistory({ windowHours, maxResults: maxRawItems });
            logger.info(`[HistoryContext] Fetched ${rawHistory.length} raw items`);
            
            // Step 2: Preprocess (deduplicate, aggregate counts)
            const processedHistory = preprocessHistory(rawHistory, {
              maxItems: maxProcessedItems,
              filterNoise: true,
              minVisitCount: 1,
            });
            logger.info(`[HistoryContext] Preprocessed to ${processedHistory.length} unique items`);

            // Step 3: Create and execute summarizer agent
            logger.info('[HistoryContext] Creating HistorySummariser agent...');

            // Get model config for HistorySummariser
            const providers = await getAllProvidersDecrypted();
            const agentModels = await agentModelStore.getAllAgentModels();
            
            const modelConfig = agentModels[AgentNameEnum.HistorySummariser];
            if (!modelConfig || !providers[modelConfig.provider]) {
              throw new Error('HistorySummariser model not configured. Please configure it in Settings.');
            }

            // Create chat model
            const chatModel = createChatModel(providers[modelConfig.provider], modelConfig);
            
            // Import required classes for agent context
            const { AgentContext } = await import('@src/workflows/shared/agent-types');
            const { EventManager } = await import('@src/workflows/shared/event/event-bus');
            const MessageManager = (await import('@src/workflows/shared/messages/service')).default;
            const { HistorySummariserPrompt } = await import('@src/workflows/specialized/history-summarizer');
            
            // Create event manager that doesn't forward to chat (silent background operation)
            const eventManager = new EventManager();
            // We don't subscribe to events - let it run silently in background
            
            // Create minimal message manager (not really used by HistorySummariser)
            const messageManager = new MessageManager();
            
            // Create minimal browser context (not used by HistorySummariser)
            const BrowserContext = (await import('@src/browser/context')).default;
            const browserContext = new BrowserContext({ forceNewTab: false });
            
            // Create agent context using proper constructor
            const agentContext = new AgentContext(
              'history-summary',
              browserContext,
              messageManager,
              eventManager,
              { useVision: false, maxSteps: 1 }
            );
            
            // Create prompt
            const prompt = new HistorySummariserPrompt();
            
            // Create agent with proper BaseAgentOptions
            const agent = new HistorySummarizerWorkflow({ 
              chatLLM: chatModel, 
              context: agentContext, 
              prompt 
            });
            agent.setHistory(processedHistory);

            const result = await agent.execute();

            if (result.error) {
              return port.postMessage({
                type: 'error',
                error: `History summarization failed: ${result.error}`
              });
            }

            // Step 4: Store globally
            await storeHistoryContext(result.result, windowHours);

            logger.info('History context stored globally - will be used by all agents');

            // Step 5: Notify UI
            safePostMessage(port, {
              type: 'history_context_updated',
              active: true,
              windowHours,
              timestamp: Date.now(),
            });
            
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Summarise history failed:', error);
            return port.postMessage({
              type: 'error',
              error: `Failed to summarize history: ${errMsg}`
            });
          }
          return;
        }
        case 'check_history_context': {
          try {
            const { isHistoryContextActive } = await import('@src/workflows/shared/context/history-injector');
            const active = await isHistoryContextActive();
            
            safePostMessage(port, {
              type: 'history_context_status',
              active,
            });
          } catch (error) {
            logger.error('Failed to check history context status:', error);
          }
          return;
        }
        case 'focus_tab': {
          const { tabId } = message;
          logger.info(`[SidePanel] Received focus_tab request for tab ${tabId}`);
          await focusTab(Number(tabId), port, logger);
          break;
        }
        case 'take_control': {
          const { tabId } = message;
          logger.info(`Take control requested for tab ${tabId}`);
          try {
            await takeControl(Number(tabId), getCurrentExecutor(), logger);
            safePostMessage(port, { type: 'success' });
            return;
          } catch (e) {
            logger.error('Failed to take control:', e);
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to take control' });
            return;
          }
        }
        case 'hand_back_control': {
          const { tabId, instructions } = message;
          logger.info(`Hand back control requested for tab ${tabId}`);
          try {
            try { if (getCurrentExecutor()) { delete (getCurrentExecutor() as any).__backgroundSubscribed; } } catch {}
            try { await subscribeToExecutorEvents(getCurrentExecutor() as any, getCurrentPort(), taskManager as any, logger as any); } catch {}
            await handBackControl(typeof tabId === 'number' ? tabId : undefined, instructions, getCurrentExecutor(), logger);
            safePostMessage(port, { type: 'success' });
            return;
          } catch (e) {
            logger.error('Failed to hand back control:', e);
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to hand back control' });
            return;
          }
        }
        case 'pause_task': {
          try {
            const current = getCurrentExecutor();
            if (!current) {
              safePostMessage(port, { type: 'error', error: 'No active task to pause' });
              return;
            }
            await (current as any).pause?.();
            safePostMessage(port, { type: 'success' });
          } catch (e) {
            logger.error('Failed to pause task:', e);
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to pause task' });
          }
          return;
        }
        case 'resume_task': {
          try {
            const current = getCurrentExecutor();
            if (!current) {
              safePostMessage(port, { type: 'error', error: 'No active task to resume' });
              return;
            }
            delete (current as any).__backgroundSubscribed;
            try { await subscribeToExecutorEvents(current as any, getCurrentPort(), taskManager as any, logger as any); } catch {}
            await (current as any).resume?.();
            safePostMessage(port, { type: 'success' });
          } catch (e) {
            logger.error('Failed to resume task:', e);
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to resume task' });
          }
          return;
        }
        case 'close_task_tabs': {
          const { taskId } = message;
          try {
            if (!taskId) {
              safePostMessage(port, { type: 'error', error: 'No task ID provided' });
              return;
            }
            logger.info(`[CloseTabs] Requested close_task_tabs for taskId=${taskId}`);
            await closeTaskTabsFn(taskManager as any, String(taskId));
            safePostMessage(port, { type: 'tabs-closed', taskId });
            safePostMessage(port, { type: 'success' });
          } catch (e) {
            logger.error('[CloseTabs] close_task_tabs failed', e);
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to close tabs' });
          }
          return;
        }
        case 'close_task_group': {
          const { groupId } = message;
          try {
            if (typeof groupId !== 'number') {
              safePostMessage(port, { type: 'error', error: 'No group ID provided' });
              return;
            }
            logger.info(`[CloseTabs] Requested close_task_group for groupId=${groupId}`);
            await closeTaskGroupFn(Number(groupId));
            safePostMessage(port, { type: 'tabs-closed', groupId });
            safePostMessage(port, { type: 'success' });
          } catch (e) {
            logger.error('[CloseTabs] close_task_group failed', e);
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to close group tabs' });
          }
          return;
        }
        case 'close_all_tabs_for_session': {
          const { sessionId } = message;
          try {
            if (!sessionId) {
              safePostMessage(port, { type: 'error', error: 'No session ID provided' });
              return;
            }
            logger.info(`[CloseTabs] Requested close_all_tabs_for_session for sessionId=${sessionId}`);
            await closeAllTabsForSessionFn(taskManager as any, String(sessionId));
            safePostMessage(port, { type: 'tabs-closed', sessionId });
            safePostMessage(port, { type: 'success' });
          } catch (e) {
            logger.error('[CloseTabs] close_all_tabs_for_session failed', e);
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to close all tabs for session' });
          }
          return;
        }
        case 'stop_all_mirroring_for_session': {
          const { sessionId } = message;
          try {
            if (!sessionId) {
              safePostMessage(port, { type: 'error', error: 'No session ID provided' });
              return;
            }
            logger.info(`[Mirrors] Requested stop_all_mirroring_for_session for sessionId=${sessionId}`);
            try { await (taskManager as any).tabMirrorService?.stopMirrorsForSession?.(String(sessionId)); } catch {}
            safePostMessage(port, { type: 'success' });
          } catch (e) {
            logger.error('[Mirrors] stop_all_mirroring_for_session failed', e);
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to stop mirroring for session' });
          }
          return;
        }
        case 'stop-agent': {
          try {
            const agentId: any = (message as any)?.data?.agentId;
            if (!agentId) {
              safePostMessage(port, { type: 'error', error: 'No agent ID provided' });
              return;
            }
            await taskManager.cancelTask(String(agentId));
            try { await (taskManager as any).cancelAllForParentSession?.(String(agentId)); } catch {}
            safePostMessage(port, { type: 'success' });
          } catch (e) {
            logger.error('[SidePanel] stop-agent failed', e);
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to stop agent' });
          }
          return;
        }
        case 'kill_all': {
          try {
            logger.info('[KILLSWITCH] Received kill_all command');
            const { handleKillAll } = await import('../killswitch/handler');
            await handleKillAll({
              port,
              logger,
              taskManager,
              workflowsBySession,
              runningWorkflowSessionIds,
              getCurrentExecutor,
              setCurrentExecutor,
              setCurrentWorkflow,
            });
          } catch (e) {
            logger.error('[KILLSWITCH] Handler failed:', e instanceof Error ? e.message : String(e));
            safePostMessage(port, { 
              type: 'kill_all_complete', 
              data: { 
                success: false, 
                killedWorkflows: 0,
                killedTasks: 0,
                killedMirrors: 0,
                error: e instanceof Error ? e.message : 'Killswitch handler failed'
              }
            });
          }
          return;
        }
        case 'get-tab-mirror': {
          sendTabMirror(taskManager as any, port);
          break;
        }
        case 'get-all-mirrors-for-cleanup': {
          try {
            await sendAllMirrorsForCleanup(taskManager as any, port);
          } catch (e) {
            safePostMessage(port, { type: 'tab-mirror-batch-for-cleanup', error: e instanceof Error ? e.message : 'Failed to get mirrors for cleanup' });
            return;
          }
          break;
        }
        case 'preview_visibility': {
          try {
            const { sessionId, visible } = message;
            if (!sessionId || typeof visible !== 'boolean') {
              safePostMessage(port, { type: 'error', error: 'Invalid preview_visibility payload' });
            return;
            }
            setPreviewVisibility(taskManager as any, String(sessionId), !!visible);
            safePostMessage(port, { type: 'success' });
            return;
          } catch (e) {
            safePostMessage(port, { type: 'error', error: e instanceof Error ? e.message : 'Failed to set visibility' });
            return;
          }
        }
        default: {
          try {
            const msgTypeLog = String(((message as any)?.type ?? (message as any)?.messageType) || '');
            logger.error('[SidePanel] default branch (Unknown message type)', { msgType: msgTypeLog, rawType: (message as any)?.type, message });
          } catch {}
          safePostMessage(port, { type: 'error', error: 'Unknown message type' });
            return;
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error handling port message:', error);
      safePostMessage(port, { type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  port.onDisconnect.addListener(async () => {
    logger.info('Side panel disconnected');
    setCurrentPort(null);
    taskManager.setSidePanelPort(undefined);
  });
}


