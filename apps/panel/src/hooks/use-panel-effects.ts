import { useEffect, type MutableRefObject } from 'react';
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
  logger: any;
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
  promptPerChatIfEnabled?: () => void;
}) {
  const { portRef, sessionIdRef, isReplayingRef, jobActiveRef, isAgentModeActiveRef, promptedOnOpenRef, historyCompletedTimerRef, panelRef, messagesEndRef, logger, stopConnection, setPaletteOpen, setFishMenuOpen, setAgentSettingsOpen, setFeedbackMenuOpen, setMoreMenuOpen, setHasConfiguredModels, setHasProviders, setReplayEnabled, setDisplayHighlights, setUseVisionState, setShowTabPreviews, setUseFullPlanningPipeline, setEnablePlanner, setEnableValidator, setFavoritePrompts, setShowJumpToLatest, setShowEmergencyStop, currentSessionId, isReplaying, isJobActive, isAgentModeActive, messages, firstRunAccepted, disablePerChatWarnings, isFollowUpMode, isHistoricalSession, showTabPreviews, resetPerChatAcceptance, promptPerChatIfEnabled } = params;
  
  // Sync refs
  useEffect(() => { sessionIdRef.current = currentSessionId; }, [currentSessionId, sessionIdRef]);
  useEffect(() => { isReplayingRef.current = isReplaying; }, [isReplaying, isReplayingRef]);
  useEffect(() => { isAgentModeActiveRef.current = isAgentModeActive; }, [isAgentModeActive, isAgentModeActiveRef]);
  useEffect(() => { jobActiveRef.current = isJobActive; }, [isJobActive, jobActiveRef]);
  
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
    const handleVisibilityChange = () => { if (!document.hidden) check(); };
    const handleFocus = () => check();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [logger, setHasConfiguredModels, setHasProviders]);
  
  // Settings loading
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
  }, [logger, setReplayEnabled, setDisplayHighlights, setUseVisionState, setShowTabPreviews, setUseFullPlanningPipeline, setEnablePlanner, setEnableValidator, setShowEmergencyStop]);
  
  // Per-chat disclaimer
  useEffect(() => {
    try {
      if (firstRunAccepted !== true) return;
      if (promptedOnOpenRef.current) return;
      const isStartingFresh = !sessionIdRef.current && !isFollowUpMode && !isHistoricalSession;
      if (isStartingFresh && !disablePerChatWarnings) {
        promptedOnOpenRef.current = true;
        resetPerChatAcceptance?.();
        promptPerChatIfEnabled?.();
      }
    } catch {}
  }, [firstRunAccepted, disablePerChatWarnings, isFollowUpMode, isHistoricalSession, resetPerChatAcceptance, promptPerChatIfEnabled, promptedOnOpenRef, sessionIdRef]);
  
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
    const check = () => { try { portRef.current?.postMessage({ type: 'check_history_context' }); } catch {} };
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
          await favoritesStorage.addPrompt('Shopping', 'Navigate to the Nike website and find the latest women\'s running shoes', 'agent');
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
  
  // Scroll to bottom
  useEffect(() => {
    const container = panelRef.current?.querySelector('.messages-scroll') as HTMLElement | null;
    if (!container) return;
    if (container.scrollHeight - container.scrollTop - container.clientHeight < 80) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, panelRef, messagesEndRef]);
  
  // Jump-to-latest
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

