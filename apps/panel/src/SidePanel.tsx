/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import { type Message } from '@extension/storage';
import favoritesStorage, { type FavoritePrompt } from '@extension/storage/lib/prompt/favorites';
const CommandPalette = lazy(() => import('./components/header/command-palette'));
import { AgentType } from './components/chat-interface/chat-input';
import ChatHistoryList from './components/history/chat-history-list';
import { AgentDashboard } from './components/history/agent-dashboard';
import SetupChecklist from './components/setup/setup-checklist';
import PopulationChart from './components/fish/population-chart';
import WorkflowGraphSection from './components/multiagent-visualization/visualization-section';
import WorkflowGraphModal from './components/multiagent-visualization/visualization-modal';
import './SidePanel.css';
import Branding from './components/header/branding';
import HeaderActions from './components/header/header-actions';
import FishOverlay, { type FishOverlayHandle } from '@src/components/fish/fish-overlay';
import DisplayMode from './components/fish/display-mode';
import { createLogger } from './utils/index';
import { useToast } from './hooks/use-toast';
import { useDarkMode } from './hooks/use-dark-mode';
import { useAgentOrdinals } from './hooks/use-agent-ordinals';
import { useBackgroundConnection } from './hooks/use-background-connection';
import { useDisclaimerGates } from './hooks/use-disclaimer-gates';
import { useHistoryPrivacyGate } from './hooks/use-history-privacy-gate';
import { useAutoTabContextPrivacyGate } from './hooks/use-auto-tab-context-privacy-gate';
import { generalSettingsStore, warningsSettingsStore, chatHistoryStore, type ContextTabInfo } from '@extension/storage';
import { createMessageSender } from './logic/message-sender';
import { useVersionInfo } from './hooks/use-version-info';
import { useChatHistory } from '@src/hooks/use-chat-history';
import { ChatScreen } from './screens/ChatScreen';
import { usePanelHandlers } from './hooks/use-panel-handlers';
import { usePanelEffects } from './hooks/use-panel-effects';
import { useEventSetup } from './hooks/use-event-setup';

const SidePanel = () => {
  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputEnabled, setInputEnabled] = useState(true);
  const [showStopButton, setShowStopButton] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [runningAgentsCount, setRunningAgentsCount] = useState(0);
  const [showPopulations, setShowPopulations] = useState(false);
  const [isFollowUpMode, setIsFollowUpMode] = useState(false);
  const [isHistoricalSession, setIsHistoricalSession] = useState(false);
  const [favoritePrompts, setFavoritePrompts] = useState<FavoritePrompt[]>([]);
  const [hasConfiguredModels, setHasConfiguredModels] = useState<boolean | null>(null);
  const [hasProviders, setHasProviders] = useState<boolean | null>(null);
  const [sessionStats, setSessionStats] = useState({
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalLatency: 0,
    totalCost: 0,
    avgLatencyPerRequest: 0,
  });
  const [compactMode, setCompactMode] = useState(true);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [showInlineWorkflow, setShowInlineWorkflow] = useState<boolean>(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<string>>(new Set());
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [showCloseTabs, setShowCloseTabs] = useState(false);
  const [workerTabGroups, setWorkerTabGroups] = useState<any[]>([]);
  const [currentTaskAgentType, setCurrentTaskAgentType] = useState<string | null>(null);
  const [historyContextActive, setHistoryContextActive] = useState(false);
  const [historyContextLoading, setHistoryContextLoading] = useState(false);
  const [historyJustCompleted, setHistoryJustCompleted] = useState(false);
  const [tokenLog, setTokenLog] = useState<Array<any>>([]);
  const [requestSummaries, setRequestSummaries] = useState<{ [messageId: string]: any }>({});
  const [messageMetadata, setMessageMetadata] = useState<{ [messageId: string]: any }>({});
  const [displayHighlights, setDisplayHighlights] = useState<boolean>(false);
  const [useVisionState, setUseVisionState] = useState<boolean>(false);
  const [showTabPreviews, setShowTabPreviews] = useState<boolean>(true);
  const [forceChatView, setForceChatView] = useState<boolean>(false);
  const [enablePlanner, setEnablePlanner] = useState<boolean>(false);
  const [enableValidator, setEnableValidator] = useState<boolean>(false);
  const [pendingEstimation, setPendingEstimation] = useState<any | null>(null);
  const [availableModelsForEstimation, setAvailableModelsForEstimation] = useState<Array<any>>([]);
  const [selectedEstimationModel, setSelectedEstimationModel] = useState<string | undefined>(undefined);
  const [recalculatedEstimation, setRecalculatedEstimation] = useState<any | null>(null);
  const [activeAggregateMessageId, setActiveAggregateMessageId] = useState<string | null>(null);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayEnabled, setReplayEnabled] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [incognitoMode] = useState(false);
  const [useFullPlanningPipeline, setUseFullPlanningPipeline] = useState(false);
  const [mirrorPreview, setMirrorPreview] = useState<any | null>(null);
  const [mirrorPreviewBatch, setMirrorPreviewBatch] = useState<Array<any>>([]);
  const [hasFirstPreview, setHasFirstPreview] = useState(false);
  const [isJobActive, setIsJobActive] = useState(false);
  const [isAgentModeActive, setIsAgentModeActive] = useState(false);
  const [showEmergencyStop, setShowEmergencyStop] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [agentTraceRootId, setAgentTraceRootId] = useState<string | null>(null);
  const [feedOnClick, setFeedOnClick] = useState<boolean>(false);
  const [fishMenuOpen, setFishMenuOpen] = useState<boolean>(false);
  const [viewDisplayMode, setViewDisplayMode] = useState<boolean>(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState<boolean>(false);
  const [feedbackMenuOpen, setFeedbackMenuOpen] = useState<boolean>(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState<boolean>(false);
  // Auto tab context state
  const [autoContextEnabled, setAutoContextEnabled] = useState<boolean>(false);
  const [autoContextTabIds, setAutoContextTabIds] = useState<number[]>([]);
  const [excludedAutoTabIds, setExcludedAutoTabIds] = useState<number[]>([]);

  const isDarkMode = useDarkMode();
  const { showToast } = useToast();
  const { ensureAgentOrdinal } = useAgentOrdinals();

  // Refs
  const sessionIdRef = useRef<string | null>(null);
  const isReplayingRef = useRef<boolean>(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const setSelectedAgentRef = useRef<((agent: AgentType) => void) | null>(null);
  const setContextTabIdsRef = useRef<((tabIds: number[]) => void) | null>(null);
  const seenEventIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const lastEventIdBySessionRef = useRef<Map<string, string>>(new Map());
  const lastAgentMessageRef = useRef<{ timestamp: number; actor: string } | null>(null);
  const taskIdToRootIdRef = useRef<Map<string, string>>(new Map());
  const lastAgentMessageByTaskRef = useRef<Map<string, { timestamp: number; actor: string }>>(new Map());
  const closableTaskIdsRef = useRef<Set<string>>(new Set());
  const laneColorByLaneRef = useRef<Map<number, string>>(new Map());
  const promptedOnOpenRef = useRef<boolean>(false);
  const agentTraceRootIdRef = useRef<string | null>(null);
  const agentTraceActiveRef = useRef<boolean>(false);
  const jobActiveRef = useRef<boolean>(false);
  const workflowEndedRef = useRef<boolean>(false);
  const isAgentModeActiveRef = useRef<boolean>(false);
  const cancelSummaryTargetsRef = useRef<Map<string, string>>(new Map());
  const runStartedAtRef = useRef<number | null>(null);
  const processedJobSummariesRef = useRef<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const fishRef = useRef<FishOverlayHandle | null>(null);
  const previousFeedOnClickRef = useRef<boolean>(false);
  const agentSettingsRef = useRef<HTMLDivElement | null>(null);
  const historyCompletedTimerRef = useRef<number | null>(null);
  const lastUserPromptRef = useRef<string | null>(null);
  // Refs for cancellation state management (confirmation-based stop with timeout escalation)
  const isCancellingRef = useRef<boolean>(false);
  const cancelTimeoutRef = useRef<number | null>(null);
  // Ref to store pending context tabs info from chat-input, used by message sender callback
  const pendingContextTabsRef = useRef<ContextTabInfo[] | null>(null);

  const logger = useMemo(() => createLogger(portRef), []);
  const { extensionVersion, releaseNotes } = useVersionInfo();
  const {
    firstRunAccepted,
    disablePerChatWarnings,
    resetPerChatAcceptance,
    promptPerChatIfEnabled,
    ensurePerChatBeforeNewSession,
    firstRunModal,
    livePricingModal,
    perChatModal,
  } = useDisclaimerGates(isDarkMode);
  const { hasAcceptedHistoryPrivacy, promptHistoryPrivacy, resetHistoryPrivacy, historyPrivacyModal } =
    useHistoryPrivacyGate(isDarkMode);
  const { promptAutoTabContextPrivacy, resetAutoTabContextPrivacy, autoTabContextPrivacyModal } =
    useAutoTabContextPrivacyGate(isDarkMode);

  // Callback to toggle auto-context from TabContextSelector
  const handleAutoContextToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        // Always show privacy warning when enabling
        const accepted = await promptAutoTabContextPrivacy();
        if (!accepted) return;
      } else {
        // Reset privacy acceptance so modal shows again on next enable
        await resetAutoTabContextPrivacy();
      }
      try {
        await generalSettingsStore.updateSettings({ enableAutoTabContext: enabled });
      } catch {}
    },
    [promptAutoTabContextPrivacy, resetAutoTabContextPrivacy],
  );

  // Track auto-context enabled state in a ref to avoid stale closures
  const autoContextEnabledRef = useRef(autoContextEnabled);
  useEffect(() => {
    autoContextEnabledRef.current = autoContextEnabled;
  }, [autoContextEnabled]);

  // Load and refresh auto-context tab IDs when enabled
  useEffect(() => {
    const loadAutoContextState = async () => {
      try {
        const settings = await generalSettingsStore.getSettings();
        const warnings = await warningsSettingsStore.getWarnings();
        const enabled = !!(settings.enableAutoTabContext && warnings.hasAcceptedAutoTabContextPrivacyWarning);
        setAutoContextEnabled(enabled);

        if (enabled) {
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const restricted = ['chrome://', 'chrome-extension://', 'about:', 'data:', 'javascript:'];
          const validIds = tabs
            .filter(t => t.id && t.url && !restricted.some(r => t.url!.startsWith(r)))
            .map(t => t.id!);
          setAutoContextTabIds(validIds);
        } else {
          setAutoContextTabIds([]);
          setExcludedAutoTabIds([]);
        }
      } catch {}
    };

    loadAutoContextState();

    // Refresh on tab changes - use ref to get current enabled state
    const handleTabChange = () => {
      if (autoContextEnabledRef.current) loadAutoContextState();
    };
    chrome.tabs.onCreated?.addListener(handleTabChange);
    chrome.tabs.onRemoved?.addListener(handleTabChange);
    chrome.tabs.onUpdated?.addListener(handleTabChange);

    // Subscribe to settings changes
    let unsubGeneral: (() => void) | undefined;
    let unsubWarnings: (() => void) | undefined;
    try {
      unsubGeneral = generalSettingsStore.subscribe(loadAutoContextState);
    } catch {}
    try {
      unsubWarnings = warningsSettingsStore.subscribe(loadAutoContextState);
    } catch {}

    return () => {
      chrome.tabs.onCreated?.removeListener(handleTabChange);
      chrome.tabs.onRemoved?.removeListener(handleTabChange);
      chrome.tabs.onUpdated?.removeListener(handleTabChange);
      try {
        unsubGeneral?.();
      } catch {}
      try {
        unsubWarnings?.();
      } catch {}
    };
  }, []); // Empty deps - loadAutoContextState always reads fresh from storage

  // Chat history
  const {
    chatSessions,
    loadChatSessions,
    handleSessionSelect: handleSessionSelectHook,
    handleSessionDelete,
    handleSessionBookmark: handleSessionBookmarkFromHook,
    renameSession,
  } = useChatHistory({
    logger,
    setMessages,
    setCurrentSessionId,
    sessionIdRef,
    setIsFollowUpMode,
    setIsHistoricalSession,
    setInputEnabled,
    setShowStopButton,
    setShowDashboard,
    setRequestSummaries,
    setMessageMetadata,
    setSessionStats,
    showToast,
    setFavoritePrompts,
    agentTraceRootIdRef,
    setAgentTraceRootId,
    setMirrorPreview,
    setMirrorPreviewBatch,
    portRef,
    setIsJobActive,
    lastEventIdBySessionRef,
  });

  // Event setup (appendMessage, taskEventHandler, panelHandlers)
  const { appendMessage, resetRunState, panelHandlers } = useEventSetup({
    portRef,
    sessionIdRef,
    agentTraceRootIdRef,
    agentTraceActiveRef,
    lastAgentMessageRef,
    jobActiveRef,
    laneColorByLaneRef,
    processedJobSummariesRef,
    taskIdToRootIdRef,
    lastAgentMessageByTaskRef,
    closableTaskIdsRef,
    workflowEndedRef,
    cancelSummaryTargetsRef,
    runStartedAtRef,
    lastUserPromptRef,
    historyCompletedTimerRef,
    setInputTextRef,
    // Cancellation state refs
    isCancellingRef,
    cancelTimeoutRef,
    logger,
    showToast,
    ensureAgentOrdinal,
    chatSessions,
    incognitoMode,
    setMessages,
    setIsJobActive,
    setShowStopButton,
    setIsHistoricalSession,
    setHasFirstPreview,
    setMirrorPreview,
    setMirrorPreviewBatch,
    setWorkerTabGroups,
    setShowCloseTabs,
    setIsFollowUpMode,
    setInputEnabled,
    setIsReplaying,
    setIsAgentModeActive,
    setActiveAggregateMessageId,
    setIsPaused,
    setAgentTraceRootId,
    setMessageMetadata,
    setRequestSummaries,
    setSessionStats,
    setPendingEstimation,
    setHistoryContextActive,
    setHistoryContextLoading,
    setHistoryJustCompleted,
    setShowInlineWorkflow,
    setTokenLog,
    setIsStopping,
    setCurrentSessionId,
    setShowDashboard,
    setShowHistory,
    setCurrentTaskAgentType,
    currentTaskAgentType,
    workerTabGroups,
    messages,
    mirrorPreviewBatch,
    recalculatedEstimation,
  });

  const { setupConnection, stopConnection, sendMessage } = useBackgroundConnection({
    portRef,
    sessionIdRef,
    logger,
    appendMessage,
    handlers: panelHandlers,
    eventIdRefs: { seenEventIdsRef, lastEventIdBySessionRef },
  });

  // All handlers
  const {
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
    handleOpenApiKeys,
    handleOpenWorkflowSettings,
    handleRefreshHistoryContext,
    handlePaletteSelect,
    handleKillSwitch,
  } = usePanelHandlers({
    portRef,
    sessionIdRef,
    agentSettingsRef,
    setInputTextRef,
    setSelectedAgentRef,
    processedJobSummariesRef,
    lastAgentMessageRef,
    agentTraceActiveRef,
    // Cancellation state refs
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
  });

  // Message sender
  let handleSendMessage = useMemo(
    () =>
      createMessageSender({
        logger,
        ensurePerChatBeforeNewSession,
        isFollowUpMode: () => isFollowUpMode,
        isHistoricalSession: () => isHistoricalSession,
        incognitoMode: () => incognitoMode,
        sessionIdRef,
        setCurrentSessionId,
        setInputEnabled,
        setShowStopButton,
        appendMessage: (m: any, sid?: string | null) => appendMessage(m, sid),
        lastUserPromptRef,
        setupConnection,
        stopConnection,
        portRef,
        sendMessage: (p: any) => sendMessage(p),
        setCurrentTaskAgentType,
        chatSessions,
        loadChatSessions: async () => {},
        createTaskId: () => Date.now().toString() + Math.random().toString(36).slice(2, 11),
        resetRunState,
        // Callback when user message is created - store pending context tabs with correct timestamp
        onUserMessageCreated: (timestamp: number) => {
          const contextTabs = pendingContextTabsRef.current;
          pendingContextTabsRef.current = null; // Clear for next message
          if (!contextTabs || contextTabs.length === 0) return;
          const messageId = `${timestamp}-user`;
          setMessageMetadata((prev: any) => {
            const existing = prev[messageId] || {};
            const next = { ...prev, [messageId]: { ...existing, contextTabs } };
            // Also persist to storage
            try {
              if (sessionIdRef.current) {
                chatHistoryStore.storeMessageMetadata(sessionIdRef.current, next).catch(() => {});
              }
            } catch {}
            return next;
          });
        },
      }),
    [
      logger,
      ensurePerChatBeforeNewSession,
      isFollowUpMode,
      isHistoricalSession,
      incognitoMode,
      sessionIdRef,
      setCurrentSessionId,
      setInputEnabled,
      setShowStopButton,
      appendMessage,
      lastUserPromptRef,
      setupConnection,
      stopConnection,
      portRef,
      sendMessage,
      setCurrentTaskAgentType,
      chatSessions,
      resetRunState,
    ],
  );

  const handleReplay = useMemo(
    () => async (historySessionId: string) => {
      const sender = createMessageSender({
        logger,
        ensurePerChatBeforeNewSession,
        isFollowUpMode: () => isFollowUpMode,
        isHistoricalSession: () => isHistoricalSession,
        incognitoMode: () => incognitoMode,
        sessionIdRef,
        setCurrentSessionId,
        setInputEnabled,
        setShowStopButton,
        appendMessage: (m: any, sid?: string | null) => appendMessage(m, sid),
        lastUserPromptRef,
        setupConnection,
        stopConnection,
        portRef,
        sendMessage: (p: any) => sendMessage(p),
        setCurrentTaskAgentType,
        chatSessions,
        loadChatSessions: async () => {},
        createTaskId: () => Date.now().toString() + Math.random().toString(36).slice(2, 11),
      });
      await (sender as any)(`/replay ${historySessionId}`);
    },
    [
      logger,
      ensurePerChatBeforeNewSession,
      isFollowUpMode,
      isHistoricalSession,
      incognitoMode,
      sessionIdRef,
      setCurrentSessionId,
      setInputEnabled,
      setShowStopButton,
      appendMessage,
      lastUserPromptRef,
      setupConnection,
      stopConnection,
      portRef,
      sendMessage,
      setCurrentTaskAgentType,
      chatSessions,
    ],
  );

  // Effects (initialization, keyboard, cleanup, etc.)
  // NOTE: Must be after handleSendMessage is defined to avoid temporal dead zone
  usePanelEffects({
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
    handleSendMessage,
    appendMessage,
  });

  // Subscribe to running agents count for dashboard badge
  useEffect(() => {
    const updateCount = async () => {
      try {
        const stored = await chrome.storage.local.get('agent_dashboard_running');
        const list = stored.agent_dashboard_running || [];
        setRunningAgentsCount(Array.isArray(list) ? list.length : 0);
      } catch {}
    };
    updateCount();
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.agent_dashboard_running) {
        const list = changes.agent_dashboard_running.newValue || [];
        setRunningAgentsCount(Array.isArray(list) ? list.length : 0);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  // Listen for navigate-to-session events from agent manager
  useEffect(() => {
    const handler = async (e: Event) => {
      const sessionId = (e as CustomEvent).detail?.sessionId;
      if (sessionId) {
        // handleSessionSelect already calls subscribe_to_session internally
        await handleSessionSelect(sessionId);
      }
    };
    document.addEventListener('navigate-to-session', handler as EventListener);
    return () => document.removeEventListener('navigate-to-session', handler as EventListener);
  }, [handleSessionSelect]);

  // Listen for force-new-session events from agent manager
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      // Clear current session to start fresh
      // If preservePerChatAcceptance is true, don't reset the per-chat acceptance
      // This allows auto-started tasks to proceed if user already accepted earlier
      handleNewChat(detail.preservePerChatAcceptance);
    };
    document.addEventListener('force-new-session', handler as EventListener);
    return () => document.removeEventListener('force-new-session', handler as EventListener);
  }, [handleNewChat]);

  // Persist panel view state for restoration on reopen
  useEffect(() => {
    const viewMode = showHistory ? 'history' : showDashboard ? 'dashboard' : 'chat';
    chrome.storage.local
      .set({
        panel_view_state: { currentSessionId, viewMode, timestamp: Date.now() },
      })
      .catch(() => {});
  }, [currentSessionId, showHistory, showDashboard]);

  // Computed values
  const computedLaneInfo = useMemo(() => {
    try {
      const graph: any = (messageMetadata as any).__workflowGraph;
      const positions = (graph && graph.positions) || {};
      if (!Array.isArray(workerTabGroups) || workerTabGroups.length === 0) return {};
      const lanes: Record<number, { label: string; color?: string }> = {};
      const defaultColor = '#A78BFA';
      const rootId = agentTraceRootIdRef.current;
      const meta: any = rootId ? messageMetadata[rootId] : null;
      const mapping: Array<{ workerId: string; sessionId: string }> = Array.isArray(meta?.workerSessionMap)
        ? meta.workerSessionMap
        : [];
      const groupByWorkerId = new Map();
      for (const m of mapping) {
        const g = workerTabGroups.find((x: any) => String(x.taskId) === String(m.sessionId));
        if (g) groupByWorkerId.set(String(m.workerId), g);
      }
      for (const [, pos] of Object.entries(positions as any)) {
        const lane = (pos as any)?.y || 0;
        if (!(lane in lanes)) {
          const label = `Web Agent ${lane + 1}`;
          const mapped = groupByWorkerId.get(String(lane + 1));
          const groupColor =
            mapped?.color ||
            workerTabGroups.find((g: any) =>
              String(g?.name || '')
                .trim()
                .endsWith(String(lane + 1)),
            )?.color;
          let finalColor =
            groupColor && groupColor !== defaultColor
              ? groupColor
              : laneColorByLaneRef.current.get(lane) || defaultColor;
          try {
            laneColorByLaneRef.current.set(lane, finalColor);
          } catch {}
          lanes[lane] = { label, color: finalColor };
        }
      }
      return lanes;
    } catch {
      return {};
    }
  }, [messageMetadata, workerTabGroups]);

  return (
    <>
      <div
        ref={panelRef}
        className={`relative panel-card liquid-glass flex h-screen flex-col overflow-hidden rounded-2xl ${isDarkMode ? 'text-slate-200' : 'text-gray-900'}`}>
        <div className="pointer-events-none absolute inset-0 z-0">
          <div
            className={`${isDarkMode ? 'h-full w-full bg-[radial-gradient(80%_50%_at_20%_0%,rgba(124,58,237,var(--wallpaper-a1)),transparent),radial-gradient(70%_50%_at_80%_100%,rgba(245,158,11,var(--wallpaper-a2)),transparent)]' : 'h-full w-full bg-[radial-gradient(80%_50%_at_20%_0%,rgba(124,58,237,var(--wallpaper-a1)),transparent),radial-gradient(70%_50%_at_80%_100%,rgba(13,148,136,var(--wallpaper-a2)),transparent)]'}`}></div>
        </div>
        {hasProviders !== null && hasConfiguredModels !== null && (!hasProviders || !hasConfiguredModels) && (
          <div className="absolute top-16 left-1/2 z-20 w-[90%] max-w-2xl -translate-x-1/2">
            <SetupChecklist
              hasProviders={!!hasProviders}
              hasAgentModels={!!hasConfiguredModels}
              isDarkMode={isDarkMode}
              onOpenApiKeys={handleOpenApiKeys}
              onOpenWorkflowSettings={handleOpenWorkflowSettings}
            />
          </div>
        )}
        <FishOverlay ref={fishRef} panelRef={panelRef} />
        {viewDisplayMode ? (
          <DisplayMode
            feedOnClick={feedOnClick}
            setFeedOnClick={setFeedOnClick}
            previousFeedOnClickRef={previousFeedOnClickRef}
            onBack={() => setViewDisplayMode(false)}
            onAddFish={() => fishRef.current?.addFish()}
            onAddShark={() => fishRef.current?.addShark()}
            onFeed={(amount, x, y) => {
              if (typeof x === 'number' && typeof y === 'number') fishRef.current?.dropFoodAtClientPosition(x, y);
              else fishRef.current?.scatterFood(amount);
            }}
            onWave={() => fishRef.current?.triggerWave()}
            onClear={() => fishRef.current?.clearAll()}
          />
        ) : null}
        <div
          className={`relative z-10 flex h-full flex-col ${viewDisplayMode ? 'hidden' : ''}`}
          onClick={e => {
            try {
              const t = e.target as HTMLElement;
              if (
                !panelRef.current ||
                t.closest('button, a, input, textarea, [role="button"], [role="menu"]') ||
                t.closest('.liquid-bubble')
              )
                return;
              if (feedOnClick) fishRef.current?.dropFoodAtClientPosition(e.clientX, e.clientY);
            } catch {}
          }}>
          <header className="header glass-header sticky top-0 z-10">
            {showHistory || showPopulations || viewDisplayMode ? (
              <button
                type="button"
                onClick={() => {
                  handleBackToChat(false);
                  if (viewDisplayMode) setFeedOnClick(previousFeedOnClickRef.current);
                  setViewDisplayMode(false);
                }}
                className={`${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'} cursor-pointer`}>
                ← Back
              </button>
            ) : (
              <div className="flex w-full items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  <Branding isDarkMode={isDarkMode} extensionVersion={extensionVersion} releaseNotes={releaseNotes} />
                  {(historyContextLoading || historyJustCompleted) && (
                    <div
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${historyContextLoading ? (isDarkMode ? 'bg-gray-900/30 text-gray-400 border border-gray-700/50' : 'bg-gray-50 text-gray-500 border border-gray-300') : isDarkMode ? 'bg-green-900/30 text-green-300 border border-green-700/50' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                      {historyContextLoading ? (
                        <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      ) : (
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      )}
                      <span>{historyContextLoading ? 'Summarising history...' : 'History summarised'}</span>
                    </div>
                  )}
                </div>
                <HeaderActions
                  isDarkMode={isDarkMode}
                  onNewChat={handleNewChat}
                  onLoadHistory={handleLoadHistory}
                  onLoadDashboard={handleLoadDashboard}
                  runningAgentsCount={runningAgentsCount}
                  agentSettingsOpen={agentSettingsOpen}
                  setAgentSettingsOpen={setAgentSettingsOpen}
                  feedbackMenuOpen={feedbackMenuOpen}
                  setFeedbackMenuOpen={setFeedbackMenuOpen}
                  fishMenuOpen={fishMenuOpen}
                  setFishMenuOpen={setFishMenuOpen}
                  onFishAdd={() => fishRef.current?.addFish()}
                  onSharkAdd={() => fishRef.current?.addShark()}
                  onFeedingTime={() => fishRef.current?.scatterFood(28)}
                  onTriggerWave={() => fishRef.current?.triggerWave()}
                  onShowPopulations={() => setShowPopulations(true)}
                  feedOnClick={feedOnClick}
                  setFeedOnClick={setFeedOnClick}
                  onViewDisplay={() => {
                    previousFeedOnClickRef.current = feedOnClick;
                    setFeedOnClick(true);
                    setViewDisplayMode(true);
                  }}
                  onRefreshHistoryContext={handleRefreshHistoryContext}
                  onEmergencyStopToggle={setShowEmergencyStop}
                  hasAcceptedHistoryPrivacy={hasAcceptedHistoryPrivacy}
                  promptHistoryPrivacy={promptHistoryPrivacy}
                  resetHistoryPrivacy={resetHistoryPrivacy}
                />
              </div>
            )}
          </header>
          <Suspense fallback={null}>
            <CommandPalette
              isOpen={paletteOpen}
              isDarkMode={isDarkMode}
              onClose={() => setPaletteOpen(false)}
              onSelect={handlePaletteSelect}
            />
          </Suspense>
          <WorkflowGraphSection
            isDarkMode={isDarkMode}
            graph={(messageMetadata as any)?.__workflowGraph || null}
            laneInfo={computedLaneInfo}
            showInline={showInlineWorkflow}
            setShowInline={v => setShowInlineWorkflow(typeof v === 'function' ? v(showInlineWorkflow) : v)}
            onOpenFullScreen={() => setShowWorkflowModal(true)}
          />

          {showPopulations ? (
            <div className="flex-1 overflow-hidden min-h-0">
              <PopulationChart fishRef={fishRef} isDarkMode={isDarkMode} onBack={() => setShowPopulations(false)} />
            </div>
          ) : showHistory ? (
            <div className="flex-1 overflow-hidden min-h-0">
              <ChatHistoryList
                sessions={chatSessions}
                onSessionSelect={handleSessionSelect}
                onSessionDelete={handleSessionDelete}
                onSessionBookmark={handleSessionBookmark}
                visible={true}
                isDarkMode={isDarkMode}
                onRenameSession={async (sessionId, newTitle) => {
                  try {
                    await renameSession(sessionId, newTitle);
                  } catch (e) {
                    logger.error('Rename failed', e);
                  }
                }}
              />
            </div>
          ) : showDashboard ? (
            <div className="flex-1 overflow-hidden min-h-0">
              <AgentDashboard
                isDarkMode={isDarkMode}
                onBack={handleBackToChat}
                onSelectSession={handleSessionSelect}
                chatSessions={chatSessions}
              />
            </div>
          ) : (
            <ChatScreen
              isDarkMode={isDarkMode}
              messages={messages}
              inputEnabled={inputEnabled}
              showStopButton={showStopButton}
              isPaused={isPaused}
              isHistoricalSession={isHistoricalSession}
              currentSessionId={currentSessionId}
              forceChatView={forceChatView}
              compactMode={compactMode}
              sessionStats={sessionStats}
              requestSummaries={requestSummaries}
              messageMetadata={messageMetadata}
              mirrorPreview={mirrorPreview}
              mirrorPreviewBatch={mirrorPreviewBatch}
              hasFirstPreview={hasFirstPreview}
              isPreviewCollapsed={isPreviewCollapsed}
              agentTraceRootId={agentTraceRootId}
              pendingEstimation={pendingEstimation}
              availableModelsForEstimation={availableModelsForEstimation}
              showJumpToLatest={showJumpToLatest}
              showCloseTabs={showCloseTabs}
              workerTabGroups={workerTabGroups}
              pinnedMessageIds={pinnedMessageIds}
              currentTaskAgentType={currentTaskAgentType}
              isJobActive={isJobActive}
              tokenLog={tokenLog}
              useFullPlanningPipeline={useFullPlanningPipeline}
              enablePlanner={enablePlanner}
              enableValidator={enableValidator}
              useVisionState={useVisionState}
              hasConfiguredModels={hasConfiguredModels}
              favoritePrompts={favoritePrompts}
              replayEnabled={replayEnabled}
              showEmergencyStop={showEmergencyStop}
              isStopping={isStopping}
              logger={logger}
              portRef={portRef}
              sessionIdRef={sessionIdRef}
              agentTraceRootIdRef={agentTraceRootIdRef}
              panelRef={panelRef}
              messagesEndRef={messagesEndRef}
              setInputTextRef={setInputTextRef}
              setSelectedAgentRef={setSelectedAgentRef}
              setContextTabIdsRef={setContextTabIdsRef}
              setIsPreviewCollapsed={setIsPreviewCollapsed}
              setSelectedEstimationModel={setSelectedEstimationModel}
              setRecalculatedEstimation={setRecalculatedEstimation}
              setPendingEstimation={setPendingEstimation}
              setShowCloseTabs={setShowCloseTabs}
              setWorkerTabGroups={setWorkerTabGroups}
              handleSendMessage={handleSendMessage}
              handleStopTask={handleStopTask}
              handlePauseTask={handlePauseTask}
              handleResumeTask={handleResumeTask}
              handleReplay={handleReplay}
              handleClearChat={handleClearChat}
              handleBookmarkSelect={handleBookmarkSelect}
              handleBookmarkAdd={async (title: string, content: string, agentType?: any) => {
                const safe = (v: string) =>
                  ['auto', 'chat', 'search', 'agent', 'multiagent'].includes(v) ? (v as any) : 'agent';
                await favoritesStorage.addPrompt(title, content, agentType ? safe(String(agentType)) : undefined);
                setFavoritePrompts(await favoritesStorage.getAllPrompts());
              }}
              handleBookmarkUpdate={async (id: number, title: string, content: string, agentType?: any) => {
                const safe = (v: string) =>
                  ['auto', 'chat', 'search', 'agent', 'multiagent'].includes(v) ? (v as any) : 'agent';
                await favoritesStorage.updatePrompt(
                  id,
                  title,
                  content,
                  agentType ? safe(String(agentType)) : undefined,
                );
                setFavoritePrompts(await favoritesStorage.getAllPrompts());
              }}
              handleBookmarkDelete={handleBookmarkDelete}
              handleBookmarkReorder={handleBookmarkReorder}
              handlePinMessage={handlePinMessage}
              handleQuoteMessage={handleQuoteMessage}
              appendMessage={appendMessage}
              setupConnection={setupConnection}
              handleKillSwitch={handleKillSwitch}
              autoContextEnabled={autoContextEnabled}
              autoContextTabIds={autoContextTabIds}
              excludedAutoTabIds={excludedAutoTabIds}
              onExcludedAutoTabIdsChange={setExcludedAutoTabIds}
              onAutoContextToggle={handleAutoContextToggle}
              setMessageMetadata={setMessageMetadata}
              setPendingContextTabs={tabs => {
                pendingContextTabsRef.current = tabs;
              }}
            />
          )}
        </div>
      </div>
      {showWorkflowModal && (messageMetadata as any)?.__workflowGraph && (
        <WorkflowGraphModal
          graph={(messageMetadata as any).__workflowGraph}
          laneInfo={computedLaneInfo}
          onClose={() => setShowWorkflowModal(false)}
        />
      )}
      {firstRunModal}
      {livePricingModal}
      {perChatModal}
      {historyPrivacyModal}
      {autoTabContextPrivacyModal}
    </>
  );
};

export default SidePanel;
