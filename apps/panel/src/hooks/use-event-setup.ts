import { useMemo, useCallback, useRef, type MutableRefObject } from 'react';
import { Actors, chatHistoryStore, type Message } from '@extension/storage';
import { createTaskEventHandler } from '../logic/handlers/create-task-event-handler';
import { createPanelHandlers } from '../logic/port-handlers';

export function useEventSetup(params: {
  portRef: MutableRefObject<chrome.runtime.Port | null>;
  sessionIdRef: MutableRefObject<string | null>;
  agentTraceRootIdRef: MutableRefObject<string | null>;
  agentTraceActiveRef: MutableRefObject<boolean>;
  lastAgentMessageRef: MutableRefObject<any>;
  jobActiveRef: MutableRefObject<boolean>;
  laneColorByLaneRef: MutableRefObject<Map<number, string>>;
  processedJobSummariesRef: MutableRefObject<Set<string>>;
  taskIdToRootIdRef: MutableRefObject<Map<string, string>>;
  lastAgentMessageByTaskRef: MutableRefObject<Map<string, any>>;
  closableTaskIdsRef: MutableRefObject<Set<string>>;
  workflowEndedRef: MutableRefObject<boolean>;
  cancelSummaryTargetsRef: MutableRefObject<Map<string, string>>;
  runStartedAtRef: MutableRefObject<number | null>;
  lastUserPromptRef: MutableRefObject<string | null>;
  historyCompletedTimerRef: MutableRefObject<number | null>;
  setInputTextRef: MutableRefObject<((text: string) => void) | null>;
  // Refs for cancellation state management
  isCancellingRef: MutableRefObject<boolean>;
  cancelTimeoutRef: MutableRefObject<number | null>;
  logger: any;
  showToast: (msg: string) => void;
  ensureAgentOrdinal: any;
  chatSessions: any[];
  incognitoMode: boolean;
  setMessages: (v: any) => void;
  setIsJobActive: (v: boolean) => void;
  setShowStopButton: (v: boolean) => void;
  setIsHistoricalSession: (v: boolean) => void;
  setHasFirstPreview: (v: boolean) => void;
  setMirrorPreview: (v: any) => void;
  setMirrorPreviewBatch: (v: any[]) => void;
  setWorkerTabGroups: (v: any[]) => void;
  setShowCloseTabs: (v: boolean) => void;
  setIsFollowUpMode: (v: boolean) => void;
  setInputEnabled: (v: boolean) => void;
  setIsReplaying: (v: boolean) => void;
  setIsAgentModeActive: (v: boolean) => void;
  setActiveAggregateMessageId: (v: string | null) => void;
  setIsPaused: (v: boolean) => void;
  setAgentTraceRootId: (v: string | null) => void;
  setMessageMetadata: (v: any) => void;
  setRequestSummaries: (v: any) => void;
  setSessionStats: (v: any) => void;
  setPendingEstimation: (v: any) => void;
  setHistoryContextActive: (v: boolean) => void;
  setHistoryContextLoading: (v: boolean) => void;
  setHistoryJustCompleted: (v: boolean) => void;
  setShowInlineWorkflow: (v: boolean) => void;
  setTokenLog: (v: any[]) => void;
  setIsStopping: (v: boolean) => void;
  setCurrentSessionId: (v: string | null) => void;
  setShowDashboard: (v: boolean) => void;
  setShowHistory: (v: boolean) => void;
  setCurrentTaskAgentType: (v: string | null) => void;
  currentTaskAgentType: string | null;
  workerTabGroups: any[];
  messages: any[];
  mirrorPreviewBatch: any[];
  recalculatedEstimation: any;
  setContextTabIdsRef?: MutableRefObject<((tabIds: number[]) => void) | null>;
}) {
  const {
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
  } = params;

  // Tracks which message keys we've already scheduled for persistence (per session).
  // This prevents double-writes from React render replays / handler re-entrancy.
  const persistedMessageKeysBySessionRef = useRef<Map<string, Set<string>>>(new Map());

  const getPersistKeyForMessage = useCallback((m: any): string => {
    const eventId = m?.eventId ? String(m.eventId) : '';
    if (eventId) return `event:${eventId}`;
    const actor = String(m?.actor || '');
    const ts = Number(m?.timestamp || 0);
    const content = String(m?.content ?? '').trim();
    return `${actor}|${ts}|${content}`;
  }, []);

  const schedulePersistMessage = useCallback(
    (sessionId: string, m: Message) => {
      try {
        const sid = String(sessionId || '').trim();
        if (!sid) return;
        const key = getPersistKeyForMessage(m as any);
        if (!key) return;
        const map = persistedMessageKeysBySessionRef.current;
        const setForSession = map.get(sid) || new Set<string>();
        if (setForSession.has(key)) return;
        setForSession.add(key);
        // Basic pruning to avoid unbounded growth per session
        if (setForSession.size > 4000) {
          let removed = 0;
          for (const k of setForSession) {
            setForSession.delete(k);
            removed += 1;
            if (removed >= 1000) break;
          }
        }
        map.set(sid, setForSession);

        const persist = () => {
          // Strip transient UI fields (like statusHint) before persistence
          const { statusHint, ...messageToStore } = m as any;
          chatHistoryStore
            .addMessage(sid, messageToStore)
            .catch(err => params.logger?.error?.('Failed to save message:', err));
        };
        try {
          // Prefer microtask queue so we don't perform async work inside the state updater synchronously.
          queueMicrotask(persist);
        } catch {
          Promise.resolve().then(persist);
        }
      } catch {}
    },
    [getPersistKeyForMessage, params.logger],
  );

  const appendMessage = useCallback(
    (newMessage: Message, sessionId?: string | null) => {
      const isProgressMessage =
        newMessage.content === 'Showing progress...' || newMessage.content === 'Estimating workflow...';

      // Defense-in-depth: verify session matches before adding to UI
      // If sessionId is explicitly provided and doesn't match current session, skip UI update
      const currentSession = sessionIdRef.current;
      if (sessionId !== undefined && sessionId !== null && currentSession) {
        if (String(sessionId) !== String(currentSession)) {
          // Message is for a different session - only persist, don't add to UI
          if (!isProgressMessage && !incognitoMode) schedulePersistMessage(sessionId, newMessage);
          return;
        }
      }

      const incomingEventId = (newMessage as any)?.eventId ? String((newMessage as any).eventId) : '';
      const normalizedContent = String(newMessage.content ?? '').trim();
      const incomingActor = String((newMessage as any)?.actor || '');
      const isSystemActor = incomingActor === Actors.SYSTEM || incomingActor.toLowerCase() === 'system';
      const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;
      setMessages((prev: Message[]) => {
        const filtered = prev.filter((msg, idx) => !(msg.content === 'Showing progress...' && idx === prev.length - 1));
        const hasDuplicate = filtered.some(msg => {
          if (incomingEventId && String((msg as any)?.eventId || '') === incomingEventId) return true;
          return (
            msg.actor === newMessage.actor &&
            Number(msg.timestamp) === Number(newMessage.timestamp) &&
            String(msg.content ?? '').trim() === normalizedContent
          );
        });
        if (hasDuplicate) return filtered;
        if (isSystemActor) {
          const hasNonSystemDuplicate = filtered.some(msg => {
            const actor = String((msg as any)?.actor || '');
            if (actor === Actors.SYSTEM || actor.toLowerCase() === 'system') return false;
            const content = String((msg as any)?.content ?? '').trim();
            if (content !== normalizedContent) return false;
            const ts = Number((msg as any)?.timestamp || 0);
            return Math.abs(Number(newMessage.timestamp) - ts) <= 5000;
          });
          if (hasNonSystemDuplicate) return filtered;
        }
        // Persist immediately when we actually append to UI, using idempotency keys.
        if (effectiveSessionId && !isProgressMessage && !incognitoMode) {
          schedulePersistMessage(String(effectiveSessionId), newMessage);
        }
        return [...filtered, newMessage];
      });
    },
    [sessionIdRef, incognitoMode, setMessages, schedulePersistMessage],
  );

  const persistAgentMessage = useCallback(
    (actor: Actors, content: string, timestamp: number, eventId?: string) => {
      try {
        const actorText = String(actor || '').toLowerCase();
        if (actorText === String(Actors.CHAT).toLowerCase() || actorText === String(Actors.SEARCH).toLowerCase()) {
          return;
        }
        const effectiveSessionId = sessionIdRef.current;
        if (!effectiveSessionId || incognitoMode) return;
        const trimmed = String(content || '').trim();
        if (!trimmed) return;
        const msg: any = { actor, content: trimmed, timestamp };
        if (eventId) msg.eventId = String(eventId);
        chatHistoryStore
          .addMessage(effectiveSessionId, msg)
          .catch(err => logger.error('Failed to save agent message:', err));
      } catch (e) {
        logger.error('persistAgentMessage failed', e);
      }
    },
    [sessionIdRef, logger, incognitoMode],
  );

  const updateSessionStats = useCallback(
    (requestData: {
      totalInputTokens: number;
      totalOutputTokens: number;
      totalLatencyMs: number;
      totalCost: number;
    }) => {
      setSessionStats((prev: any) => {
        const newStats = {
          totalRequests: prev.totalRequests + 1,
          totalInputTokens: prev.totalInputTokens + requestData.totalInputTokens,
          totalOutputTokens: prev.totalOutputTokens + requestData.totalOutputTokens,
          totalLatency: prev.totalLatency + requestData.totalLatencyMs,
          totalCost: prev.totalCost + requestData.totalCost,
          avgLatencyPerRequest: 0,
        };
        newStats.avgLatencyPerRequest = newStats.totalRequests > 0 ? newStats.totalLatency / newStats.totalRequests : 0;
        if (sessionIdRef.current) {
          chatHistoryStore.storeSessionStats(sessionIdRef.current, newStats).catch(() => {});
        }
        return newStats;
      });
    },
    [setSessionStats, sessionIdRef],
  );

  const resetRunState = useCallback(() => {
    agentTraceActiveRef.current = false;
    setAgentTraceRootId(null);
    agentTraceRootIdRef.current = null;
    lastAgentMessageRef.current = null;
    workflowEndedRef.current = false;
    // Clear preview state for fresh task runs
    setHasFirstPreview(false);
    setMirrorPreview(null);
    setMirrorPreviewBatch([]);
    try {
      const sid = sessionIdRef.current;
      if (sid) cancelSummaryTargetsRef.current.delete(sid);
    } catch {}
  }, [
    agentTraceActiveRef,
    setAgentTraceRootId,
    agentTraceRootIdRef,
    lastAgentMessageRef,
    workflowEndedRef,
    sessionIdRef,
    cancelSummaryTargetsRef,
    setHasFirstPreview,
    setMirrorPreview,
    setMirrorPreviewBatch,
  ]);

  const taskEventHandler = useMemo(
    () =>
      createTaskEventHandler({
        logger,
        appendMessage,
        persistAgentMessage,
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
        agentTraceRootIdRef,
        setAgentTraceRootId,
        agentTraceActiveRef,
        lastAgentMessageRef,
        jobActiveRef,
        laneColorByLaneRef,
        processedJobSummariesRef,
        sessionIdRef,
        taskIdToRootIdRef,
        lastAgentMessageByTaskRef,
        closableTaskIdsRef,
        workflowEndedRef,
        setMessageMetadata,
        setRequestSummaries,
        updateSessionStats,
        getCurrentTaskAgentType: () => params.currentTaskAgentType,
        getWorkerTabGroups: () => params.workerTabGroups,
        getChatSessions: () => chatSessions,
        getMessages: () => params.messages,
        getMirrorPreviewBatch: () => params.mirrorPreviewBatch,
        lastUserPromptRef,
        ensureAgentOrdinal,
        portRef,
        cancelSummaryTargetsRef,
        runStartedAtRef,
        setPendingEstimation,
        getRecalculatedEstimation: () => params.recalculatedEstimation,
        setContextTabIdsRef: params.setContextTabIdsRef,
      }),
    [
      logger,
      appendMessage,
      persistAgentMessage,
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
      agentTraceRootIdRef,
      setAgentTraceRootId,
      agentTraceActiveRef,
      lastAgentMessageRef,
      jobActiveRef,
      laneColorByLaneRef,
      processedJobSummariesRef,
      sessionIdRef,
      taskIdToRootIdRef,
      lastAgentMessageByTaskRef,
      closableTaskIdsRef,
      workflowEndedRef,
      setMessageMetadata,
      setRequestSummaries,
      updateSessionStats,
      lastUserPromptRef,
      ensureAgentOrdinal,
      portRef,
      cancelSummaryTargetsRef,
      runStartedAtRef,
      setPendingEstimation,
      chatSessions,
      params.currentTaskAgentType,
      params.workerTabGroups,
      params.messages,
      params.mirrorPreviewBatch,
      params.recalculatedEstimation,
    ],
  );

  const panelHandlers = useMemo(
    () =>
      createPanelHandlers({
        logger,
        taskEventHandler,
        setMessageMetadata,
        agentTraceRootIdRef,
        setHistoryContextActive,
        setHistoryContextLoading,
        setHistoryJustCompleted,
        historyCompletedTimerRef,
        showToast,
        getCurrentTaskAgentType: () => params.currentTaskAgentType,
        setShowCloseTabs,
        setMessages,
        appendMessage,
        setShowStopButton,
        setInputEnabled,
        setIsFollowUpMode,
        setShowInlineWorkflow,
        lastAgentMessageRef,
        setAgentTraceRootId,
        agentTraceActiveRef,
        sessionIdRef,
        ensureAgentOrdinal,
        setMirrorPreview,
        setMirrorPreviewBatch,
        setHasFirstPreview,
        setIsAgentModeActive,
        portRef,
        closableTaskIdsRef,
        jobActiveRef,
        setWorkerTabGroups,
        getWorkerTabGroups: () => params.workerTabGroups,
        getChatSessions: () => chatSessions,
        getMessages: () => params.messages,
        getMirrorPreviewBatch: () => params.mirrorPreviewBatch,
        processedJobSummariesRef,
        setRequestSummaries,
        updateSessionStats,
        setTokenLog,
        cancelSummaryTargetsRef,
        runStartedAtRef,
        setInputTextRef,
        // Killswitch dependencies
        setIsJobActive,
        setIsPaused,
        // Cancellation state refs for confirmation-based stop
        isCancellingRef,
        cancelTimeoutRef,
        setIsStopping,
        // Session restoration deps
        setCurrentSessionId,
        setShowDashboard,
        setShowHistory,
        setCurrentTaskAgentType,
      }),
    [
      logger,
      taskEventHandler,
      setMessageMetadata,
      agentTraceRootIdRef,
      setHistoryContextActive,
      setHistoryContextLoading,
      setHistoryJustCompleted,
      historyCompletedTimerRef,
      showToast,
      setShowCloseTabs,
      setMessages,
      appendMessage,
      setShowStopButton,
      setInputEnabled,
      setIsFollowUpMode,
      setShowInlineWorkflow,
      lastAgentMessageRef,
      setAgentTraceRootId,
      agentTraceActiveRef,
      sessionIdRef,
      ensureAgentOrdinal,
      setMirrorPreview,
      setMirrorPreviewBatch,
      setHasFirstPreview,
      setIsAgentModeActive,
      portRef,
      closableTaskIdsRef,
      jobActiveRef,
      setWorkerTabGroups,
      processedJobSummariesRef,
      setRequestSummaries,
      updateSessionStats,
      setTokenLog,
      cancelSummaryTargetsRef,
      runStartedAtRef,
      setInputTextRef,
      setIsJobActive,
      setIsPaused,
      isCancellingRef,
      cancelTimeoutRef,
      setIsStopping,
      setCurrentSessionId,
      setShowDashboard,
      setShowHistory,
      setCurrentTaskAgentType,
      chatSessions,
      params.currentTaskAgentType,
      params.workerTabGroups,
      params.messages,
      params.mirrorPreviewBatch,
    ],
  );

  return {
    appendMessage,
    persistAgentMessage,
    updateSessionStats,
    resetRunState,
    taskEventHandler,
    panelHandlers,
  };
}
