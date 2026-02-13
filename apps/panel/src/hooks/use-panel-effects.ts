import { useEffect, useRef, type MutableRefObject } from 'react';
import { agentModelStore, generalSettingsStore, chatHistoryStore, secureProviderClient } from '@extension/storage';
import favoritesStorage, { type FavoritePrompt } from '@extension/storage/lib/prompt/favorites';

export function usePanelEffects(params: {
  portRef: MutableRefObject<chrome.runtime.Port | null>;
  sessionIdRef: MutableRefObject<string | null>;
  isReplayingRef: MutableRefObject<boolean>;
  jobActiveRef: MutableRefObject<boolean>;
  isAgentModeActiveRef: MutableRefObject<boolean>;
  promptedOnOpenRef: MutableRefObject<boolean>;
  historyCompletedTimerRef: MutableRefObject<number | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  messagesEndRef: MutableRefObject<HTMLDivElement | null>;
  setInputTextRef: MutableRefObject<((text: string) => void) | null>;
  setSelectedAgentRef: MutableRefObject<((agent: any) => void) | null>;
  setContextTabIdsRef: MutableRefObject<((tabIds: number[]) => void) | null>;
  logger: any;
  setupConnection: () => void;
  stopConnection: () => void;
  setPaletteOpen: (v: boolean) => void;
  setFishMenuOpen: (v: boolean) => void;
  setAgentSettingsOpen: (v: boolean) => void;
  setFeedbackMenuOpen: (v: boolean) => void;
  setMoreMenuOpen: (v: boolean) => void;
  setHasConfiguredModels: (v: boolean | null) => void;
  setHasProviders: (v: boolean | null) => void;
  setReplayEnabled: (v: boolean) => void;
  setDisplayHighlights: (v: boolean) => void;
  setUseVisionState: (v: boolean) => void;
  setShowTabPreviews: (v: boolean) => void;
  setUseFullPlanningPipeline: (v: boolean) => void;
  setEnablePlanner: (v: boolean) => void;
  setEnableValidator: (v: boolean) => void;
  setFavoritePrompts: (v: FavoritePrompt[]) => void;
  setShowJumpToLatest: (v: boolean) => void;
  setShowEmergencyStop: (v: boolean) => void;
  currentSessionId: string | null;
  isReplaying: boolean;
  isJobActive: boolean;
  isAgentModeActive: boolean;
  messages: any[];
  firstRunAccepted: boolean | null;
  disablePerChatWarnings: boolean;
  isFollowUpMode: boolean;
  isHistoricalSession: boolean;
  showTabPreviews: boolean;
  resetPerChatAcceptance?: () => void;
  promptPerChatIfEnabled?: () => Promise<boolean>;
  ensurePerChatBeforeNewSession?: (isFollowUpMode: boolean, hasSessionId: boolean) => Promise<void>;
  handleSendMessage?: (text: string) => void;
  appendMessage?: (message: any, sessionId?: string | null) => void;
}) {
  const {
    portRef,
    sessionIdRef,
    isReplayingRef,
    jobActiveRef,
    isAgentModeActiveRef,
    promptedOnOpenRef,
    historyCompletedTimerRef,
    panelRef,
    messagesEndRef,
    setInputTextRef,
    setSelectedAgentRef,
    setContextTabIdsRef,
    logger,
    setupConnection,
    stopConnection,
    setPaletteOpen,
    setFishMenuOpen,
    setAgentSettingsOpen,
    setFeedbackMenuOpen,
    setMoreMenuOpen,
    setHasConfiguredModels,
    setHasProviders,
    setReplayEnabled,
    setDisplayHighlights,
    setUseVisionState,
    setShowTabPreviews,
    setUseFullPlanningPipeline,
    setEnablePlanner,
    setEnableValidator,
    setFavoritePrompts,
    setShowJumpToLatest,
    setShowEmergencyStop,
    currentSessionId,
    isReplaying,
    isJobActive,
    isAgentModeActive,
    messages,
    firstRunAccepted,
    disablePerChatWarnings,
    isFollowUpMode,
    isHistoricalSession,
    showTabPreviews,
    resetPerChatAcceptance,
    promptPerChatIfEnabled,
    ensurePerChatBeforeNewSession,
    handleSendMessage,
    appendMessage,
  } = params;

  // Sync refs
  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId, sessionIdRef]);
  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying, isReplayingRef]);
  useEffect(() => {
    isAgentModeActiveRef.current = isAgentModeActive;
  }, [isAgentModeActive, isAgentModeActiveRef]);
  useEffect(() => {
    jobActiveRef.current = isJobActive;
  }, [isJobActive, jobActiveRef]);

  // Establish connection on mount - this sends panel_opened to background
  // which allows the background to restore any running workflows
  useEffect(() => {
    if (!portRef.current) {
      setupConnection();
    }
  }, [portRef, setupConnection]);

  // Configuration checking
  useEffect(() => {
    const check = async () => {
      try {
        const configured = await agentModelStore.getConfiguredAgents();
        setHasConfiguredModels(configured.length > 0);
        try {
          const providers = await secureProviderClient.getAllProviders();
          setHasProviders(Object.keys(providers || {}).length > 0);
        } catch {
          setHasProviders(false);
        }
      } catch (error) {
        logger.error('Error checking model configuration:', error);
        setHasConfiguredModels(false);
        setHasProviders(false);
      }
    };
    check();
    const handleVisibilityChange = () => {
      if (!document.hidden) check();
    };
    const handleFocus = () => check();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [logger, setHasConfiguredModels, setHasProviders]);

  // Check for pending session navigation from agent manager
  useEffect(() => {
    const checkPendingSession = async () => {
      try {
        const result = await chrome.storage.local.get(['pending_sidepanel_session', 'pending_sidepanel_timestamp']);
        if (result.pending_sidepanel_session) {
          const age = Date.now() - (result.pending_sidepanel_timestamp || 0);
          // Only navigate if the request is recent (within 5 seconds)
          if (age < 5000) {
            // Dispatch event for session navigation - handled by useChatHistory
            document.dispatchEvent(
              new CustomEvent('navigate-to-session', { detail: { sessionId: result.pending_sidepanel_session } }),
            );
          }
          // Clear the pending state
          await chrome.storage.local.remove(['pending_sidepanel_session', 'pending_sidepanel_timestamp']);
        }
      } catch (e) {
        logger.error('Error checking pending session:', e);
      }
    };

    // Check on mount
    checkPendingSession();

    // Listen for storage changes (when sidepanel is already open)
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && changes.pending_sidepanel_session?.newValue) {
        checkPendingSession();
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [logger]);

  // Check for pending context menu actions (on mount and on storage change)
  // Use ref to track firstRunAccepted for retry logic (avoids stale closure)
  const firstRunAcceptedRef = useRef(firstRunAccepted);
  useEffect(() => {
    firstRunAcceptedRef.current = firstRunAccepted;
  }, [firstRunAccepted]);

  useEffect(() => {
    let retryCount = 0;
    const MAX_RETRIES = 20; // 20 * 100ms = 2 seconds max wait
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const processPendingAction = async () => {
      try {
        const result = await chrome.storage.session.get('pendingAction');
        const pendingAction = result.pendingAction as
          | {
              prompt: string;
              autoStart: boolean;
              workflowType?: string;
              contextTabId?: number;
              contextTabIds?: number[];
              errorMessage?: string;
              contextMenuAction?: string;
              infoMessage?: string;
              forceNewSession?: boolean;
              requireWarningCheck?: boolean; // When true, show per-chat warning before auto-starting
            }
          | undefined;
        if (pendingAction) {
          // For auto-start tasks, wait for disclaimer states to be loaded
          // Use ref to get current value (avoids stale closure in retry)
          if (pendingAction.autoStart && firstRunAcceptedRef.current === null) {
            if (retryCount < MAX_RETRIES) {
              retryCount++;
              retryTimeout = setTimeout(processPendingAction, 100);
              return;
            }
            // Max retries reached, proceed anyway
            logger.error('Pending action: disclaimer states not loaded after max retries');
          }

          await chrome.storage.session.remove('pendingAction');
          retryCount = 0;

          // Handle error messages (e.g., restricted page errors) - blocks execution
          if (pendingAction.errorMessage) {
            if (appendMessage) {
              appendMessage({ actor: 'system', content: pendingAction.errorMessage, timestamp: Date.now() });
            }
            return;
          }

          // If forceNewSession, dispatch event to clear current session
          if (pendingAction.forceNewSession) {
            // For requireWarningCheck, don't preserve acceptance - we'll handle the warning explicitly
            const shouldPreserveAcceptance = pendingAction.autoStart && !pendingAction.requireWarningCheck;
            document.dispatchEvent(
              new CustomEvent('force-new-session', {
                detail: { preservePerChatAcceptance: shouldPreserveAcceptance },
              }),
            );
            // Longer delay for requireWarningCheck to ensure handleNewChat completes
            await new Promise(r => setTimeout(r, pendingAction.requireWarningCheck ? 150 : 50));
          }

          // Handle info messages (e.g., context unavailable) - shows but continues
          if (pendingAction.infoMessage && appendMessage) {
            appendMessage({ actor: 'system', content: pendingAction.infoMessage, timestamp: Date.now() });
          }

          // Set the workflow type if specified (e.g., 'chat')
          if (pendingAction.workflowType && setSelectedAgentRef.current) {
            setSelectedAgentRef.current(pendingAction.workflowType as any);
          }

          if (pendingAction.autoStart && handleSendMessage) {
            // For actions requiring warning check, show disclaimer and wait for acceptance
            if (pendingAction.requireWarningCheck && ensurePerChatBeforeNewSession) {
              // Reset acceptance state and show warning (handleNewChat should have done this,
              // but we ensure it here in case of timing issues)
              if (resetPerChatAcceptance) {
                resetPerChatAcceptance();
              }
              // Show per-chat warning and wait for acceptance before executing
              await ensurePerChatBeforeNewSession(false, false);
            }

            // Submit the task
            const contextTabs =
              pendingAction.contextTabIds || (pendingAction.contextTabId ? [pendingAction.contextTabId] : undefined);
            // Small delay to let UI update
            setTimeout(() => {
              (handleSendMessage as any)(
                pendingAction.prompt,
                pendingAction.workflowType || 'chat',
                contextTabs,
                pendingAction.contextMenuAction,
              );
            }, 50);
          } else {
            // For manual actions (panel opened but not auto-run), set input and context tabs in UI
            const contextTabs =
              pendingAction.contextTabIds || (pendingAction.contextTabId ? [pendingAction.contextTabId] : undefined);
            if (contextTabs && setContextTabIdsRef.current) {
              setContextTabIdsRef.current(contextTabs);
            }
            if (setInputTextRef.current) {
              setInputTextRef.current(pendingAction.prompt);
            }
          }
        }
      } catch (error) {
        logger.error('Error checking pending action:', error);
      }
    };

    // Check on mount
    processPendingAction();

    // Listen for new pending actions (when panel is already open)
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'session' && changes.pendingAction?.newValue) {
        retryCount = 0;
        if (retryTimeout) clearTimeout(retryTimeout);
        processPendingAction();
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [
    logger,
    setInputTextRef,
    setSelectedAgentRef,
    setContextTabIdsRef,
    handleSendMessage,
    appendMessage,
    ensurePerChatBeforeNewSession,
  ]);

  // Settings loading + live subscription (so tool workflow changes reflect in UI)
  useEffect(() => {
    const load = async () => {
      try {
        const settings = await (generalSettingsStore as any)?.getSettings?.();
        if (!settings) return;
        setReplayEnabled(settings.replayHistoricalTasks || false);
        setDisplayHighlights(settings.displayHighlights || false);
        setUseVisionState(settings.useVision || false);
        setShowTabPreviews(settings.showTabPreviews ?? true);
        setUseFullPlanningPipeline(settings.useFullPlanningPipeline || false);
        setEnablePlanner(settings.enablePlanner || false);
        setEnableValidator(settings.enableValidator || false);
        setShowEmergencyStop(settings.showEmergencyStop ?? true);
      } catch (error) {
        logger.error('Error loading general settings:', error);
      }
    };
    load();
    // Subscribe to live changes so settings updated via tool workflow reflect immediately
    let unsub: (() => void) | undefined;
    try {
      unsub = (generalSettingsStore as any).subscribe?.(load);
    } catch {}
    return () => {
      unsub?.();
    };
  }, [
    logger,
    setReplayEnabled,
    setDisplayHighlights,
    setUseVisionState,
    setShowTabPreviews,
    setUseFullPlanningPipeline,
    setEnablePlanner,
    setEnableValidator,
    setShowEmergencyStop,
  ]);

  // Per-chat disclaimer
  // Skip showing disclaimer if there's a pending auto-start task (shortcut/omnibox/context menu)
  useEffect(() => {
    const checkAndShowDisclaimer = async () => {
      try {
        if (firstRunAccepted !== true) return;
        if (promptedOnOpenRef.current) return;
        const isStartingFresh = !sessionIdRef.current && !isFollowUpMode && !isHistoricalSession;
        if (!isStartingFresh || disablePerChatWarnings) return;

        // CRITICAL: Check for pending auto-start tasks before showing disclaimer
        // This prevents the disclaimer from appearing when user triggers action via shortcut/omnibox
        try {
          const result = await chrome.storage.session.get('pendingAction');
          const pendingAction = result.pendingAction as { autoStart?: boolean } | undefined;
          if (pendingAction?.autoStart) {
            // Auto-start task pending - skip disclaimer, it will be preserved by handleNewChat
            promptedOnOpenRef.current = true;
            return;
          }
        } catch {}

        promptedOnOpenRef.current = true;
        resetPerChatAcceptance?.();
        await promptPerChatIfEnabled?.();
      } catch {}
    };
    checkAndShowDisclaimer();
  }, [
    firstRunAccepted,
    disablePerChatWarnings,
    isFollowUpMode,
    isHistoricalSession,
    resetPerChatAcceptance,
    promptPerChatIfEnabled,
    promptedOnOpenRef,
    sessionIdRef,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  // Close menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-dropdown]')) {
        setFishMenuOpen(false);
        setAgentSettingsOpen(false);
        setFeedbackMenuOpen(false);
        setMoreMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFishMenuOpen(false);
        setAgentSettingsOpen(false);
        setFeedbackMenuOpen(false);
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [setFishMenuOpen, setAgentSettingsOpen, setFeedbackMenuOpen, setMoreMenuOpen]);

  // History context check
  useEffect(() => {
    const check = () => {
      try {
        portRef.current?.postMessage({ type: 'check_history_context' });
      } catch {}
    };
    check();
    const timer = setTimeout(check, 1000);
    return () => clearTimeout(timer);
  }, [portRef]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (historyCompletedTimerRef.current) clearTimeout(historyCompletedTimerRef.current);
    };
  }, [historyCompletedTimerRef]);

  // Preview requests
  useEffect(() => {
    if (!(isJobActive && (showTabPreviews ?? true))) return;
    const interval = window.setInterval(() => {
      try {
        if (portRef.current?.name === 'side-panel-connection') {
          portRef.current.postMessage({ type: 'get-tab-mirror' });
        }
      } catch {}
    }, 500);
    return () => window.clearInterval(interval);
  }, [isJobActive, showTabPreviews, portRef]);

  // Load favorites
  useEffect(() => {
    const load = async () => {
      try {
        let prompts = await favoritesStorage.getAllPrompts();
        if (prompts.length === 0) {
          await favoritesStorage.addPrompt('Weather', 'What is the current weather in Cambridge UK?', 'search');
          await favoritesStorage.addPrompt(
            'Shopping',
            "Navigate to the Nike website and find the latest women's running shoes",
            'agent',
          );
          prompts = await favoritesStorage.getAllPrompts();
        }
        setFavoritePrompts(prompts);
      } catch (error) {
        logger.error('Failed to load favorite prompts:', error);
      }
    };
    load();
  }, [logger, setFavoritePrompts]);

  // Export session handler
  useEffect(() => {
    const handler = async (e: Event) => {
      const sessionId = (e as CustomEvent).detail?.sessionId;
      if (!sessionId) return;
      try {
        const session = await chatHistoryStore.getSession(sessionId);
        if (!session) return;
        const md = `# ${session.title}\n\n` + session.messages.map(m => `**${m.actor}**: ${m.content}`).join('\n\n');
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${session.title.replace(/[^a-z0-9\-]+/gi, '_')}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        logger.error('Export failed', err);
      }
    };
    document.addEventListener('export-session-markdown', handler as EventListener);
    return () => document.removeEventListener('export-session-markdown', handler as EventListener);
  }, [logger]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        if (portRef.current?.name === 'side-panel-connection' && sessionIdRef.current) {
          portRef.current.postMessage({ type: 'preview_visibility', sessionId: sessionIdRef.current, visible: false });
        }
      } catch {}
      stopConnection();
    };
  }, [stopConnection, portRef, sessionIdRef]);

  // Jump-to-latest visibility tracking only
  // NOTE: We intentionally do NOT auto-scroll here. The previous auto-scroll logic
  // conflicted with Virtuoso's internal scroll management when using customScrollParent,
  // causing the scroll position to jump unexpectedly during workflow execution.
  // Users can use the "Jump to latest" button to manually scroll to the bottom.
  useEffect(() => {
    const container = panelRef.current?.querySelector('.messages-scroll') as HTMLElement | null;
    if (!container) return;
    const onScroll = () => {
      setShowJumpToLatest(container.scrollHeight - container.scrollTop - container.clientHeight >= 80);
    };
    container.addEventListener('scroll', onScroll);
    onScroll();
    return () => container.removeEventListener('scroll', onScroll);
  }, [panelRef, setShowJumpToLatest]);
}
