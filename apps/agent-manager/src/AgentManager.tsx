import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiSettings, FiTrash2, FiSearch, FiX } from 'react-icons/fi';
import { useAgentManagerConnection } from '@src/hooks/use-agent-manager-connection';
import { AgentGallery } from '@src/components/AgentGallery';
import { AgentInputBar } from '@src/components/AgentInputBar';
import { useAutoTabContextPrivacyGate } from '@src/hooks/use-auto-tab-context-privacy-gate';
import { generalSettingsStore, warningsSettingsStore } from '@extension/storage';
import type { AgentData } from '@src/types';
import logoImage from '/warpsurflogo.png';
import { AGENT_ACTIVITY_THRESHOLDS } from '@extension/shared/lib/utils';

export default function AgentManager() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [autoContextEnabled, setAutoContextEnabled] = useState(false);
  const [autoContextTabIds, setAutoContextTabIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Privacy gate for auto-tab context
  const { promptAutoTabContextPrivacy, autoTabContextPrivacyModal } = useAutoTabContextPrivacyGate(isDarkMode);

  // Detect system dark mode preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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

    // Refresh on tab changes
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
  }, []);

  // Handle auto-context toggle (with privacy gate)
  const handleAutoContextToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        // Prompt privacy modal
        const accepted = await promptAutoTabContextPrivacy();
        if (!accepted) return;
      }
      // Update settings
      await generalSettingsStore.updateSettings({ enableAutoTabContext: enabled });
    },
    [promptAutoTabContextPrivacy],
  );

  const { agents, sendNewTask, openSidepanelToSession, isConnected } = useAgentManagerConnection();

  // Filter agents by search query
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter(
      agent => agent.sessionTitle?.toLowerCase().includes(q) || agent.taskDescription?.toLowerCase().includes(q),
    );
  }, [agents, searchQuery]);

  // Delete all agents from storage
  const handleDeleteAll = useCallback(async () => {
    await chrome.storage.local.set({
      agent_dashboard_running: [],
      agent_dashboard_completed: [],
    });
    setShowDeleteConfirm(false);
  }, []);

  // Delete a specific agent from storage
  const handleDeleteAgent = useCallback(async (agent: AgentData) => {
    const [running, completed] = await Promise.all([
      chrome.storage.local.get('agent_dashboard_running'),
      chrome.storage.local.get('agent_dashboard_completed'),
    ]);
    await chrome.storage.local.set({
      agent_dashboard_running: (running.agent_dashboard_running || []).filter(
        (a: any) => a.sessionId !== agent.sessionId,
      ),
      agent_dashboard_completed: (completed.agent_dashboard_completed || []).filter(
        (a: any) => a.sessionId !== agent.sessionId,
      ),
    });
    // Also remove persisted preview cache for this session
    try {
      await chrome.storage.local.remove(`preview_cache_${agent.sessionId}`);
    } catch {}
  }, []);

  // Categorize agents into Active, Recent, and More
  const { activeAgents, recentAgents, moreAgents } = useMemo(() => {
    const now = Date.now();
    const active: AgentData[] = [];
    const recent: AgentData[] = [];
    const more: AgentData[] = [];

    for (const agent of filteredAgents) {
      const isRunningStatus = ['running', 'paused', 'needs_input'].includes(agent.status);
      const lastActivity = agent.preview?.lastUpdated || agent.endTime || agent.startTime || 0;
      const isWithinRecentWindow = now - lastActivity < AGENT_ACTIVITY_THRESHOLDS.ACTIVE_MS;

      // Active: currently running status only
      if (isRunningStatus) {
        active.push(agent);
      } else if (isWithinRecentWindow) {
        // Recent: not running, but last activity within 15 minutes
        recent.push(agent);
      } else {
        // More: everything else
        more.push(agent);
      }
    }

    // Sort each category by activity (needs_input first for active, then by time)
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

  const handleSendMessage = useCallback(
    async (text: string, agentType?: string, contextTabIds?: number[]) => {
      await sendNewTask(text, agentType, contextTabIds);
    },
    [sendNewTask],
  );

  const handleSelectAgent = useCallback(
    (agent: AgentData) => {
      openSidepanelToSession(agent.sessionId);
    },
    [openSidepanelToSession],
  );

  const openSettings = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  return (
    <div
      className={`min-h-screen flex flex-col ${isDarkMode ? 'bg-slate-900 text-slate-200' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header */}
      <header
        className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-white/80'}`}>
        <div className="flex items-center gap-3">
          <img src={logoImage} alt="Warpsurf" className="h-8 w-8" />
          <h1 className="text-xl font-semibold">Agent Manager</h1>
          {!isConnected && <span className="text-xs text-amber-500 ml-2">Connecting...</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-slate-400 hover:text-red-400' : 'hover:bg-gray-100 text-gray-500 hover:text-red-500'}`}
            title="Delete all workflows">
            <FiTrash2 className="h-5 w-5" />
          </button>
          <button
            onClick={openSettings}
            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}
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
      <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
        <AgentInputBar
          isDarkMode={isDarkMode}
          onSendMessage={handleSendMessage}
          disabled={!isConnected}
          autoContextEnabled={autoContextEnabled}
          autoContextTabIds={autoContextTabIds}
          onAutoContextToggle={handleAutoContextToggle}
        />
      </div>

      {/* Search bar */}
      <div className={`px-6 py-3 border-b ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 ${isDarkMode ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200'}`}>
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

      {/* Privacy modal */}
      {autoTabContextPrivacyModal}
    </div>
  );
}
