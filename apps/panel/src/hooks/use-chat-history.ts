import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import { chatHistoryStore } from '@extension/storage';
import favoritesStorage from '@extension/storage/lib/prompt/favorites';

type ChatSessionMeta = { id: string; title: string; createdAt: number; updatedAt: number };

export function useChatHistory({
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
  handleBackToChat,
  setFavoritePrompts,
  agentTraceRootIdRef,
  setAgentTraceRootId,
  setMirrorPreview,
  setMirrorPreviewBatch,
}: {
  logger: { log: (...args: any[]) => void; error: (...args: any[]) => void };
  setMessages: (v: any) => void;
  setCurrentSessionId: (id: string | null) => void;
  sessionIdRef: MutableRefObject<string | null>;
  setIsFollowUpMode: (v: boolean) => void;
  setIsHistoricalSession: (v: boolean) => void;
  setInputEnabled: (v: boolean) => void;
  setShowStopButton: (v: boolean) => void;
  setShowDashboard: (v: boolean) => void;
  setRequestSummaries: (v: any) => void;
  setMessageMetadata: (v: any) => void;
  setSessionStats: (v: any) => void;
  showToast?: (msg: string) => void;
  handleBackToChat?: (reset?: boolean) => void;
  setFavoritePrompts?: (v: any) => void;
  agentTraceRootIdRef?: MutableRefObject<string | null>;
  setAgentTraceRootId?: (v: string | null) => void;
  setMirrorPreview?: (v: any) => void;
  setMirrorPreviewBatch?: (v: any) => void;
}) {
  const [chatSessions, setChatSessions] = useState<ChatSessionMeta[]>([]);

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await chatHistoryStore.getSessionsMetadata();
      setChatSessions(sessions.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)));
    } catch (error) {
      logger.error('Failed to load chat sessions:', error);
    }
  }, [logger]);

  const handleSessionSelect = useCallback(
    async (sessionId: string): Promise<boolean> => {
      try {
        const fullSession = await chatHistoryStore.getSession(sessionId);
        const hasMessages = fullSession && fullSession.messages.length > 0;

        // Set session ID first for proper event filtering
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
        setShowDashboard(false);

        // Clear preview state to prevent leakage between sessions
        if (setMirrorPreview) setMirrorPreview(null);
        if (setMirrorPreviewBatch) setMirrorPreviewBatch([]);

        // Load persisted metadata FIRST before setting any UI state
        // This prevents race conditions where events arrive before we've restored the rootId
        let restoredRootId: string | null = null;
        try {
          const [savedSummaries, savedMetadata, savedStats] = await Promise.all([
            chatHistoryStore.loadRequestSummaries(sessionId).catch(() => ({})),
            chatHistoryStore.loadMessageMetadata(sessionId).catch(() => ({})),
            chatHistoryStore.loadSessionStats(sessionId).catch(() => null),
          ]);

          setRequestSummaries(savedSummaries && typeof savedSummaries === 'object' ? savedSummaries : {});
          setMessageMetadata(savedMetadata && typeof savedMetadata === 'object' ? savedMetadata : {});
          if (savedStats) setSessionStats(savedStats);

          // Get stored rootId for restoration
          restoredRootId = (savedMetadata as any)?.__sessionRootId || null;
        } catch (e) {
          logger.error('Failed to load session metadata:', e);
          setRequestSummaries({});
          setMessageMetadata({});
        }

        // Now set trajectory ref - either to restored value or null
        // CRITICAL: Do this AFTER loading metadata to prevent race condition
        if (agentTraceRootIdRef) agentTraceRootIdRef.current = restoredRootId;
        if (setAgentTraceRootId) setAgentTraceRootId(restoredRootId);

        // Set messages and common state
        setMessages(hasMessages ? fullSession.messages : []);
        setIsFollowUpMode(true);
        setIsHistoricalSession(false);
        setInputEnabled(true);

        // Check if session is running
        try {
          const result = await chrome.storage.local.get('agent_dashboard_running');
          const running = Array.isArray(result.agent_dashboard_running) ? result.agent_dashboard_running : [];
          setShowStopButton(running.some((a: any) => String(a.sessionId) === String(sessionId)));
        } catch {
          setShowStopButton(false);
        }

        return true;
      } catch (error) {
        logger.error('Failed to load session:', error);
        return false;
      }
    },
    [
      logger,
      setCurrentSessionId,
      sessionIdRef,
      setMessages,
      setIsFollowUpMode,
      setIsHistoricalSession,
      setInputEnabled,
      setShowStopButton,
      setShowDashboard,
      setRequestSummaries,
      setMessageMetadata,
      setSessionStats,
      agentTraceRootIdRef,
      setAgentTraceRootId,
      setMirrorPreview,
      setMirrorPreviewBatch,
    ],
  );

  const handleSessionDelete = useCallback(
    async (sessionId: string) => {
      try {
        await chatHistoryStore.deleteSession(sessionId);
        await loadChatSessions();
        if (sessionId === sessionIdRef.current) {
          setMessages([]);
          setCurrentSessionId(null);
        }
      } catch (error) {
        logger.error('Failed to delete session:', error);
      }
    },
    [logger, loadChatSessions, sessionIdRef, setMessages, setCurrentSessionId],
  );

  const handleSessionBookmark = useCallback(
    async (sessionId: string) => {
      try {
        const fullSession = await chatHistoryStore.getSession(sessionId);
        if (fullSession && fullSession.messages.length > 0) {
          const sessionTitle = fullSession.title;
          const title = sessionTitle.split(' ').slice(0, 8).join(' ');
          const taskContent = fullSession.messages[0]?.content || '';

          // Infer agent type from the first assistant message actor
          let agentType: 'auto' | 'chat' | 'search' | 'agent' | 'multiagent' | undefined;
          const firstAssistantMsg = fullSession.messages.find(m => m.actor !== 'user');
          if (firstAssistantMsg) {
            const actor = String(firstAssistantMsg.actor || '').toLowerCase();
            if (actor === 'chat') agentType = 'chat';
            else if (actor === 'search') agentType = 'search';
            else if (actor === 'multiagent') agentType = 'multiagent';
            else if (actor === 'agent_navigator' || actor === 'agent_planner' || actor === 'agent_validator')
              agentType = 'agent';
            else if (actor === 'auto') agentType = 'auto';
          }

          await favoritesStorage.addPrompt(title, taskContent, agentType);
          if (setFavoritePrompts) {
            const prompts = await favoritesStorage.getAllPrompts();
            setFavoritePrompts(prompts);
          }
          if (handleBackToChat) handleBackToChat(true);
        }
      } catch (error) {
        logger.error('Failed to pin session to favorites:', error);
        if (showToast) showToast('Failed to pin session');
      }
    },
    [logger, showToast, handleBackToChat, setFavoritePrompts],
  );

  const renameSession = useCallback(
    async (sessionId: string, newTitle: string) => {
      try {
        await chatHistoryStore.updateTitle(sessionId, newTitle);
        await loadChatSessions();
      } catch (e) {
        logger.error('Rename failed', e);
      }
    },
    [logger, loadChatSessions],
  );

  return {
    chatSessions,
    loadChatSessions,
    handleSessionSelect,
    handleSessionDelete,
    handleSessionBookmark,
    renameSession,
  } as const;
}
