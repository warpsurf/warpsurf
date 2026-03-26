import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Actors, warningsSettingsStore, chatHistoryStore } from '@extension/storage';
import type { Message, RequestSummary, MessageMetadataValue } from '@extension/storage';
import { useEventSetup } from '@panel/hooks/use-event-setup';
import { dedupeMessages, reorderLiveInjected } from '@panel/utils';
import type { AgentData, PreviewData } from '@src/types';

interface ChatSessionState {
  sessionId: string | null;
  messages: Message[];
  isRunning: boolean;
  sessionTitle: string;
  jobSummaries: Record<string, RequestSummary>;
  metadataByMessageId: Record<string, MessageMetadataValue>;
}

interface MirrorPreview {
  url?: string;
  title?: string;
  screenshot?: string;
  tabId?: number;
  color?: string;
}

interface UseAgentManagerConnectionResult {
  agents: AgentData[];
  isConnected: boolean;
  portRef: React.MutableRefObject<chrome.runtime.Port | null>;
  sendNewTask: (task: string, agentType?: string, contextTabIds?: number[], attachments?: any[]) => Promise<void>;
  openSidepanelToSession: (sessionId: string) => void;
  addPortListener: (listener: (message: any) => void) => void;
  removePortListener: (listener: (message: any) => void) => void;
  chatSession: ChatSessionState;
  subscribeToSession: (sessionId: string) => void;
  unsubscribeFromSession: () => void;
  startTaskInline: (task: string, agentType?: string, contextTabIds?: number[], attachments?: any[]) => void;
  sendFollowUpInline: (text: string, agentType?: string, contextTabIds?: number[], attachments?: any[]) => void;
  needsPerChatDisclaimer: () => Promise<boolean>;
  mirrorPreview: MirrorPreview | null;
  mirrorPreviewBatch: MirrorPreview[];
  activeAggregateMessageId: string | null;
  setPendingContextTabs: (tabs: any[] | null) => void;
  // Task control
  handleStopTask: () => Promise<void>;
  handlePauseTask: () => Promise<void>;
  handleResumeTask: () => Promise<void>;
  handleKillSwitch: () => void;
  handleInjectLiveMessage: (text: string) => void;
  handleHandBackControl: (instructions?: string) => void;
  isStopping: boolean;
  isPaused: boolean;
  showStopButton: boolean;
  showCloseTabs: boolean;
  setShowCloseTabs: (show: boolean) => void;
  showEmergencyStop: boolean;
  workerTabGroups: any[];
  setWorkerTabGroups: (groups: any[]) => void;
  sessionStats: any;
  currentTaskAgentType: string | null;
  messageMetadata: Record<string, any>;
  agentTraceRootIdRef: React.MutableRefObject<string | null>;
  sessionIdRef: React.MutableRefObject<string | null>;
  currentPlan: Array<{ text: string; status: string }> | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NOOP: any = () => {};

export function useAgentManagerConnection(): UseAgentManagerConnectionResult {
  // ─── Connection & Gallery ───────────────────────────────────────────
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const customListenersRef = useRef<Set<(message: any) => void>>(new Set());

  // ─── Chat Session Identity ──────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // ─── Chat Session State (consumed by useEventSetup) ─────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageMetadata, setMessageMetadata] = useState<Record<string, any>>({});
  const [requestSummaries, setRequestSummaries] = useState<Record<string, any>>({});
  const [mirrorPreview, setMirrorPreview] = useState<any>(null);
  const [mirrorPreviewBatch, setMirrorPreviewBatch] = useState<any[]>([]);
  const [isJobActive, setIsJobActive] = useState(false);
  const [workerTabGroups, setWorkerTabGroups] = useState<any[]>([]);
  const [currentTaskAgentType, setCurrentTaskAgentType] = useState<string | null>(null);
  const [activeAggregateMessageId, setActiveAggregateMessageId] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showStopButton, setShowStopButton] = useState(false);
  const [showCloseTabs, setShowCloseTabs] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<Array<{ text: string; status: string }> | null>(null);
  const [showEmergencyStop, setShowEmergencyStop] = useState(true);
  const [sessionStats, setSessionStats] = useState<any>({
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalLatency: 0,
    totalCost: 0,
    avgLatencyPerRequest: 0,
  });

  // ─── Refs for Event Processing ──────────────────────────────────────
  const agentTraceRootIdRef = useRef<string | null>(null);
  const agentTraceActiveRef = useRef(false);
  const lastAgentMessageRef = useRef<any>(null);
  const jobActiveRef = useRef(false);
  const laneColorByLaneRef = useRef(new Map<number, string>());
  const processedJobSummariesRef = useRef(new Set<string>());
  const taskIdToRootIdRef = useRef(new Map<string, string>());
  const lastAgentMessageByTaskRef = useRef(new Map<string, any>());
  const closableTaskIdsRef = useRef(new Set<string>());
  const workflowEndedRef = useRef(false);
  const cancelSummaryTargetsRef = useRef(new Map<string, string>());
  const runStartedAtRef = useRef<number | null>(null);
  const lastUserPromptRef = useRef<string | null>(null);
  const historyCompletedTimerRef = useRef<number | null>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const isCancellingRef = useRef(false);
  const cancelTimeoutRef = useRef<number | null>(null);
  const agentOrdinalMapRef = useRef(new Map<string, number>());
  const pendingContextTabsRef = useRef<any[] | null>(null);

  useEffect(() => {
    jobActiveRef.current = isJobActive;
  }, [isJobActive]);

  const setAgentTraceRootId = useCallback((v: string | null) => {
    agentTraceRootIdRef.current = v;
    setActiveAggregateMessageId(v);
  }, []);

  const logger = useMemo(
    () => ({
      log: (...args: any[]) => {
        if (import.meta.env.DEV) console.debug('[AgentManager]', ...args);
      },
      error: (...args: any[]) => console.error('[AgentManager]', ...args),
    }),
    [],
  );

  const ensureAgentOrdinal = useCallback((taskId: string, hint?: number) => {
    const map = agentOrdinalMapRef.current;
    if (map.has(taskId)) return map.get(taskId)!;
    const ordinal = hint ?? map.size + 1;
    map.set(taskId, ordinal);
    return ordinal;
  }, []);

  // ─── Event Processing (reuses the side panel's full pipeline) ───────
  // useEventSetup creates appendMessage, taskEventHandler, panelHandlers
  // using the exact same code path as the side panel. No-ops are used for
  // side-panel-specific UI state (stop button, history, dashboard, etc).
  const { panelHandlers, resetRunState } = useEventSetup({
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
    showToast: NOOP,
    ensureAgentOrdinal,
    chatSessions: [],
    incognitoMode: false,
    // Real state setters
    setMessages,
    setIsJobActive,
    setMirrorPreview,
    setMirrorPreviewBatch,
    setWorkerTabGroups,
    setActiveAggregateMessageId,
    setAgentTraceRootId,
    setMessageMetadata,
    setRequestSummaries,
    setCurrentTaskAgentType,
    // Real setters for task control UI
    setShowStopButton,
    setShowCloseTabs,
    setIsPaused,
    setSessionStats,
    setIsStopping,
    // No-ops for panel-specific UI not used in agent manager
    setIsHistoricalSession: NOOP,
    setHasFirstPreview: NOOP,
    setIsFollowUpMode: NOOP,
    setInputEnabled: NOOP,
    setIsReplaying: NOOP,
    setIsAgentModeActive: NOOP,
    setPendingEstimation: NOOP,
    setHistoryContextActive: NOOP,
    setHistoryContextLoading: NOOP,
    setHistoryJustCompleted: NOOP,
    setShowInlineWorkflow: NOOP,
    setTokenLog: NOOP,
    setCurrentSessionId: NOOP,
    setShowDashboard: NOOP,
    setShowHistory: NOOP,
    setCurrentPlan,
    // Value params
    currentTaskAgentType,
    workerTabGroups,
    messages,
    mirrorPreviewBatch,
    recalculatedEstimation: null,
  });

  const handlersRef = useRef(panelHandlers);
  useEffect(() => {
    handlersRef.current = panelHandlers;
  }, [panelHandlers]);

  // ─── Message Router ─────────────────────────────────────────────────
  // Routes port messages through the same handlers as the side panel,
  // replicating the normalization and session filtering from
  // useBackgroundConnection.
  const routeMessage = useCallback(
    (message: any) => {
      const type = message?.type;
      const h = handlersRef.current;

      if (type === 'execution') {
        const data = message?.data || {};
        // Session gate (mirrors useBackgroundConnection)
        const possibleIds = [data?.taskId, data?.parentSessionId, data?.sessionId].filter(Boolean);
        const sid = sessionIdRef.current;
        if (sid && possibleIds.length > 0 && !possibleIds.some((id: any) => String(id) === String(sid))) return;
        // Normalize event shape
        const normalized = {
          type: 'execution',
          actor: message.actor || data?.actor || Actors.SYSTEM,
          state: message.state || data?.state,
          data,
          timestamp: message.timestamp || Date.now(),
          eventId: message?.eventId || data?.eventId,
        };
        h.onExecution?.(normalized as any);
        try {
          h.onExecutionMeta?.(message);
        } catch {}
        return;
      }

      if (type === 'tab-mirror-update') {
        h.onTabMirrorUpdate?.(message);
        return;
      }
      if (type === 'tab-mirror-batch') {
        h.onTabMirrorBatch?.(message);
        return;
      }

      if (type === 'buffered_session_events') {
        for (const event of message.events || []) {
          const et = event?.type;
          if (et === 'execution') {
            const d = event.data || {};
            h.onExecution?.({
              type: 'execution',
              actor: event.actor || d?.actor || Actors.SYSTEM,
              state: event.state || d?.state,
              data: d,
              timestamp: event.timestamp || Date.now(),
              eventId: event?.eventId || d?.eventId,
            } as any);
          } else if (et && et !== 'buffered_session_events') {
            // Route non-execution buffered events (workflow_progress, final_answer, etc.)
            // Guard: skip nested buffered_session_events to prevent recursion.
            routeMessage(event);
          }
        }
        return;
      }

      if (type === 'trajectory_state') {
        const { sessionId: sid, data } = message;
        if (String(sid) === String(sessionIdRef.current) && data?.rootId) {
          setMessageMetadata((prev: any) => {
            const { rootId } = data;
            const effectiveId =
              prev?.__sessionRootId && prev.__sessionRootId !== rootId ? prev.__sessionRootId : rootId;
            const existing = prev?.[rootId] || {};
            const existingItems: any[] = existing?.traceItems || [];
            const existingIds = new Set(existingItems.map((t: any) => String(t?.eventId || '')).filter(Boolean));
            const existingTs = new Set(existingItems.map((t: any) => t.timestamp));
            const newItems = (data.traceItems || []).filter((t: any) => {
              const id = String(t?.eventId || '');
              return !(id && existingIds.has(id)) && !(!id && existingTs.has(t.timestamp));
            });
            const merged = [...existingItems, ...newItems].sort((a: any, b: any) => a.timestamp - b.timestamp);
            const bgEntry = {
              ...existing,
              traceItems: merged,
              ...(data.workerItems?.length ? { workerItems: data.workerItems } : {}),
              isCompleted: existing.isCompleted || data.isCompleted || false,
              ...(data.finalPreview && !existing.finalPreview ? { finalPreview: data.finalPreview } : {}),
              ...(data.finalPreviewBatch?.length && !existing.finalPreviewBatch?.length
                ? { finalPreviewBatch: data.finalPreviewBatch }
                : {}),
            };
            const result: any = { ...prev, __sessionRootId: effectiveId, [rootId]: bgEntry };
            if (effectiveId !== rootId) result[effectiveId] = { ...(prev?.[effectiveId] || {}), ...bgEntry };
            return result;
          });
        }
        return;
      }

      if (type === 'session_subscribed') {
        h.onSessionSubscribed?.(message);
        return;
      }
      if (type === 'workflow_progress') {
        h.onWorkflowProgress?.(message);
        return;
      }
      if (type === 'workflow_graph_update') {
        h.onWorkflowGraphUpdate?.(message);
        return;
      }
      if (type === 'workflow_plan_dataset') {
        h.onWorkflowPlanDataset?.(message);
        return;
      }
      if (type === 'workflow_quartermaster_log') {
        h.onWorkflowQuartermasterLog?.(message);
        return;
      }
      if (type === 'final_answer') {
        h.onFinalAnswer?.(message);
        return;
      }
      if (type === 'workflow_ended') {
        h.onWorkflowEnded?.(message);
        return;
      }
      if (type === 'workflow_started') {
        (h as any).onWorkflowStarted?.(message);
        return;
      }
      if (type === 'workflow_paused') {
        (h as any).onWorkflowPaused?.(message);
        return;
      }
      if (type === 'error') {
        h.onError?.(message);
        return;
      }
      if (type === 'session_logs') {
        h.onSessionLogs?.(message);
        return;
      }

      if (type === 'title-update') {
        if (message.sessionId === sessionIdRef.current) setSessionTitle(message.title || '');
        (h as any).onTitleUpdate?.(message);
        return;
      }

      if (type === 'task-started-inline') {
        if (message.sessionId) {
          setSessionId(message.sessionId);
          sessionIdRef.current = message.sessionId;
        }
        setIsJobActive(true);
        jobActiveRef.current = true;
        return;
      }

      if (type === 'task_complete' || type === 'task_completed' || type === 'task_error') {
        setIsJobActive(false);
        jobActiveRef.current = false;
        return;
      }
    },
    [setMessageMetadata],
  );

  // ─── Load Initial Session Data ──────────────────────────────────────
  // Mirrors the side panel's handleSessionSelect: loads stored messages,
  // metadata, summaries and stats, reconciles rootId, reconstructs stale
  // aggregate content, deduplicates, and sets agentTraceRootId.
  const loadInitialData = useCallback(async (sid: string) => {
    try {
      const [session, loadedSummaries, loadedMetadata, loadedStats] = await Promise.all([
        chatHistoryStore.getSession(sid),
        chatHistoryStore.loadRequestSummaries(sid).catch(() => ({})),
        chatHistoryStore.loadMessageMetadata(sid).catch(() => ({})),
        chatHistoryStore.loadSessionStats(sid).catch(() => null),
      ]);
      if (sessionIdRef.current !== sid) return;

      const savedMetadata: any = loadedMetadata && typeof loadedMetadata === 'object' ? loadedMetadata : {};
      const savedSummaries: any = loadedSummaries && typeof loadedSummaries === 'object' ? loadedSummaries : {};
      const hasMessages = session && session.messages.length > 0;

      // Restore rootId and metadata
      let effectiveRootId: string | null = (savedMetadata as any)?.__sessionRootId || null;

      setRequestSummaries(savedSummaries);
      setMessageMetadata(savedMetadata);
      if (loadedStats) setSessionStats(loadedStats);

      // Reconcile rootId: if stored rootId doesn't match any loaded message,
      // fall back to the last agent message's messageId
      const loadedMessages: any[] = hasMessages ? (session.messages as any[]) : [];
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
            if (savedMetadata) {
              const bgMeta = savedMetadata[effectiveRootId];
              const panelMeta = savedMetadata[corrected];
              if (bgMeta && typeof bgMeta === 'object') {
                const merged = { ...(panelMeta || {}), ...bgMeta };
                savedMetadata[corrected] = merged;
                savedMetadata.__sessionRootId = corrected;
                setMessageMetadata({ ...savedMetadata });
              }
            }
            if (savedSummaries[effectiveRootId] && !savedSummaries[corrected]) {
              savedSummaries[corrected] = savedSummaries[effectiveRootId];
              setRequestSummaries({ ...savedSummaries });
            }
            effectiveRootId = corrected;
          }
        }
      }

      // Set trajectory refs
      agentTraceRootIdRef.current = effectiveRootId;
      setActiveAggregateMessageId(effectiveRootId);

      // Reconstruct stale aggregate root content from metadata trace items
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
      const isStaleContent = (c: string) => !c.trim() || STALE_CONTENT_RE.some(re => re.test(c.trim()));

      let rawMessages = hasMessages ? [...loadedMessages] : [];
      let reconstructedContent: string | undefined;
      if (effectiveRootId && savedMetadata) {
        const rootMeta = savedMetadata[effectiveRootId];
        if (rootMeta?.isCompleted && Array.isArray(rootMeta.traceItems) && rootMeta.traceItems.length > 0) {
          const rootMsg = rawMessages.find((m: any) => `${m.timestamp}-${m.actor}` === effectiveRootId);
          const storedContent = String(rootMsg?.content ?? '').trim();
          if (isStaleContent(storedContent)) {
            const storedFinal = rootMeta.finalAnswerContent;
            if (storedFinal && typeof storedFinal === 'string' && storedFinal.trim()) {
              reconstructedContent = storedFinal.trim();
            } else {
              const traceItems = rootMeta.traceItems as Array<{ actor: string; content: string; timestamp: number }>;
              const STATUS_ONLY_RE = /^(Workflow completed|Task cancelled)$/i;
              const FINAL_ANSWER_PREFIX_RE = /^Final answer:\s*/i;
              const lastSubstantial = [...traceItems].reverse().find(t => {
                const c = t.content?.trim();
                return c && !isStaleContent(c) && !STATUS_ONLY_RE.test(c);
              });
              const lastSystem = [...traceItems]
                .reverse()
                .find(t => t.actor === Actors.SYSTEM || t.actor?.toLowerCase?.() === 'system');
              const raw = lastSubstantial?.content || lastSystem?.content || traceItems[traceItems.length - 1]?.content;
              reconstructedContent = raw ? raw.replace(FINAL_ANSWER_PREFIX_RE, '') : undefined;
            }
            if (reconstructedContent) {
              rawMessages = rawMessages.map((m: any) => {
                if (`${m.timestamp}-${m.actor}` === effectiveRootId) return { ...m, content: reconstructedContent };
                return m;
              });
            }
          }
        }
      }
      // Reconstruct stale content for ALL completed aggregate roots (not just the current one).
      // Earlier runs in the same session may have placeholder content like "Initializing browser agent...".
      if (savedMetadata) {
        rawMessages = rawMessages.map((m: any) => {
          const mid = `${m.timestamp}-${m.actor}`;
          if (mid === effectiveRootId) return m; // already handled above
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

      // Remove standalone SYSTEM messages that duplicate aggregate root content
      if (effectiveRootId) {
        const rootMsg = finalMessages.find((m: any) => `${m.timestamp}-${m.actor}` === effectiveRootId);
        const rootContent = reconstructedContent || String(rootMsg?.content ?? '').trim();
        if (rootContent) {
          const rootTs = Number(rootMsg?.timestamp || 0);
          finalMessages = finalMessages.filter((m: any) => {
            // Never filter out the root message itself
            if (`${m.timestamp}-${m.actor}` === effectiveRootId) return true;
            const actor = String(m?.actor || '');
            const isSystem = actor === Actors.SYSTEM || actor.toLowerCase() === 'system';
            if (!isSystem) return true;
            const content = String(m?.content ?? '').trim();
            if (content !== rootContent) return true;
            if (!rootTs) return true;
            const ts = Number(m?.timestamp || 0);
            return Math.abs(ts - rootTs) > 10000;
          });
        }
      }

      if (finalMessages.length > 0) {
        setMessages(prev => (prev.length >= finalMessages.length ? prev : finalMessages));
      }

      // Restore plan from persisted metadata
      const storedPlan = (savedMetadata as any)?.__workflowPlanItems;
      if (Array.isArray(storedPlan) && storedPlan.length > 0) {
        setCurrentPlan(storedPlan);
      } else {
        setCurrentPlan(null);
      }
    } catch {}
  }, []);

  // ─── Connection ─────────────────────────────────────────────────────
  const connect = useCallback(() => {
    try {
      const port = chrome.runtime.connect({ name: 'agent-manager' });
      portRef.current = port;
      setIsConnected(true);

      port.onMessage.addListener((message: any) => {
        const type = message?.type;

        for (const listener of customListenersRef.current) {
          try {
            listener(message);
          } catch {}
        }

        // Route chat-related messages through panel event handlers
        routeMessage(message);

        // Gallery handlers
        if (type === 'agents-data') {
          const data = message.data?.agents || [];
          setAgents(prev => {
            const animatingTitles = new Map(prev.filter(a => a.titleAnimating).map(a => [a.sessionId, a.sessionTitle]));
            return data.map((agent: any) => {
              const wasAnimating = animatingTitles.get(agent.sessionId);
              return { ...agent, titleAnimating: (wasAnimating && wasAnimating === agent.sessionTitle) || false };
            });
          });
        }

        if (type === 'agent-title-update') {
          const agentSessionId = message.data?.sessionId || message.sessionId;
          const title = message.data?.title || message.title;
          if (agentSessionId && title) {
            setAgents(prev =>
              prev.map(agent =>
                agent.sessionId !== agentSessionId
                  ? agent
                  : { ...agent, sessionTitle: title, titleAnimating: agent.sessionTitle !== title },
              ),
            );
          }
        }

        if (type === 'refresh-required') port.postMessage({ type: 'get-agents' });

        if (type === 'previews-update') {
          const previews = message.data || [];
          setAgents(prev =>
            prev.map(agent => {
              const isRunning = ['running', 'paused', 'needs_input'].includes(agent.status);
              if (!isRunning) return agent;
              const preview = previews.find(
                (p: any) => p.sessionId && agent.sessionId && p.sessionId === agent.sessionId,
              );
              if (!preview) return agent;
              if (agent.agentType === 'multiagent' && agent.workers) {
                const updatedWorkers = agent.workers.map(worker => {
                  const wp = previews.find((p: any) => p.agentId === worker.workerId || p.tabId === worker.tabId);
                  return wp ? { ...worker, screenshot: wp.screenshot, url: wp.url, title: wp.title } : worker;
                });
                return { ...agent, workers: updatedWorkers };
              }
              return {
                ...agent,
                preview: {
                  tabId: preview.tabId,
                  url: preview.url,
                  title: preview.title,
                  screenshot: preview.screenshot,
                  lastUpdated: preview.lastUpdated,
                } as PreviewData,
              };
            }),
          );
        }
      });

      port.onDisconnect.addListener(() => {
        setIsConnected(false);
        portRef.current = null;
        reconnectTimeoutRef.current = window.setTimeout(() => connect(), 2000);
      });

      port.postMessage({ type: 'get-agents' });
    } catch (e) {
      setIsConnected(false);
      reconnectTimeoutRef.current = window.setTimeout(() => connect(), 2000);
    }
  }, [routeMessage]);

  useEffect(() => {
    connect();
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.agent_dashboard_running || changes.agent_dashboard_completed) {
        portRef.current?.postMessage({ type: 'get-agents' });
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      portRef.current?.disconnect();
    };
  }, [connect]);

  // ─── Session Management ─────────────────────────────────────────────

  const subscribeToSession = useCallback(
    (sid: string) => {
      if (!portRef.current) return;
      const agent = agents.find(a => a.sessionId === sid);

      resetRunState();
      processedJobSummariesRef.current.clear();
      agentOrdinalMapRef.current.clear();

      setSessionId(sid);
      sessionIdRef.current = sid;
      setSessionTitle(agent?.sessionTitle || agent?.taskDescription?.substring(0, 60) || '');
      setMessages([]);
      setMessageMetadata({});
      setRequestSummaries({});
      setMirrorPreview(null);
      setMirrorPreviewBatch([]);
      setIsJobActive(false);
      jobActiveRef.current = false;
      setCurrentTaskAgentType(null);

      loadInitialData(sid);
      portRef.current.postMessage({ type: 'subscribe-to-session', sessionId: sid });
    },
    [agents, resetRunState, loadInitialData],
  );

  const unsubscribeFromSession = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid && portRef.current) {
      portRef.current.postMessage({ type: 'unsubscribe-from-session', sessionId: sid });
    }
    resetRunState();
    processedJobSummariesRef.current.clear();
    agentOrdinalMapRef.current.clear();
    setSessionId(null);
    sessionIdRef.current = null;
    setSessionTitle('');
    setMessages([]);
    setMessageMetadata({});
    setRequestSummaries({});
    setMirrorPreview(null);
    setMirrorPreviewBatch([]);
    setIsJobActive(false);
    jobActiveRef.current = false;
    setCurrentTaskAgentType(null);
  }, [resetRunState]);

  const startTaskInline = useCallback(
    (task: string, agentType?: string, contextTabIds?: number[], attachments?: any[]) => {
      if (!portRef.current) return;
      // Generate sessionId client-side (mirrors side panel's createMessageSender)
      // so sessionIdRef is set before any events arrive.
      const sid = `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      resetRunState();
      processedJobSummariesRef.current.clear();
      agentOrdinalMapRef.current.clear();
      setSessionId(sid);
      sessionIdRef.current = sid;
      const ts = Date.now();
      setMessages([{ actor: Actors.USER, content: task, timestamp: ts } as Message]);
      // Store pending context tabs metadata (captured by AgentInputBar)
      const contextTabs = pendingContextTabsRef.current;
      pendingContextTabsRef.current = null;
      const initialMeta: Record<string, any> = {};
      if (contextTabs?.length) {
        initialMeta[`${ts}-user`] = { contextTabs };
        chatHistoryStore.storeMessageMetadata(sid, initialMeta).catch(() => {});
      }
      setMessageMetadata(initialMeta);
      setRequestSummaries({});
      setSessionStats({
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalLatency: 0,
        totalCost: 0,
        avgLatencyPerRequest: 0,
      });
      setIsJobActive(true);
      jobActiveRef.current = true;
      portRef.current.postMessage({
        type: 'start-task-inline',
        task,
        sessionId: sid,
        agentType: agentType || 'auto',
        contextTabIds,
        attachments,
      });
    },
    [resetRunState],
  );

  const sendFollowUpInline = useCallback(
    (text: string, agentType?: string, contextTabIds?: number[], attachments?: any[]) => {
      const sid = sessionIdRef.current;
      if (!portRef.current || !sid) return;
      const ts = Date.now();
      setMessages(prev => [...prev, { actor: Actors.USER, content: text, timestamp: ts } as Message]);
      // Store pending context tabs metadata
      const contextTabs = pendingContextTabsRef.current;
      pendingContextTabsRef.current = null;
      if (contextTabs?.length) {
        setMessageMetadata(prev => {
          const next = { ...prev, [`${ts}-user`]: { ...prev[`${ts}-user`], contextTabs } };
          chatHistoryStore.storeMessageMetadata(sid, next).catch(() => {});
          return next;
        });
      }
      setIsJobActive(true);
      jobActiveRef.current = true;
      portRef.current.postMessage({
        type: 'follow-up-inline',
        sessionId: sid,
        task: text,
        agentType,
        contextTabIds,
        attachments,
      });
    },
    [],
  );

  const sendNewTask = useCallback(
    async (task: string, agentType?: string, contextTabIds?: number[], attachments?: any[]) => {
      startTaskInline(task, agentType, contextTabIds, attachments);
    },
    [startTaskInline],
  );

  const needsPerChatDisclaimer = useCallback(async (): Promise<boolean> => {
    try {
      const settings = await warningsSettingsStore.getWarnings();
      return !settings.disablePerChatWarnings;
    } catch {
      return true;
    }
  }, []);

  const openSidepanelToSession = useCallback(async (sid: string) => {
    if (portRef.current) portRef.current.postMessage({ type: 'prewarm-session', sessionId: sid });
    await chrome.storage.local.set({
      pending_sidepanel_session: sid,
      pending_sidepanel_timestamp: Date.now(),
    });
    try {
      const currentWindow = await chrome.windows.getCurrent();
      if (currentWindow?.id) await chrome.sidePanel.open({ windowId: currentWindow.id });
    } catch {
      if (portRef.current) portRef.current.postMessage({ type: 'open-sidepanel-to-session', sessionId: sid });
    }
  }, []);

  const addPortListener = useCallback((listener: (message: any) => void) => {
    customListenersRef.current.add(listener);
  }, []);

  const removePortListener = useCallback((listener: (message: any) => void) => {
    customListenersRef.current.delete(listener);
  }, []);

  // ─── Task Control Handlers (mirrors usePanelHandlers) ───────────────

  // Keep showStopButton in sync with isJobActive
  useEffect(() => {
    setShowStopButton(isJobActive);
  }, [isJobActive]);

  const handleStopTask = useCallback(async () => {
    if (isCancellingRef.current) return;
    isCancellingRef.current = true;
    setIsStopping(true);
    try {
      const sid = sessionIdRef.current;
      portRef.current?.postMessage({ type: 'cancel_task', sessionId: sid, requestId: String(Date.now()) });
      // Timeout: escalate to kill after 15s
      const t = window.setTimeout(() => {
        if (isCancellingRef.current) {
          isCancellingRef.current = false;
          setIsStopping(false);
          handleKillSwitch();
        }
      }, 15000);
      cancelTimeoutRef.current = t;
    } catch {
      isCancellingRef.current = false;
      setIsStopping(false);
    }
  }, []);

  const handlePauseTask = useCallback(async () => {
    portRef.current?.postMessage({ type: 'pause_task', sessionId: sessionIdRef.current });
    setIsPaused(true);
  }, []);

  const handleResumeTask = useCallback(async () => {
    portRef.current?.postMessage({ type: 'resume_task', sessionId: sessionIdRef.current });
    setIsPaused(false);
  }, []);

  const handleKillSwitch = useCallback(() => {
    if (cancelTimeoutRef.current) {
      clearTimeout(cancelTimeoutRef.current);
      cancelTimeoutRef.current = null;
    }
    isCancellingRef.current = false;
    setIsStopping(false);
    portRef.current?.postMessage({ type: 'kill_all', sessionId: sessionIdRef.current });
    setMessages(prev => [
      ...prev,
      { actor: Actors.SYSTEM, content: 'Emergency stop executed', timestamp: Date.now() } as Message,
    ]);
    setIsJobActive(false);
    jobActiveRef.current = false;
    setShowStopButton(false);
    setIsPaused(false);
    setShowEmergencyStop(false);
  }, []);

  const handleInjectLiveMessage = useCallback((text: string) => {
    portRef.current?.postMessage({
      type: 'inject_live_message',
      sessionId: sessionIdRef.current,
      message: text,
    });
  }, []);

  const handleHandBackControl = useCallback(
    (instructions?: string) => {
      const tabId = mirrorPreview?.tabId;
      portRef.current?.postMessage({ type: 'hand_back_control', tabId, instructions });
    },
    [mirrorPreview],
  );

  // ─── Compose chatSession for backward compatibility ─────────────────
  const chatSession = useMemo<ChatSessionState>(
    () => ({
      sessionId,
      messages,
      isRunning: isJobActive,
      sessionTitle,
      jobSummaries: requestSummaries as Record<string, RequestSummary>,
      metadataByMessageId: messageMetadata as Record<string, MessageMetadataValue>,
    }),
    [sessionId, messages, isJobActive, sessionTitle, requestSummaries, messageMetadata],
  );

  return {
    agents,
    isConnected,
    portRef,
    sendNewTask,
    openSidepanelToSession,
    addPortListener,
    removePortListener,
    chatSession,
    subscribeToSession,
    unsubscribeFromSession,
    startTaskInline,
    sendFollowUpInline,
    needsPerChatDisclaimer,
    mirrorPreview,
    mirrorPreviewBatch,
    activeAggregateMessageId,
    // Task control
    handleStopTask,
    handlePauseTask,
    handleResumeTask,
    handleKillSwitch,
    handleInjectLiveMessage,
    handleHandBackControl,
    isStopping,
    isPaused,
    showStopButton,
    showCloseTabs,
    setShowCloseTabs,
    showEmergencyStop,
    workerTabGroups,
    setWorkerTabGroups,
    sessionStats,
    currentTaskAgentType,
    messageMetadata,
    agentTraceRootIdRef,
    sessionIdRef,
    currentPlan,
    setPendingContextTabs: useCallback((tabs: any[] | null) => {
      pendingContextTabsRef.current = tabs;
    }, []),
  };
}
