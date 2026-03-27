import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Actors, chatHistoryStore } from '@extension/storage';
import type { Attachment } from '@extension/storage/lib/chat/types';
import favoritesStorage from '@extension/storage/lib/prompt/favorites';
import { dedupeMessages, reorderLiveInjected, mergeMetadata } from '../utils';

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
  setCurrentPlan,
  setQueuedMessages,
  setCurrentTaskAgentType,
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
  setCurrentPlan?: (v: Array<{ text: string; status: string }> | null) => void;
  setQueuedMessages?: (v: string[]) => void;
  setCurrentTaskAgentType?: (v: string | null) => void;
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

        // Clear transient state to prevent leakage between sessions
        if (setMirrorPreview) setMirrorPreview(null);
        if (setMirrorPreviewBatch) setMirrorPreviewBatch([]);
        setCurrentPlan?.(null);
        setQueuedMessages?.([]);
        setCurrentTaskAgentType?.(null);

        // Load persisted metadata
        let restoredRootId: string | null = null;
        let savedMetadata: any = null;
        let savedSummaries: any = null;
        try {
          const [loadedSummaries, loadedMetadata, savedStats, savedAttachments] = await Promise.all([
            chatHistoryStore.loadRequestSummaries(sessionId).catch(() => ({})),
            chatHistoryStore.loadMessageMetadata(sessionId).catch(() => ({})),
            chatHistoryStore.loadSessionStats(sessionId).catch(() => null),
            chatHistoryStore.loadAttachments(sessionId).catch(() => ({})),
          ]);
          savedMetadata = loadedMetadata;
          savedSummaries = loadedSummaries;
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

          setRequestSummaries(prev => ({
            ...(savedSummaries && typeof savedSummaries === 'object' ? savedSummaries : {}),
            ...prev,
          }));
          setMessageMetadata(prev =>
            mergeMetadata(savedMetadata && typeof savedMetadata === 'object' ? savedMetadata : {}, prev),
          );
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

        // Reconcile rootId: if the stored __sessionRootId doesn't match any
        // loaded message (rootId mismatch between panel and background), fall
        // back to the last agent message's messageId so plan/graph data is
        // correctly attached on reload.
        let effectiveRootId = restoredRootId;
        const loadedMessages: any[] = hasMessages ? (fullSession.messages as any[]) : [];
        if (effectiveRootId && loadedMessages.length > 0) {
          const matchesMessage = loadedMessages.some((m: any) => `${m.timestamp}-${m.actor}` === effectiveRootId);
          if (!matchesMessage) {
            const agentActors = [
              Actors.AGENT_NAVIGATOR,
              Actors.AGENT_PLANNER,
              Actors.AGENT_VALIDATOR,
              Actors.CHAT,
              Actors.SEARCH,
              Actors.MULTIAGENT,
            ];
            const lastAgent = [...loadedMessages].reverse().find((m: any) => agentActors.includes(m.actor));
            if (lastAgent) {
              const corrected = `${lastAgent.timestamp}-${lastAgent.actor}`;
              logger.log('[handleSessionSelect] rootId mismatch — corrected', {
                stored: effectiveRootId,
                corrected,
              });
              // Merge metadata from the mismatched rootId into the corrected one
              // so trace items, isCompleted, etc. from background persist are available.
              if (savedMetadata) {
                const bgMeta = (savedMetadata as any)[effectiveRootId];
                const panelMeta = (savedMetadata as any)[corrected];
                if (bgMeta && typeof bgMeta === 'object') {
                  const merged = { ...(panelMeta || {}), ...bgMeta };
                  (savedMetadata as any)[corrected] = merged;
                  (savedMetadata as any).__sessionRootId = corrected;
                  setMessageMetadata({ ...savedMetadata });
                }
              }
              // Also reconcile request summaries keyed by the old rootId
              if (savedSummaries && (savedSummaries as any)[effectiveRootId] && !(savedSummaries as any)[corrected]) {
                (savedSummaries as any)[corrected] = (savedSummaries as any)[effectiveRootId];
                setRequestSummaries({ ...savedSummaries });
              }
              effectiveRootId = corrected;
            }
          }
        }

        // Set trajectory refs
        if (agentTraceRootIdRef) agentTraceRootIdRef.current = effectiveRootId;
        if (setAgentTraceRootId) setAgentTraceRootId(effectiveRootId);

        // Restore persisted plan items from metadata
        try {
          const planItems = (savedMetadata as any)?.__workflowPlanItems;
          if (Array.isArray(planItems) && planItems.length > 0) {
            setCurrentPlan?.(planItems);
          }
        } catch {}

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
          /^Commodore planning/i,
          /^Quartermaster assigning/i,
          /^Mission planned/i,
          /^Plan created/i,
          /^\d+\s+Crew\s+deployed\b/i,
          /^Crew\s+\d+\s+deployed:/i,
        ];
        const isStaleContent = (c: string) => {
          const t = c.trim();
          return !t || STALE_CONTENT_RE.some(re => re.test(t));
        };

        // Reconstruct stale aggregate root content BEFORE dedup so that
        // duplicate root messages (from panel + background race) have matching
        // content and get caught by the deduplication pass.
        let rawMessages = hasMessages ? (fullSession.messages as any[]) : [];
        let reconstructedContent: string | undefined;
        if (effectiveRootId && savedMetadata) {
          const rootMeta = (savedMetadata as any)?.[effectiveRootId];
          if (rootMeta?.isCompleted && Array.isArray(rootMeta.traceItems) && rootMeta.traceItems.length > 0) {
            const rootMsg = rawMessages.find((m: any) => `${m.timestamp}-${m.actor}` === effectiveRootId);
            const storedContent = String((rootMsg as any)?.content ?? '').trim();
            if (isStaleContent(storedContent)) {
              const storedFinal = rootMeta.finalAnswerContent;
              if (storedFinal && typeof storedFinal === 'string' && storedFinal.trim()) {
                reconstructedContent = storedFinal.trim();
              } else {
                const traceItems = rootMeta.traceItems as Array<{
                  actor: string;
                  content: string;
                  timestamp: number;
                }>;
                const STATUS_ONLY_RE = /^(Workflow completed|Task cancelled)$/i;
                const FINAL_ANSWER_PREFIX_RE = /^Final answer:\s*/i;
                const stripFinalPrefix = (c: string) => c.replace(FINAL_ANSWER_PREFIX_RE, '');
                const lastSubstantial = [...traceItems].reverse().find(t => {
                  const c = t.content?.trim();
                  return c && !isStaleContent(c) && !STATUS_ONLY_RE.test(c);
                });
                const lastSystem = [...traceItems]
                  .reverse()
                  .find(t => t.actor === Actors.SYSTEM || t.actor?.toLowerCase?.() === 'system');
                const raw =
                  lastSubstantial?.content || lastSystem?.content || traceItems[traceItems.length - 1]?.content;
                reconstructedContent = raw ? stripFinalPrefix(raw) : undefined;
              }
              if (reconstructedContent) {
                rawMessages = rawMessages.map((m: any) => {
                  const msgId = `${m.timestamp}-${m.actor}`;
                  if (msgId === effectiveRootId) return { ...m, content: reconstructedContent };
                  return m;
                });
              }
            }
          }
        }
        // Reconstruct stale content for ALL completed aggregate roots (not just the current one).
        if (savedMetadata) {
          rawMessages = rawMessages.map((m: any) => {
            const mid = `${m.timestamp}-${m.actor}`;
            if (mid === effectiveRootId) return m;
            const meta = (savedMetadata as any)?.[mid];
            if (!meta?.isCompleted || !Array.isArray(meta.traceItems) || meta.traceItems.length === 0) return m;
            const content = String(m.content ?? '').trim();
            if (!isStaleContent(content)) return m;
            const finalAnswer = meta.finalAnswerContent;
            if (finalAnswer && typeof finalAnswer === 'string' && finalAnswer.trim()) {
              return { ...m, content: finalAnswer.trim() };
            }
            const items = meta.traceItems as Array<{ actor: string; content: string }>;
            const last = [...items].reverse().find(t => t.content?.trim() && !isStaleContent(t.content));
            return last ? { ...m, content: last.content } : m;
          });
        }

        if (effectiveRootId) rawMessages = reorderLiveInjected(rawMessages, effectiveRootId);

        let finalMessages = dedupeMessages(rawMessages);

        // Remove standalone SYSTEM messages that duplicate the aggregate root content
        // (e.g. a separate "Task cancelled" SYSTEM message when the aggregate root
        // already shows "Task cancelled").
        if (effectiveRootId) {
          const rootMsg = finalMessages.find((m: any) => `${m.timestamp}-${m.actor}` === effectiveRootId);
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

        // For multiagent sessions, filter out standalone crew worker messages
        const isMultiagentSession =
          savedMetadata?.__sessionRootId &&
          ((savedMetadata as any)[savedMetadata.__sessionRootId]?.workerItems?.length > 0 ||
            (savedMetadata as any)[savedMetadata.__sessionRootId]?.workerSessionMap?.length > 0);
        if (isMultiagentSession && effectiveRootId) {
          finalMessages = finalMessages.filter((m: any) => {
            const mid = `${m.timestamp}-${m.actor}`;
            if (mid === effectiveRootId) return true;
            const actor = String(m.actor || '');
            if (actor === Actors.USER) return true;
            if (actor === Actors.SYSTEM || actor.toLowerCase() === 'system') return true;
            if (actor === Actors.MULTIAGENT) return true;
            if (actor === Actors.ESTIMATOR) return true;
            return false;
          });
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
      setCurrentPlan,
      setQueuedMessages,
      setCurrentTaskAgentType,
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
