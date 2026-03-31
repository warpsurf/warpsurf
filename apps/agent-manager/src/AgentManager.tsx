import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiSettings, FiTrash2, FiSearch, FiX } from 'react-icons/fi';
import { useAgentManagerConnection } from '@src/hooks/use-agent-manager-connection';
import { AgentGallery } from '@src/components/AgentGallery';
import { AgentInputBar } from '@src/components/AgentInputBar';
import { useAutoTabContextPrivacyGate } from '@src/hooks/use-auto-tab-context-privacy-gate';
import { generalSettingsStore, warningsSettingsStore, speechToTextModelStore } from '@extension/storage';
import {
  useSpeechToText,
  MicrophonePermissionOverlay,
  PER_CHAT_DISCLAIMER_MESSAGE,
  PER_CHAT_DISCLAIMER_EXTRA_NOTE,
} from '@extension/shared';
import type { AgentData } from '@src/types';
import logoImage from '/warpsurflogo.png';
import { AGENT_ACTIVITY_THRESHOLDS } from '@extension/shared/lib/utils';
import { ChatView, ConversationSidebar, DisclaimerModal } from '@src/components/chat';
import { formatUsd } from '@panel/components/chat-interface/message-list';
import WorkflowGraphModal from '@panel/components/multiagent-visualization/visualization-modal';
import { ErrorBoundary } from '@panel/components/error-boundary';

type ViewMode = 'gallery' | 'chat';

export default function AgentManager() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [autoContextEnabled, setAutoContextEnabled] = useState(false);
  const [autoContextTabIds, setAutoContextTabIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [showPerChatDisclaimer, setShowPerChatDisclaimer] = useState(false);
  const pendingTaskRef = useRef<{
    task: string;
    agentType?: string;
    contextTabIds?: number[];
    attachments?: any[];
  } | null>(null);

  // Privacy gate for auto-tab context
  const { promptAutoTabContextPrivacy, resetAutoTabContextPrivacy, autoTabContextPrivacyModal } =
    useAutoTabContextPrivacyGate(isDarkMode);

  // Detect dark mode preference
  useEffect(() => {
    const getSystemPreference = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
    const checkDarkMode = async () => {
      try {
        const settings = await generalSettingsStore.getSettings();
        const themeMode = settings.themeMode || 'auto';
        setIsDarkMode(themeMode === 'dark' ? true : themeMode === 'light' ? false : getSystemPreference());
      } catch {
        setIsDarkMode(getSystemPreference());
      }
    };
    checkDarkMode();
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = generalSettingsStore.subscribe(checkDarkMode);
    } catch {}
    return () => {
      mediaQuery.removeEventListener('change', checkDarkMode);
      unsubscribe?.();
    };
  }, []);

  // Sync dark/light class on <html> for CSS overrides (liquid-glass, etc.)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.documentElement.classList.toggle('light', !isDarkMode);
  }, [isDarkMode]);

  // Load and refresh auto-context state
  const autoContextEnabledRef = useRef(autoContextEnabled);
  useEffect(() => {
    autoContextEnabledRef.current = autoContextEnabled;
  }, [autoContextEnabled]);

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
        }
      } catch {}
    };
    loadAutoContextState();
    const handleTabChange = () => {
      if (autoContextEnabledRef.current) loadAutoContextState();
    };
    chrome.tabs.onCreated?.addListener(handleTabChange);
    chrome.tabs.onRemoved?.addListener(handleTabChange);
    chrome.tabs.onUpdated?.addListener(handleTabChange);
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
  }, []);

  const handleAutoContextToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const accepted = await promptAutoTabContextPrivacy();
        if (!accepted) return;
      } else {
        await resetAutoTabContextPrivacy();
      }
      await generalSettingsStore.updateSettings({ enableAutoTabContext: enabled });
    },
    [promptAutoTabContextPrivacy, resetAutoTabContextPrivacy],
  );

  const {
    agents,
    sendNewTask,
    openSidepanelToSession,
    isConnected,
    portRef,
    addPortListener,
    removePortListener,
    chatSession,
    subscribeToSession,
    unsubscribeFromSession,
    startTaskInline,
    sendFollowUpInline,
    needsPerChatDisclaimer,
    mirrorPreview,
    mirrorPreviewBatch,
    activeAggregateMessageId,
    setPendingContextTabs,
    // Task control
    handleStopTask,
    handlePauseTask,
    handleResumeTask,
    handleKillSwitch,
    handleInjectLiveMessage,
    handleHandBackControl,
    isStopping,
    isPaused,
    showStopButton,
    showCloseTabs,
    setShowCloseTabs,
    showEmergencyStop,
    workerTabGroups,
    setWorkerTabGroups,
    sessionStats,
    currentTaskAgentType,
    messageMetadata,
    agentTraceRootIdRef,
    sessionIdRef,
    currentPlan,
    setSessionTitleAnimating,
  } = useAgentManagerConnection();

  // Speech-to-text
  const [sttConfigured, setSttConfigured] = useState(false);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const config = await speechToTextModelStore.getConfig();
        setSttConfigured(!!config?.provider && !!config?.modelName);
      } catch {}
    };
    load();
    let unsub: (() => void) | undefined;
    try {
      unsub = speechToTextModelStore.subscribe(load);
    } catch {}
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, []);

  const stt = useSpeechToText({
    portRef,
    onTranscription: useCallback((text: string) => {
      if (setInputTextRef.current) setInputTextRef.current(text);
    }, []),
    onError: useCallback((error: string) => {
      console.error('[AgentManager STT]', error);
    }, []),
  });

  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type === 'speech_to_text_result') stt.handleSttResult(message.text || '');
      else if (message?.type === 'speech_to_text_error') stt.handleSttError(message.error || 'Transcription failed');
    };
    addPortListener(listener);
    return () => removePortListener(listener);
  }, [stt.handleSttResult, stt.handleSttError, addPortListener, removePortListener]);

  // Check for pending session from side panel view switch (on mount + storage change + connection ready)
  useEffect(() => {
    if (!isConnected) return;
    const checkPending = async () => {
      const result = await chrome.storage.local.get('pending_agent_manager_session');
      const sessionId = result.pending_agent_manager_session;
      if (sessionId) {
        chrome.storage.local.remove('pending_agent_manager_session');
        await subscribeToSession(sessionId);
        setViewMode('chat');
      }
    };
    checkPending();
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && changes.pending_agent_manager_session?.newValue) checkPending();
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [subscribeToSession, isConnected]);

  // Filter agents by search query
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter(
      agent => agent.sessionTitle?.toLowerCase().includes(q) || agent.taskDescription?.toLowerCase().includes(q),
    );
  }, [agents, searchQuery]);

  const handleDeleteAll = useCallback(async () => {
    await chrome.storage.local.set({
      agent_dashboard_running: [],
      agent_dashboard_completed: [],
    });
    setShowDeleteConfirm(false);
  }, []);

  const handleDeleteAgent = useCallback(async (agent: AgentData) => {
    try {
      const [running, completed] = await Promise.all([
        chrome.storage.local.get('agent_dashboard_running'),
        chrome.storage.local.get('agent_dashboard_completed'),
      ]);
      const filteredRunning = (running.agent_dashboard_running || []).filter(
        (a: any) => a.sessionId !== agent.sessionId,
      );
      const filteredCompleted = (completed.agent_dashboard_completed || []).filter(
        (a: any) => a.sessionId !== agent.sessionId,
      );
      await chrome.storage.local.set({
        agent_dashboard_running: filteredRunning,
        agent_dashboard_completed: filteredCompleted,
      });
      try {
        await chrome.storage.local.remove(`preview_cache_${agent.sessionId}`);
      } catch {}
    } catch (err) {
      console.error('[AgentManager] Error in handleDeleteAgent:', err);
    }
  }, []);

  // Categorize agents
  const { activeAgents, recentAgents, moreAgents } = useMemo(() => {
    const now = Date.now();
    const active: AgentData[] = [];
    const recent: AgentData[] = [];
    const more: AgentData[] = [];

    for (const agent of filteredAgents) {
      const isRunningStatus = ['running', 'paused', 'needs_input'].includes(agent.status);
      const lastActivity = agent.preview?.lastUpdated || agent.endTime || agent.startTime || 0;
      const isWithinRecentWindow = now - lastActivity < AGENT_ACTIVITY_THRESHOLDS.ACTIVE_MS;

      if (isRunningStatus) active.push(agent);
      else if (isWithinRecentWindow) recent.push(agent);
      else more.push(agent);
    }

    const sortByActivity = (a: AgentData, b: AgentData) => {
      if (a.status === 'needs_input' && b.status !== 'needs_input') return -1;
      if (b.status === 'needs_input' && a.status !== 'needs_input') return 1;
      const timeA = a.preview?.lastUpdated || a.endTime || a.startTime || 0;
      const timeB = b.preview?.lastUpdated || b.endTime || b.startTime || 0;
      return timeB - timeA;
    };

    active.sort(sortByActivity);
    recent.sort(sortByActivity);
    more.sort(sortByActivity);

    return { activeAgents: active, recentAgents: recent, moreAgents: more };
  }, [filteredAgents]);

  // Store context tabs for the next user message (mirrors side panel flow)
  const handleContextTabsCapture = useCallback(
    (_timestamp: number, contextTabs: any[]) => {
      setPendingContextTabs(contextTabs);
    },
    [setPendingContextTabs],
  );

  // Handle sending a new task (with per-chat disclaimer gate)
  const handleSendMessage = useCallback(
    async (text: string, agentType?: string, contextTabIds?: number[], attachments?: any[]) => {
      const needsDisclaimer = await needsPerChatDisclaimer();
      if (needsDisclaimer) {
        pendingTaskRef.current = { task: text, agentType, contextTabIds, attachments };
        setShowPerChatDisclaimer(true);
        return;
      }
      startTaskInline(text, agentType, contextTabIds, attachments);
      setViewMode('chat');
    },
    [needsPerChatDisclaimer, startTaskInline],
  );

  const handleDisclaimerAccept = useCallback(() => {
    setShowPerChatDisclaimer(false);
    const pending = pendingTaskRef.current;
    pendingTaskRef.current = null;
    if (pending) {
      startTaskInline(pending.task, pending.agentType, pending.contextTabIds, pending.attachments);
      setViewMode('chat');
    }
  }, [startTaskInline]);

  // Select an agent from the gallery -> open chat view
  const handleSelectAgent = useCallback(
    async (agent: AgentData) => {
      await subscribeToSession(agent.sessionId);
      setViewMode('chat');
    },
    [subscribeToSession],
  );

  // Chat view: close -> gallery
  const handleCloseChat = useCallback(() => {
    unsubscribeFromSession();
    setViewMode('gallery');
  }, [unsubscribeFromSession]);

  // Chat view: open in side panel
  const handleOpenInSidePanel = useCallback(() => {
    const sid = chatSession.sessionId;
    if (sid) {
      openSidepanelToSession(sid);
      unsubscribeFromSession();
      setViewMode('gallery');
    }
  }, [chatSession.sessionId, openSidepanelToSession, unsubscribeFromSession]);

  // Chat view: send follow-up
  const handleChatSendMessage = useCallback(
    (
      text: string,
      agentType?: string,
      contextTabIds?: number[],
      _contextMenuAction?: string,
      _skipAutoContext?: boolean,
      attachments?: any[],
    ) => {
      if (chatSession.sessionId) {
        sendFollowUpInline(text, agentType, contextTabIds, attachments);
      }
    },
    [chatSession.sessionId, sendFollowUpInline],
  );

  // Sidebar: switch session
  const handleSidebarSelectSession = useCallback(
    async (sessionId: string) => {
      unsubscribeFromSession();
      await subscribeToSession(sessionId);
    },
    [unsubscribeFromSession, subscribeToSession],
  );

  // Sidebar: new chat -> gallery
  const handleSidebarNewChat = useCallback(() => {
    unsubscribeFromSession();
    setViewMode('gallery');
  }, [unsubscribeFromSession]);

  const openSettings = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  // Find the agent data for the current chat session (for metrics)
  const currentAgent = useMemo(() => {
    if (!chatSession.sessionId) return null;
    return agents.find(a => a.sessionId === chatSession.sessionId) || null;
  }, [agents, chatSession.sessionId]);

  // Workflow graph from metadata and computed lane info (mirrors SidePanel)
  const workflowGraph = (messageMetadata as any)?.__workflowGraph || undefined;
  const laneColorByLaneRef = useRef(new Map<number, string>());
  const computedLaneInfo = useMemo(() => {
    try {
      const graph: any = (messageMetadata as any).__workflowGraph;
      const positions = (graph && graph.positions) || {};
      if (Object.keys(positions).length === 0) return {};
      const lanes: Record<number, { label: string; color?: string }> = {};
      const defaultColor = '#A78BFA';
      const rootId = agentTraceRootIdRef.current;
      const meta: any = rootId ? messageMetadata[rootId] : null;
      // Use persisted workerColorMap as primary colour source (survives view switches).
      // Fall back to live workerTabGroups for running sessions.
      const colorMap: Record<string, string> = meta?.workerColorMap || {};
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
          const label = `Crew ${lane + 1}`;
          const wid = String(lane + 1);
          const metaColor = colorMap[wid];
          const mapped = groupByWorkerId.get(wid);
          const groupColor =
            mapped?.color ||
            workerTabGroups.find((g: any) =>
              String(g?.name || '')
                .trim()
                .endsWith(wid),
            )?.color;
          const finalColor =
            metaColor ||
            (groupColor && groupColor !== defaultColor ? groupColor : null) ||
            laneColorByLaneRef.current.get(lane) ||
            defaultColor;
          laneColorByLaneRef.current.set(lane, finalColor);
          lanes[lane] = { label, color: finalColor };
        }
      }
      return lanes;
    } catch {
      return {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageMetadata, workerTabGroups]);

  const [showWorkflowModal, setShowWorkflowModal] = useState(false);

  if (viewMode === 'chat') {
    return (
      <div className={`h-screen flex ${isDarkMode ? 'bg-[#121210] text-slate-200' : 'bg-[#f7f7f5] text-gray-900'}`}>
        <ConversationSidebar
          agents={agents}
          activeSessionId={chatSession.sessionId}
          isDarkMode={isDarkMode}
          onSelectSession={handleSidebarSelectSession}
          onNewChat={handleSidebarNewChat}
        />
        <ChatView
          sessionTitle={chatSession.sessionTitle}
          sessionTitleAnimating={chatSession.sessionTitleAnimating}
          onTitleAnimationComplete={() => setSessionTitleAnimating(false)}
          messages={chatSession.messages}
          isDarkMode={isDarkMode}
          isRunning={chatSession.isRunning}
          jobSummaries={chatSession.jobSummaries}
          metadataByMessageId={chatSession.metadataByMessageId}
          inlinePreview={mirrorPreview}
          inlinePreviewBatch={mirrorPreviewBatch}
          activeAggregateMessageId={activeAggregateMessageId}
          onSendMessage={handleChatSendMessage}
          onClose={handleCloseChat}
          onOpenInSidePanel={handleOpenInSidePanel}
          disabled={!isConnected}
          // Task control
          showStopButton={showStopButton}
          onStopTask={handleStopTask}
          isPaused={isPaused}
          onPauseTask={handlePauseTask}
          onResumeTask={handleResumeTask}
          onHandBackControl={handleHandBackControl}
          isStopping={isStopping}
          showEmergencyStop={showEmergencyStop}
          onEmergencyStop={handleKillSwitch}
          isAgentModeActive={currentTaskAgentType === 'agent' || currentTaskAgentType === 'multiagent'}
          onInjectLiveMessage={handleInjectLiveMessage}
          // Plan
          planItems={currentPlan || undefined}
          workflowGraph={workflowGraph}
          workflowLaneInfo={computedLaneInfo}
          onOpenWorkflowFullScreen={() => setShowWorkflowModal(true)}
          // Preview
          onOpenPreviewTab={tabId => {
            if (typeof tabId !== 'number') return;
            try {
              portRef.current?.postMessage({ type: 'focus_tab', tabId });
            } catch {}
          }}
          onTakeControl={tabId => {
            if (typeof tabId !== 'number') return;
            try {
              portRef.current?.postMessage({ type: 'take_control', tabId });
            } catch {}
          }}
          // Close tabs
          showCloseTabs={showCloseTabs}
          workerTabGroups={workerTabGroups}
          sessionIdForCleanup={chatSession.sessionId}
          onClosedTabs={() => {
            setShowCloseTabs(false);
            setWorkerTabGroups([]);
          }}
          // Session stats / debug
          sessionStats={sessionStats}
          formatUsd={formatUsd}
          currentSessionId={chatSession.sessionId}
          agentTraceRootIdRef={agentTraceRootIdRef}
          currentTaskAgentType={currentTaskAgentType}
          messageMetadata={messageMetadata}
          portRef={portRef}
          // Context
          autoContextEnabled={autoContextEnabled}
          autoContextTabIds={autoContextTabIds}
          onAutoContextToggle={handleAutoContextToggle}
          onContextTabsCapture={handleContextTabsCapture}
          // Speech-to-text
          onMicClick={stt.handleMicClick}
          onMicStop={stt.stopRecording}
          isRecording={stt.isRecording}
          isProcessingSpeech={stt.isProcessing}
          recordingDurationMs={stt.recordingDurationMs}
          audioLevel={stt.audioLevel}
          sttConfigured={sttConfigured}
          onOpenVoiceSettings={() => {
            try {
              chrome.storage.local.set({ 'settings.pendingTab': 'voice' });
              chrome.runtime.openOptionsPage();
            } catch {}
          }}
        />
        {/* Per-chat disclaimer */}
        {showPerChatDisclaimer && (
          <DisclaimerModal
            isDarkMode={isDarkMode}
            message={PER_CHAT_DISCLAIMER_MESSAGE}
            extraNote={PER_CHAT_DISCLAIMER_EXTRA_NOTE}
            onAccept={handleDisclaimerAccept}
          />
        )}
        {autoTabContextPrivacyModal}
        {showWorkflowModal && workflowGraph && (
          <ErrorBoundary
            resetKey={chatSession.sessionId ?? ''}
            fallback={<div className="text-xs text-red-400 p-2">Graph error</div>}>
            <WorkflowGraphModal
              graph={workflowGraph}
              laneInfo={computedLaneInfo}
              isDarkMode={isDarkMode}
              onClose={() => setShowWorkflowModal(false)}
            />
          </ErrorBoundary>
        )}
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen flex flex-col ${isDarkMode ? 'bg-[#121210] text-slate-200' : 'bg-[#f7f7f5] text-gray-900'}`}>
      {/* Header */}
      <header
        className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-[#2f2f29] bg-[#181816]' : 'border-[#deded7] bg-[#fbfbf9]'}`}>
        <div className="flex items-center gap-3">
          <img src={logoImage} alt="Warpsurf" className="h-8 w-8" />
          <h1 className="text-lg font-semibold tracking-tight">Warpsurf</h1>
          {!isConnected && <span className="text-xs text-amber-500 ml-2">Connecting...</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-[#262622] text-slate-400 hover:text-red-400' : 'hover:bg-[#efeee8] text-gray-500 hover:text-red-500'}`}
            title="Delete all workflows">
            <FiTrash2 className="h-5 w-5" />
          </button>
          <button
            onClick={openSettings}
            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-[#262622]' : 'hover:bg-[#efeee8]'}`}
            title="Settings">
            <FiSettings className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={`rounded-xl p-6 max-w-sm mx-4 ${isDarkMode ? 'bg-slate-800' : 'bg-white'}`}>
            <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
              Delete All Workflows?
            </h3>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
              This will remove all workflow history. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-gray-100 hover:bg-gray-200'}`}>
                Cancel
              </button>
              <button
                onClick={handleDeleteAll}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white">
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-[#2f2f29]' : 'border-[#deded7]'}`}>
        <AgentInputBar
          isDarkMode={isDarkMode}
          onSendMessage={handleSendMessage}
          disabled={!isConnected}
          autoContextEnabled={autoContextEnabled}
          autoContextTabIds={autoContextTabIds}
          onAutoContextToggle={handleAutoContextToggle}
          onContextTabsCapture={handleContextTabsCapture}
          onMicClick={stt.handleMicClick}
          onMicStop={stt.stopRecording}
          isRecording={stt.isRecording}
          isProcessingSpeech={stt.isProcessing}
          recordingDurationMs={stt.recordingDurationMs}
          audioLevel={stt.audioLevel}
          sttConfigured={sttConfigured}
          onOpenVoiceSettings={() => {
            try {
              chrome.storage.local.set({ 'settings.pendingTab': 'voice' });
              chrome.runtime.openOptionsPage();
            } catch {}
          }}
        />
      </div>

      {/* Search bar */}
      <div className={`px-6 py-3 border-b ${isDarkMode ? 'border-[#2f2f29]' : 'border-[#deded7]'}`}>
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 ${isDarkMode ? 'bg-[#191917] border border-[#2f2f29]' : 'bg-[#fbfbf9] border border-[#deded7]'}`}>
          <FiSearch className={`h-4 w-4 flex-shrink-0 ${isDarkMode ? 'text-slate-400' : 'text-gray-400'}`} />
          <input
            type="text"
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className={`flex-1 bg-transparent outline-none text-sm ${isDarkMode ? 'text-slate-200 placeholder-slate-500' : 'text-gray-700 placeholder-gray-400'}`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className={`p-0.5 rounded ${isDarkMode ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-400'}`}>
              <FiX className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Gallery */}
      <main className="flex-1 overflow-y-auto p-6">
        <AgentGallery
          activeAgents={activeAgents}
          recentAgents={recentAgents}
          moreAgents={moreAgents}
          isDarkMode={isDarkMode}
          onSelectAgent={handleSelectAgent}
          onDeleteAgent={handleDeleteAgent}
          searchQuery={searchQuery}
        />
      </main>

      {/* Per-chat disclaimer */}
      {showPerChatDisclaimer && (
        <DisclaimerModal
          isDarkMode={isDarkMode}
          message={PER_CHAT_DISCLAIMER_MESSAGE}
          extraNote={PER_CHAT_DISCLAIMER_EXTRA_NOTE}
          onAccept={handleDisclaimerAccept}
        />
      )}

      {/* Privacy modal */}
      {autoTabContextPrivacyModal}

      {/* Microphone permission overlay */}
      {stt.showPermissionOverlay && (
        <MicrophonePermissionOverlay
          permissionState={stt.permissionState}
          isDarkMode={isDarkMode}
          onRequestPermission={stt.openPermissionPopup}
          onDismiss={stt.dismissPermissionOverlay}
        />
      )}
    </div>
  );
}
