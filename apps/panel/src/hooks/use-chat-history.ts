import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Actors, chatHistoryStore } from '@extension/storage';
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
  portRef,
  setIsJobActive,
  lastEventIdBySessionRef,
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
  portRef?: MutableRefObject<chrome.runtime.Port | null>;
  setIsJobActive?: (v: boolean) => void;
  lastEventIdBySessionRef?: MutableRefObject<Map<string, string>>;
}) {
  const [chatSessions, setChatSessions] = useState<ChatSessionMeta[]>([]);

  const dedupeMessages = useCallback((messages: any[] | undefined | null) => {
    const list = Array.isArray(messages) ? messages : [];
    const WINDOW_MS = 5000;
    const lastByActorContent = new Map<string, number>();
    const lastNonSystemByContent = new Map<string, number>();
    const systemIndexByContent = new Map<string, number>();
    const out: any[] = [];

    const removeSystemAt = (idx: number) => {
      out.splice(idx, 1);
      for (const [key, val] of systemIndexByContent.entries()) {
        if (val === idx) systemIndexByContent.delete(key);
        else if (val > idx) systemIndexByContent.set(key, val - 1);
      }
    };

    for (const msg of list) {
      const actor = String((msg as any)?.actor || '');
      const isSystem = actor === Actors.SYSTEM || actor.toLowerCase() === 'system';
      const content = String((msg as any)?.content ?? '').trim();
      const ts = Number((msg as any)?.timestamp || 0);
      if (!content) {
        out.push(msg);
        continue;
      }
      const key = `${actor}|${content}`;
      const last = lastByActorContent.get(key);
      if (last != null && (last === ts || Math.abs(ts - last) <= WINDOW_MS)) {
        continue;
      }

      if (isSystem) {
        const lastNon = lastNonSystemByContent.get(content);
        if (lastNon != null && Math.abs(ts - lastNon) <= WINDOW_MS) {
          continue;
        }
        const sysIdx = systemIndexByContent.get(content);
        if (sysIdx != null) {
          const prevTs = Number((out[sysIdx] as any)?.timestamp || 0);
          if (Math.abs(ts - prevTs) <= WINDOW_MS) continue;
        }
        systemIndexByContent.set(content, out.length);
      } else {
        const sysIdx = systemIndexByContent.get(content);
        if (sysIdx != null) {
          const prevTs = Number((out[sysIdx] as any)?.timestamp || 0);
          if (Math.abs(ts - prevTs) <= WINDOW_MS) {
            removeSystemAt(sysIdx);
          }
        }
        lastNonSystemByContent.set(content, ts);
      }

      lastByActorContent.set(key, ts);
      out.push(msg);
    }
    return out;
  }, []);

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

        // Load persisted metadata
        let restoredRootId: string | null = null;
        try {
          const [savedSummaries, savedMetadata, savedStats] = await Promise.all([
            chatHistoryStore.loadRequestSummaries(sessionId).catch(() => ({})),
            chatHistoryStore.loadMessageMetadata(sessionId).catch(() => ({})),
            chatHistoryStore.loadSessionStats(sessionId).catch(() => null),
          ]);

          // Get stored rootId for restoration
          restoredRootId = (savedMetadata as any)?.__sessionRootId || null;

          logger.log('[handleSessionSelect] Loaded metadata', {
            sessionId,
            restoredRootId,
            hasMetadata: !!savedMetadata,
            metadataKeys: savedMetadata ? Object.keys(savedMetadata) : [],
            traceItemCount: restoredRootId ? (savedMetadata as any)?.[restoredRootId]?.traceItems?.length : 0,
            isCompleted: restoredRootId ? (savedMetadata as any)?.[restoredRootId]?.isCompleted : undefined,
            hasFinalPreview: restoredRootId ? !!(savedMetadata as any)?.[restoredRootId]?.finalPreview : false,
            hasFinalPreviewBatch: restoredRootId
              ? !!(savedMetadata as any)?.[restoredRootId]?.finalPreviewBatch?.length
              : false,
          });

          setRequestSummaries(savedSummaries && typeof savedSummaries === 'object' ? savedSummaries : {});
          setMessageMetadata(savedMetadata && typeof savedMetadata === 'object' ? savedMetadata : {});
          try {
            if (restoredRootId && lastEventIdBySessionRef) {
              const traceItems = (savedMetadata as any)?.[restoredRootId]?.traceItems || [];
              const lastWithId = [...traceItems].reverse().find((t: any) => t?.eventId);
              if (lastWithId?.eventId) {
                lastEventIdBySessionRef.current.set(String(sessionId), String(lastWithId.eventId));
              }
            }
          } catch {}
          if (savedStats) setSessionStats(savedStats);
        } catch (e) {
          logger.error('Failed to load session metadata:', e);
          setRequestSummaries({});
          setMessageMetadata({});
        }

        // Set trajectory refs
        if (agentTraceRootIdRef) agentTraceRootIdRef.current = restoredRootId;
        if (setAgentTraceRootId) setAgentTraceRootId(restoredRootId);

        // Set messages and common state
        setMessages(hasMessages ? dedupeMessages(fullSession.messages) : []);
        setIsFollowUpMode(true);
        setIsHistoricalSession(false);
        setInputEnabled(true);

        // Check if session is running and subscribe to live events
        let isRunning = false;
        try {
          const result = await chrome.storage.local.get('agent_dashboard_running');
          const running = Array.isArray(result.agent_dashboard_running) ? result.agent_dashboard_running : [];
          isRunning = running.some((a: any) => String(a.sessionId) === String(sessionId));
        } catch {}

        setShowStopButton(isRunning);
        if (setIsJobActive) setIsJobActive(isRunning);

        // Subscribe to session events for live updates
        if (portRef?.current?.name === 'side-panel-connection') {
          try {
            const lastEventId = lastEventIdBySessionRef?.current?.get(String(sessionId));
            portRef.current.postMessage({ type: 'subscribe_to_session', sessionId, lastEventId });
          } catch {}
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
      portRef,
      setIsJobActive,
      lastEventIdBySessionRef,
      dedupeMessages,
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
