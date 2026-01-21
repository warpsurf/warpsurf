import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiSettings } from 'react-icons/fi';
import { useAgentManagerConnection } from '@src/hooks/use-agent-manager-connection';
import { AgentGallery } from '@src/components/AgentGallery';
import { AgentInputBar } from '@src/components/AgentInputBar';
import { useAutoTabContextPrivacyGate } from '@src/hooks/use-auto-tab-context-privacy-gate';
import { generalSettingsStore, warningsSettingsStore } from '@extension/storage';
import type { AgentData } from '@src/types';
import logoImage from '/warpsurflogo.png';

// Time constants
const FIFTEEN_MINS_MS = 15 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export default function AgentManager() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [autoContextEnabled, setAutoContextEnabled] = useState(false);
  const [autoContextTabIds, setAutoContextTabIds] = useState<number[]>([]);

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

  // Categorize agents into Active, Recent, and Older
  const { activeAgents, recentAgents, olderAgents } = useMemo(() => {
    const now = Date.now();
    const active: AgentData[] = [];
    const recent: AgentData[] = [];
    const older: AgentData[] = [];

    for (const agent of agents) {
      const isRunningStatus = ['running', 'paused', 'needs_input'].includes(agent.status);
      const lastActivity = agent.endTime || agent.startTime || 0;
      const isRecentlyActive = now - lastActivity < FIFTEEN_MINS_MS;
      const isWithinDay = now - lastActivity < ONE_DAY_MS;

      // Active: running status OR was active within last 15 minutes
      if (isRunningStatus || isRecentlyActive) {
        active.push(agent);
      } else if (isWithinDay) {
        recent.push(agent);
      } else {
        older.push(agent);
      }
    }

    // Sort each category by activity (needs_input first for active, then by time)
    const sortByActivity = (a: AgentData, b: AgentData) => {
      if (a.status === 'needs_input' && b.status !== 'needs_input') return -1;
      if (b.status === 'needs_input' && a.status !== 'needs_input') return 1;
      const timeA = a.endTime || a.startTime || 0;
      const timeB = b.endTime || b.startTime || 0;
      return timeB - timeA;
    };

    active.sort(sortByActivity);
    recent.sort(sortByActivity);
    older.sort(sortByActivity);

    return { activeAgents: active, recentAgents: recent, olderAgents: older };
  }, [agents]);

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
        <button
          onClick={openSettings}
          className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}
          title="Settings">
          <FiSettings className="h-5 w-5" />
        </button>
      </header>

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

      {/* Gallery */}
      <main className="flex-1 overflow-y-auto p-6">
        <AgentGallery
          activeAgents={activeAgents}
          recentAgents={recentAgents}
          olderAgents={olderAgents}
          isDarkMode={isDarkMode}
          onSelectAgent={handleSelectAgent}
        />
      </main>

      {/* Privacy modal */}
      {autoTabContextPrivacyModal}
    </div>
  );
}
