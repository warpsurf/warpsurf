import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Actors, chatHistoryStore } from '@extension/storage';
import type { Attachment } from '@extension/storage/lib/chat/types';
import favoritesStorage from '@extension/storage/lib/prompt/favorites';
import { isTransientSystemMessage, sanitizeMessageContent } from '../utils';

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
  setSessionAttachments,
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
  setSessionAttachments?: (v: Record<string, Attachment>) => void;
}) {
  const [chatSessions, setChatSessions] = useState<ChatSessionMeta[]>([]);

  const dedupeMessages = useCallback((messages: any[] | undefined | null) => {
    const list = Array.isArray(messages) ? messages : [];
    const WINDOW_MS = 5000;
    const seenEventIds = new Set<string>();
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

    // Normalize content for deduplication (strip leading status icons)
    const normalizeForDedupe = (content: string): string => {
      return content.replace(/^[✓✗]\s*/, '').trim();
    };

    // Extract setting name from "settingName set to value" pattern
    const extractSettingName = (content: string): string | null => {
      const normalized = normalizeForDedupe(content);
      const match = normalized.match(/^(\w+)\s+set\s+to\s+/i);
      return match ? match[1].toLowerCase() : null;
    };

    // Track seen content to detect duplicates regardless of timestamp
    const seenContent = new Set<string>();

    // Track setting changes to keep only the last value for each setting
    const settingChanges = new Map<string, { index: number; ts: number }>();

    for (let msg of list) {
      const actor = String((msg as any)?.actor || '');
      let content = String((msg as any)?.content ?? '').trim();

      // Skip transient system messages
      if (isTransientSystemMessage(actor, content)) {
        continue;
      }

      // Sanitize internal implementation details before display
      const sanitized = sanitizeMessageContent(content);
      if (sanitized === null) continue;
      if (sanitized !== content) {
        msg = { ...msg, content: sanitized };
        content = sanitized;
      }

      const eventId = String((msg as any)?.eventId || '').trim();
      if (eventId) {
        if (seenEventIds.has(eventId)) continue;
        seenEventIds.add(eventId);
      }
      const isSystem = actor === Actors.SYSTEM || actor.toLowerCase() === 'system';
      const ts = Number((msg as any)?.timestamp || 0);
      if (!content) {
        out.push(msg);
        continue;
      }

      // Skip duplicate content from the same actor (normalize to handle ✓/✗ prefix variations)
      const normalizedContent = normalizeForDedupe(content);
      const contentKey = `${actor}|${normalizedContent}`;
      if (seenContent.has(contentKey)) {
        continue;
      }
      seenContent.add(contentKey);

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

      // For setting changes, remove previous value if a new value is set within the window
      const settingName = extractSettingName(content);
      if (settingName && actor.toLowerCase() === 'tool') {
        const prev = settingChanges.get(settingName);
        if (prev && Math.abs(ts - prev.ts) <= WINDOW_MS) {
          // Remove the previous setting change message
          out.splice(prev.index, 1);
          // Update indices in settingChanges for messages after the removed one
          for (const [key, val] of settingChanges.entries()) {
            if (val.index > prev.index) {
              settingChanges.set(key, { index: val.index - 1, ts: val.ts });
            }
          }
        }
        // Record index where this message will be pushed (current length of out)
        settingChanges.set(settingName, { index: out.length, ts });
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
        let savedMetadata: any = null;
        try {
          const [savedSummaries, loadedMetadata, savedStats, savedAttachments] = await Promise.all([
            chatHistoryStore.loadRequestSummaries(sessionId).catch(() => ({})),
            chatHistoryStore.loadMessageMetadata(sessionId).catch(() => ({})),
            chatHistoryStore.loadSessionStats(sessionId).catch(() => null),
            chatHistoryStore.loadAttachments(sessionId).catch(() => ({})),
          ]);
          savedMetadata = loadedMetadata;
          if (setSessionAttachments) setSessionAttachments(savedAttachments || {});

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

        // Reconstruct stale aggregate root message content from metadata.
        // Older sessions may have persisted the initial transient status (e.g.
        // "Starting browser automation...") because updateAggregateRootContent
        // only updated React state. Reconstruct from the trace items only when
        // the stored content is a known transient placeholder.
        const STALE_CONTENT_RE = [
          /^Starting browser/i,
          /^Initializing/i,
          /^Navigation done$/i,
          /^Navigating\.\.\.$/i,
          /^Action (started|completed|failed)$/i,
          /^(Creating|Processing|Refining) plan/i,
          /^(Navigator|Planner|Validator) (started|failed)/i,
          /^Showing progress\.\.\.$/i,
          /^Processing as /i,
          /^Estimating workflow\.\.\.$/i,
          /^\d+\s+workers executing plan\b/i,
          /^Cancelling workflow$/i,
        ];
        const isStaleContent = (c: string) => {
          const t = c.trim();
          return !t || STALE_CONTENT_RE.some(re => re.test(t));
        };

        let finalMessages = hasMessages ? dedupeMessages(fullSession.messages) : [];
        let reconstructedContent: string | undefined;
        if (restoredRootId && savedMetadata) {
          const rootMeta = (savedMetadata as any)?.[restoredRootId];
          if (rootMeta?.isCompleted && Array.isArray(rootMeta.traceItems) && rootMeta.traceItems.length > 0) {
            const rootMsg = finalMessages.find((m: any) => `${m.timestamp}-${m.actor}` === restoredRootId);
            const storedContent = String((rootMsg as any)?.content ?? '').trim();
            if (isStaleContent(storedContent)) {
              const traceItems = rootMeta.traceItems as Array<{ actor: string; content: string; timestamp: number }>;
              const STATUS_ONLY_RE = /^(Workflow completed|Task cancelled)$/i;
              const lastSubstantial = [...traceItems].reverse().find(t => {
                const c = t.content?.trim();
                return c && !isStaleContent(c) && !STATUS_ONLY_RE.test(c);
              });
              const lastSystem = [...traceItems]
                .reverse()
                .find(t => t.actor === Actors.SYSTEM || t.actor?.toLowerCase?.() === 'system');
              const bestContent =
                lastSubstantial?.content || lastSystem?.content || traceItems[traceItems.length - 1]?.content;
              if (bestContent) {
                reconstructedContent = bestContent;
                finalMessages = finalMessages.map((m: any) => {
                  const msgId = `${m.timestamp}-${m.actor}`;
                  if (msgId === restoredRootId) return { ...m, content: bestContent };
                  return m;
                });
              }
            }
          }
        }

        // Remove standalone SYSTEM messages that duplicate the aggregate root content
        // (e.g. a separate "Task cancelled" SYSTEM message when the aggregate root
        // already shows "Task cancelled").
        if (restoredRootId) {
          const rootMsg = finalMessages.find((m: any) => `${m.timestamp}-${m.actor}` === restoredRootId);
          const rootContent = reconstructedContent || String((rootMsg as any)?.content ?? '').trim();
          if (rootContent) {
            const rootTs = Number((rootMsg as any)?.timestamp || 0);
            finalMessages = finalMessages.filter((m: any) => {
              const actor = String((m as any)?.actor || '');
              const isSystem = actor === Actors.SYSTEM || actor.toLowerCase() === 'system';
              if (!isSystem) return true;
              const content = String((m as any)?.content ?? '').trim();
              if (content !== rootContent) return true;
              if (!rootTs) return true;
              const ts = Number((m as any)?.timestamp || 0);
              return Math.abs(ts - rootTs) > 10000;
            });
          }
        }

        // Set messages and common state
        setMessages(finalMessages);
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
            else if (actor === 'auto' || actor === 'tool') agentType = 'auto';
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
