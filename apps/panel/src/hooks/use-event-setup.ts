import { useMemo, useCallback, type MutableRefObject } from 'react';
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

  const appendMessage = useCallback(
    (newMessage: Message, sessionId?: string | null) => {
      const isProgressMessage =
        newMessage.content === 'Showing progress...' || newMessage.content === 'Estimating workflow...';
      setMessages((prev: Message[]) => {
        const filtered = prev.filter((msg, idx) => !(msg.content === 'Showing progress...' && idx === prev.length - 1));
        const last = filtered[filtered.length - 1];
        if (
          last &&
          last.actor === newMessage.actor &&
          last.timestamp === newMessage.timestamp &&
          String(last.content) === String(newMessage.content)
        ) {
          return filtered;
        }
        return [...filtered, newMessage];
      });
      const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;
      if (effectiveSessionId && !isProgressMessage && !incognitoMode) {
        chatHistoryStore
          .addMessage(effectiveSessionId, newMessage)
          .catch(err => logger.error('Failed to save message:', err));
      }
    },
    [sessionIdRef, logger, incognitoMode, setMessages],
  );

  const persistAgentMessage = useCallback(
    (actor: Actors, content: string, timestamp: number) => {
      try {
        const effectiveSessionId = sessionIdRef.current;
        if (!effectiveSessionId || incognitoMode) return;
        chatHistoryStore
          .addMessage(effectiveSessionId, { actor, content, timestamp })
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
