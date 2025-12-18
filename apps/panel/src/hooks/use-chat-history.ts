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

  const handleSessionSelect = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);
      if (fullSession && fullSession.messages.length > 0) {
        logger.log('Loaded session messages count:', fullSession.messages.length);
        try { logger.log('First 3 messages snapshot:', fullSession.messages.slice(0, 3)); } catch {}
        setCurrentSessionId(fullSession.id);
        sessionIdRef.current = fullSession.id;
        setMessages(fullSession.messages);
        setIsFollowUpMode(true);
        setIsHistoricalSession(false);
        setInputEnabled(true);
        try {
          const runningKey = 'agent_dashboard_running';
          const result = await chrome.storage.local.get(runningKey);
          const running = Array.isArray(result[runningKey]) ? result[runningKey] : [];
          const isRunning = running.some((a: any) => String(a.sessionId) === String(sessionId));
          setShowStopButton(!!isRunning);
        } catch {
          setShowStopButton(false);
        }
        setShowDashboard(false);
        try {
          const [savedSummaries, savedMetadata, savedStats] = await Promise.all([
            chatHistoryStore.loadRequestSummaries(sessionId).catch(() => ({} as any)),
            chatHistoryStore.loadMessageMetadata(sessionId).catch(() => ({} as any)),
            chatHistoryStore.loadSessionStats(sessionId).catch(() => null),
          ]);
          if (savedSummaries && typeof savedSummaries === 'object') setRequestSummaries(savedSummaries as any); else setRequestSummaries({});
          if (savedMetadata && typeof savedMetadata === 'object') setMessageMetadata(savedMetadata as any); else setMessageMetadata({});
          if (savedStats) setSessionStats(savedStats as any); else setSessionStats((prev: any) => ({ ...prev }));
        } catch (e) {
          logger.error('Failed to load persisted summaries/metadata/stats:', e);
          setRequestSummaries({});
          setMessageMetadata({});
        }
        logger.log('history session selected', sessionId);
        return true;
      } else {
        logger.log('Session not found or empty:', sessionId);
        return false;
      }
    } catch (error) {
      logger.error('Failed to load session:', error);
      return false;
    }
  }, [logger, setCurrentSessionId, sessionIdRef, setMessages, setIsFollowUpMode, setIsHistoricalSession, setInputEnabled, setShowStopButton, setShowDashboard, setRequestSummaries, setMessageMetadata, setSessionStats]);

  const handleSessionDelete = useCallback(async (sessionId: string) => {
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
  }, [logger, loadChatSessions, sessionIdRef, setMessages, setCurrentSessionId]);

  const handleSessionBookmark = useCallback(async (sessionId: string) => {
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
          else if (actor === 'agent_navigator' || actor === 'agent_planner' || actor === 'agent_validator') agentType = 'agent';
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
  }, [logger, showToast, handleBackToChat, setFavoritePrompts]);

  const renameSession = useCallback(async (sessionId: string, newTitle: string) => {
    try {
      await chatHistoryStore.updateTitle(sessionId, newTitle);
      await loadChatSessions();
    } catch (e) {
      logger.error('Rename failed', e);
    }
  }, [logger, loadChatSessions]);

  return {
    chatSessions,
    loadChatSessions,
    handleSessionSelect,
    handleSessionDelete,
    handleSessionBookmark,
    renameSession,
  } as const;
}


