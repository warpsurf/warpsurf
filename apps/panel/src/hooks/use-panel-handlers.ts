import { useCallback, useRef, type MutableRefObject } from 'react';
import { Actors, chatHistoryStore, generalSettingsStore } from '@extension/storage';
import favoritesStorage, { type FavoritePrompt } from '@extension/storage/lib/prompt/favorites';
import type { AgentType } from '../components/chat-interface/chat-input';
import type { PaletteAction } from '../components/header/command-palette';

// Timeout for cancel confirmation before escalating to kill_all
const CANCEL_TIMEOUT_MS = 5000;

export function usePanelHandlers(params: {
  portRef: MutableRefObject<chrome.runtime.Port | null>;
  sessionIdRef: MutableRefObject<string | null>;
  agentSettingsRef: MutableRefObject<HTMLDivElement | null>;
  setInputTextRef: MutableRefObject<((text: string) => void) | null>;
  setSelectedAgentRef: MutableRefObject<((agent: any) => void) | null>;
  processedJobSummariesRef: MutableRefObject<Set<string>>;
  lastAgentMessageRef: MutableRefObject<any>;
  agentTraceActiveRef: MutableRefObject<boolean>;
  // Refs for cancellation state management
  isCancellingRef: MutableRefObject<boolean>;
  cancelTimeoutRef: MutableRefObject<number | null>;
  logger: any;
  showToast: (msg: string) => void;
  stopConnection: () => void;
  setupConnection: () => void;
  appendMessage: (msg: any, sessionId?: string | null) => void;
  loadChatSessions: () => Promise<void>;
  handleSessionSelectHook: (sessionId: string) => Promise<boolean>;
  handleSessionBookmarkFromHook: (sessionId: string) => Promise<void>;
  resetPerChatAcceptance: () => void;
  promptPerChatIfEnabled: () => void;
  setMessages: (v: any) => void;
  setCurrentSessionId: (v: string | null) => void;
  setShowDashboard: (v: boolean) => void;
  setForceChatView: (v: boolean) => void;
  setInputEnabled: (v: boolean) => void;
  setShowStopButton: (v: boolean) => void;
  setIsFollowUpMode: (v: boolean) => void;
  setIsAgentModeActive: (v: boolean) => void;
  setCurrentTaskAgentType: (v: string | null) => void;
  setAgentTraceRootId: (v: string | null) => void;
  setMessageMetadata: (v: any) => void;
  setShowCloseTabs: (v: boolean) => void;
  setIsPaused: (v: boolean) => void;
  setMirrorPreview: (v: any) => void;
  setMirrorPreviewBatch: (v: any[]) => void;
  setHasFirstPreview: (v: boolean) => void;
  setSessionStats: (v: any) => void;
  setRequestSummaries: (v: any) => void;
  setIsHistoricalSession: (v: boolean) => void;
  setPinnedMessageIds: (v: Set<string>) => void;
  setActiveAggregateMessageId: (v: string | null) => void;
  setShowHistory: (v: boolean) => void;
  setIsJobActive: (v: boolean) => void;
  setShowPopulations: (v: boolean) => void;
  setFavoritePrompts: (v: FavoritePrompt[]) => void;
  setAgentSettingsOpen: (v: boolean) => void;
  setHistoryContextLoading: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setIsStopping: (v: boolean) => void;
  workerTabGroups: any[];
  currentTaskAgentType: string | null;
  pinnedMessageIds: Set<string>;
}) {
  const {
    portRef,
    sessionIdRef,
    agentSettingsRef,
    setInputTextRef,
    setSelectedAgentRef,
    processedJobSummariesRef,
    lastAgentMessageRef,
    agentTraceActiveRef,
    isCancellingRef,
    cancelTimeoutRef,
    logger,
    showToast,
    stopConnection,
    setupConnection,
    appendMessage,
    loadChatSessions,
    handleSessionSelectHook,
    handleSessionBookmarkFromHook,
    resetPerChatAcceptance,
    promptPerChatIfEnabled,
    setMessages,
    setCurrentSessionId,
    setShowDashboard,
    setForceChatView,
    setInputEnabled,
    setShowStopButton,
    setIsFollowUpMode,
    setIsAgentModeActive,
    setCurrentTaskAgentType,
    setAgentTraceRootId,
    setMessageMetadata,
    setShowCloseTabs,
    setIsPaused,
    setMirrorPreview,
    setMirrorPreviewBatch,
    setHasFirstPreview,
    setSessionStats,
    setRequestSummaries,
    setIsHistoricalSession,
    setPinnedMessageIds,
    setActiveAggregateMessageId,
    setShowHistory,
    setIsJobActive,
    setShowPopulations,
    setFavoritePrompts,
    setAgentSettingsOpen,
    setHistoryContextLoading,
    setPaletteOpen,
    setIsStopping,
    workerTabGroups,
    currentTaskAgentType,
    pinnedMessageIds,
  } = params;

  // Ref to hold the killswitch function for use in timeout callbacks (avoids circular dependency)
  const killSwitchFnRef = useRef<(() => Promise<void>) | null>(null);

  const handleNewChat = useCallback(
    (preservePerChatAcceptance?: boolean) => {
      try {
        const prevSid = sessionIdRef.current;
        if (prevSid && portRef.current?.name === 'side-panel-connection') {
          portRef.current.postMessage({ type: 'stop_all_mirroring_for_session', sessionId: prevSid });
        }
      } catch {}
      // Only reset per-chat acceptance if not preserving it (e.g., for auto-start tasks)
      if (!preservePerChatAcceptance) {
        resetPerChatAcceptance();
        promptPerChatIfEnabled();
      }
      setMessages([]);
      setCurrentSessionId(null);
      setShowDashboard(false);
      setForceChatView(false);
      sessionIdRef.current = null;
      setInputEnabled(true);
      setShowStopButton(false);
      setIsFollowUpMode(false);
      setIsAgentModeActive(false);
      setCurrentTaskAgentType(null);
      setAgentTraceRootId(null);
      agentTraceActiveRef.current = false;
      setMessageMetadata({});
      setShowCloseTabs(false);
      setIsPaused(false);
      setMirrorPreview(null);
      setMirrorPreviewBatch([]);
      setHasFirstPreview(false);
      setSessionStats({
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalLatency: 0,
        totalCost: 0,
        avgLatencyPerRequest: 0,
      });
      setRequestSummaries({});
      setIsHistoricalSession(false);
      processedJobSummariesRef.current.clear();
      lastAgentMessageRef.current = null;
      // Note: Don't disconnect/reconnect here - it would trigger restore_active_session
      // which would override the new chat state. Just keep the existing connection.
    },
    [
      sessionIdRef,
      agentTraceActiveRef,
      processedJobSummariesRef,
      lastAgentMessageRef,
      resetPerChatAcceptance,
      promptPerChatIfEnabled,
      setMessages,
      setCurrentSessionId,
      setShowDashboard,
      setForceChatView,
      setInputEnabled,
      setShowStopButton,
      setIsFollowUpMode,
      setIsAgentModeActive,
      setCurrentTaskAgentType,
      setAgentTraceRootId,
      setMessageMetadata,
      setShowCloseTabs,
      setIsPaused,
      setMirrorPreview,
      setMirrorPreviewBatch,
      setHasFirstPreview,
      setSessionStats,
      setRequestSummaries,
      setIsHistoricalSession,
    ],
  );

  /**
   * handleStopTask: Confirmation-based cancellation with timeout escalation
   * - Sends cancel_task to backend
   * - Waits for cancel_task_result confirmation
   * - If no confirmation within CANCEL_TIMEOUT_MS, escalates to handleKillSwitch
   * - Prevents duplicate cancellations via isCancellingRef
   */
  const handleStopTask = useCallback(async () => {
    // Prevent multiple concurrent cancellations
    if (isCancellingRef.current) {
      logger.debug('[StopTask] Cancellation already in progress, ignoring');
      return;
    }

    const requestId = Date.now().toString();
    isCancellingRef.current = true;
    setIsStopping(true);

    try {
      // Set up timeout to escalate to kill_all if no confirmation arrives
      const timeoutId = window.setTimeout(() => {
        if (isCancellingRef.current) {
          logger.warn('[StopTask] Cancellation timed out after ' + CANCEL_TIMEOUT_MS + 'ms, escalating to kill_all');
          appendMessage({
            actor: Actors.SYSTEM,
            content: 'Stop request timed out. Forcing emergency stop...',
            timestamp: Date.now(),
          });
          // Reset cancellation state before escalating
          isCancellingRef.current = false;
          setIsStopping(false);
          // Escalate to nuclear option via ref (avoids circular dependency)
          killSwitchFnRef.current?.();
        }
      }, CANCEL_TIMEOUT_MS);

      cancelTimeoutRef.current = timeoutId;

      // Ensure connection exists before sending
      if (!portRef.current) {
        setupConnection();
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      if (!portRef.current) {
        throw new Error('Cannot connect to background service');
      }

      portRef.current.postMessage({
        type: 'cancel_task',
        taskId: sessionIdRef.current || undefined,
        sessionId: sessionIdRef.current || undefined,
        requestId, // Track this specific request
      });

      logger.log('[StopTask] Sent cancel_task request', { sessionId: sessionIdRef.current, requestId });

      // NOTE: UI state updates are now handled by onCancelTaskResult handler
      // NOT here - we wait for backend confirmation
    } catch (err) {
      // Clear timeout on error
      if (cancelTimeoutRef.current) {
        clearTimeout(cancelTimeoutRef.current);
        cancelTimeoutRef.current = null;
      }
      isCancellingRef.current = false;
      setIsStopping(false);

      logger.error('cancel_task error', err instanceof Error ? err.message : String(err));
      appendMessage({
        actor: Actors.SYSTEM,
        content: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });

      // On error, still update UI to allow retry
      setInputEnabled(true);
    }
  }, [
    portRef,
    sessionIdRef,
    isCancellingRef,
    cancelTimeoutRef,
    killSwitchFnRef,
    logger,
    appendMessage,
    setIsStopping,
    setInputEnabled,
  ]);

  const handleClearChat = useCallback(async () => {
    try {
      setMessages([]);
      setIsHistoricalSession(false);
      setShowHistory(false);
      setInputEnabled(true);
      setRequestSummaries({});
      setMessageMetadata({});
      setSessionStats({
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalLatency: 0,
        totalCost: 0,
        avgLatencyPerRequest: 0,
      });
      setPinnedMessageIds(new Set());
      setActiveAggregateMessageId(null);
      setHasFirstPreview(false);
      setMirrorPreview(null);
      setMirrorPreviewBatch([]);
      setShowCloseTabs(false);
      setIsJobActive(false);
      setForceChatView(true);
      const sid = sessionIdRef.current;
      if (sid) {
        await chatHistoryStore.clearSession(sid);
        try {
          const result = await chrome.storage.local.get(['agent_dashboard_running', 'agent_dashboard_completed']);
          await chrome.storage.local.set({
            agent_dashboard_running: (result.agent_dashboard_running || []).filter(
              (a: any) => String(a?.sessionId) !== String(sid),
            ),
            agent_dashboard_completed: (result.agent_dashboard_completed || []).filter(
              (a: any) => String(a?.sessionId) !== String(sid),
            ),
          });
        } catch {}
      }
      showToast('Chat cleared');
    } catch (e) {
      logger.error('Clear chat failed', e);
      showToast('Failed to clear chat');
    }
  }, [
    sessionIdRef,
    logger,
    showToast,
    setMessages,
    setIsHistoricalSession,
    setShowHistory,
    setInputEnabled,
    setRequestSummaries,
    setMessageMetadata,
    setSessionStats,
    setPinnedMessageIds,
    setActiveAggregateMessageId,
    setHasFirstPreview,
    setMirrorPreview,
    setMirrorPreviewBatch,
    setShowCloseTabs,
    setIsJobActive,
    setForceChatView,
  ]);

  const handlePauseTask = useCallback(async () => {
    try {
      portRef.current?.postMessage({ type: 'pause_task' });
      setIsPaused(true);
    } catch (e) {
      logger.error('pause_task error', e);
    }
  }, [portRef, setIsPaused, logger]);

  const handleResumeTask = useCallback(async () => {
    try {
      portRef.current?.postMessage({ type: 'resume_task' });
      setIsPaused(false);
    } catch (e) {
      logger.error('resume_task error', e);
    }
  }, [portRef, setIsPaused, logger]);

  const handleLoadHistory = useCallback(async () => {
    await loadChatSessions();
    setShowHistory(true);
    setShowDashboard(false);
  }, [loadChatSessions, setShowHistory, setShowDashboard]);

  const handleLoadDashboard = useCallback(async () => {
    await loadChatSessions();
    setShowDashboard(true);
    setShowHistory(false);
  }, [loadChatSessions, setShowDashboard, setShowHistory]);

  const handleBackToChat = useCallback(
    (reset = false) => {
      setShowHistory(false);
      setShowDashboard(false);
      setShowPopulations(false);
      if (reset) {
        setCurrentSessionId(null);
        setMessages([]);
        setIsFollowUpMode(false);
        setIsHistoricalSession(false);
      }
    },
    [
      setShowHistory,
      setShowDashboard,
      setShowPopulations,
      setCurrentSessionId,
      setMessages,
      setIsFollowUpMode,
      setIsHistoricalSession,
    ],
  );

  const handleSessionSelect = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const ok = await handleSessionSelectHook(sessionId);
      if (ok) setShowHistory(false);
      return ok;
    },
    [handleSessionSelectHook, setShowHistory],
  );

  const handleSessionBookmark = useCallback(
    async (sessionId: string) => {
      try {
        await handleSessionBookmarkFromHook(sessionId);
        handleBackToChat(true);
      } catch (error) {
        logger.error('Failed to pin session to favorites:', error);
      }
    },
    [handleSessionBookmarkFromHook, handleBackToChat, logger],
  );

  const handleBookmarkSelect = useCallback(
    (content: string, agentType?: AgentType) => {
      if (setInputTextRef.current) setInputTextRef.current(content);
      if (agentType && setSelectedAgentRef.current) setSelectedAgentRef.current(agentType);
    },
    [setInputTextRef, setSelectedAgentRef],
  );

  const handleBookmarkDelete = useCallback(
    async (id: number) => {
      try {
        await favoritesStorage.removePrompt(id);
        setFavoritePrompts(await favoritesStorage.getAllPrompts());
      } catch (error) {
        logger.error('Failed to delete favorite prompt:', error);
      }
    },
    [logger, setFavoritePrompts],
  );

  const handleBookmarkReorder = useCallback(
    async (draggedId: number, targetId: number) => {
      try {
        await favoritesStorage.reorderPrompts(draggedId, targetId);
        setFavoritePrompts(await favoritesStorage.getAllPrompts());
      } catch (error) {
        logger.error('Failed to reorder favorite prompts:', error);
      }
    },
    [logger, setFavoritePrompts],
  );

  const handlePinMessage = useCallback(
    (messageId: string) => {
      const next = new Set(pinnedMessageIds);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      setPinnedMessageIds(next);
    },
    [setPinnedMessageIds, pinnedMessageIds],
  );

  const handleQuoteMessage = useCallback(
    (text: string) => {
      if (setInputTextRef.current) {
        const quoted = `> ${text
          .split('\n')
          .map(l => l.trim())
          .slice(0, 3)
          .join('\n> ')}\n\n`;
        setInputTextRef.current(quoted);
      }
    },
    [setInputTextRef],
  );

  const handleOpenSettings = useCallback(
    async (tab?: 'api-keys' | 'workflow-settings' | 'web-settings' | 'warnings' | 'help') => {
      try {
        if (tab) await chrome.storage.local.set({ 'settings.pendingTab': tab });
        chrome.runtime.openOptionsPage();
      } catch {}
    },
    [],
  );

  const handleOpenApiKeys = useCallback(() => handleOpenSettings('api-keys'), [handleOpenSettings]);
  const handleOpenWorkflowSettings = useCallback(() => handleOpenSettings('workflow-settings'), [handleOpenSettings]);

  const handleOpenAgentSettings = useCallback(() => {
    try {
      setAgentSettingsOpen(true);
      agentSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch {}
  }, [setAgentSettingsOpen, agentSettingsRef]);

  const handleRefreshHistoryContext = useCallback(async () => {
    try {
      const settings = await generalSettingsStore.getSettings();
      if (!settings.enableHistoryContext) {
        showToast('History context is disabled. Enable it in Settings.');
        return;
      }
      if (!portRef.current) {
        setupConnection();
        await new Promise(resolve => setTimeout(resolve, 200));
        if (!portRef.current) {
          showToast('Failed to establish connection. Please try again.');
          return;
        }
      }
      setHistoryContextLoading(true);
      portRef.current.postMessage({ type: 'summarise_history', windowHours: settings.historySummaryWindowHours || 24 });
    } catch (e) {
      setHistoryContextLoading(false);
      showToast('Failed to analyze history: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
  }, [showToast, setupConnection, setHistoryContextLoading, portRef]);

  const handlePaletteSelect = useCallback(
    (action: PaletteAction) => {
      if (action.type === 'switch-agent') {
        if (setSelectedAgentRef.current) setSelectedAgentRef.current(action.agent);
      } else if (action.type === 'open-options') {
        chrome.runtime.openOptionsPage();
      }
      setPaletteOpen(false);
    },
    [setPaletteOpen, setSelectedAgentRef],
  );

  /** Internal killswitch - used by direct invocation and timeout escalation */
  const handleKillSwitchInternal = useCallback(async () => {
    // Clear any pending cancel state
    if (cancelTimeoutRef.current) {
      clearTimeout(cancelTimeoutRef.current);
      cancelTimeoutRef.current = null;
    }
    isCancellingRef.current = false;
    setIsStopping(false);

    appendMessage({
      actor: Actors.SYSTEM,
      content: '**Emergency stop activated** - All extension activity is being terminated...',
      timestamp: Date.now(),
    });

    // Send kill command - UI updates happen in onKillAllComplete handler
    const sendKill = (port: chrome.runtime.Port) => {
      try {
        port.postMessage({ type: 'kill_all' });
      } catch {
        setIsJobActive(false);
        setInputEnabled(true);
        setShowStopButton(false);
      }
    };

    if (portRef.current) {
      sendKill(portRef.current);
    } else {
      try {
        const tempPort = chrome.runtime.connect({ name: 'side-panel-connection' });
        sendKill(tempPort);
        setTimeout(() => {
          try {
            tempPort.disconnect();
          } catch {}
        }, 1000);
      } catch {
        setIsJobActive(false);
        setInputEnabled(true);
        setShowStopButton(false);
      }
    }

    // Clear tracking state
    processedJobSummariesRef?.current?.clear();
    if (lastAgentMessageRef) lastAgentMessageRef.current = null;
    if (agentTraceActiveRef) agentTraceActiveRef.current = false;

    showToast('Emergency stop activated');
  }, [
    portRef,
    appendMessage,
    showToast,
    processedJobSummariesRef,
    lastAgentMessageRef,
    agentTraceActiveRef,
    isCancellingRef,
    cancelTimeoutRef,
    setIsStopping,
    setIsJobActive,
    setInputEnabled,
    setShowStopButton,
  ]);

  // Store killswitch function in ref for handleStopTask's timeout callback
  killSwitchFnRef.current = handleKillSwitchInternal;

  /** KILLSWITCH: Emergency stop of ALL extension activity */
  const handleKillSwitch = useCallback(async () => {
    logger.log('[KILLSWITCH] User activated emergency kill switch');
    await handleKillSwitchInternal();
  }, [handleKillSwitchInternal, logger]);

  return {
    handleNewChat,
    handleStopTask,
    handleClearChat,
    handlePauseTask,
    handleResumeTask,
    handleLoadHistory,
    handleLoadDashboard,
    handleBackToChat,
    handleSessionSelect,
    handleSessionBookmark,
    handleBookmarkSelect,
    handleBookmarkDelete,
    handleBookmarkReorder,
    handlePinMessage,
    handleQuoteMessage,
    handleOpenSettings,
    handleOpenApiKeys,
    handleOpenWorkflowSettings,
    handleOpenAgentSettings,
    handleRefreshHistoryContext,
    handlePaletteSelect,
    handleKillSwitch,
  };
}
