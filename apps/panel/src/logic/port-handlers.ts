/* eslint-disable @typescript-eslint/no-explicit-any */
import { Actors, chatHistoryStore } from '@extension/storage';
import { computeRequestSummaryFromSessionLogs } from '../utils/index';
import { handleTokenLogForCancel } from './request-summaries';
import { createAggregateRoot, addTraceItem, updateAggregateRootContent } from './handlers/utils';

let lastErrorContent: string | null = null;
let lastErrorTime = 0;

export function createPanelHandlers(deps: any): any {
  return {
    onShortcut: (text: string) => {
      try {
        // Prefer using SidePanel-provided setter when available to prefill input
        if (typeof (deps as any)?.setInputTextRef?.current === 'function') {
          try { (deps as any).setInputTextRef.current(text); return; } catch {}
        }
      } catch {}
      // Fallback: append as a user message so the intent is visible, user can press send
      deps.appendMessage({ actor: Actors.USER, content: text, timestamp: Date.now() });
    },
    onExecution: (event: any) => {
      try {
        // Drop duplicate terminal events that sometimes arrive twice from background
        try {
          const key = `${(event as any).actor}|${(event as any).state}|${String((event as any)?.data?.taskId || '')}`;
          // Use a window-scoped cache to dedupe within a short time window
          const win = window as any;
          win.__lastExecKeys = win.__lastExecKeys || new Map();
          const now = Date.now();
          const last = win.__lastExecKeys.get(key) as number | undefined;
          const isTerminal = String((event as any).state).startsWith('task.');
          if (isTerminal && last && (now - last) < 1000) return; // suppress rapid duplicates
          if (isTerminal) win.__lastExecKeys.set(key, now);
        } catch {}
        (deps.taskEventHandler as any)(event);
      } catch (e) {
        deps.logger.error('Task event handler error', e);
      }
    },
    onExecutionMeta: (message: any) => {
      try {
        const data = (message as any)?.data;
        if (data?.agentColor && deps.agentTraceRootIdRef.current) {
          deps.setMessageMetadata((prev: any) => {
            const existing: any = prev[deps.agentTraceRootIdRef.current as string] || {};
            return {
              ...prev,
              [deps.agentTraceRootIdRef.current as string]: {
                ...existing,
                agentColor: data.agentColor,
                agentName: (data as any).agentName || (existing as any).agentName,
              },
            } as any;
          });
        }
      } catch {}
    },
    onWorkflowGraphUpdate: (message: any) => {
      try {
        const g = (message as any)?.data?.graph;
        if (g) {
          const hasRunningTasks = g.nodes?.some((n: any) => n.status === 'running' || n.status === 'completed');
          if (hasRunningTasks && deps.getCurrentTaskAgentType?.() === 'multiagent') deps.setShowCloseTabs(true);
          deps.setMessageMetadata((prev: any) => {
            const cancelled = !!(prev as any)?.__workflowCancelled;
            let graph = g;
            if (cancelled && Array.isArray(g.nodes)) {
              const completedAtCancel: number[] = Array.isArray((prev as any)?.__workflowCompletedAtCancel)
                ? ((prev as any).__workflowCompletedAtCancel as number[])
                : [];
              const keepCompleted = new Set(completedAtCancel);
              graph = {
                ...g,
                nodes: g.nodes.map((n: any) => ({
                  ...n,
                  status: keepCompleted.has(Number(n.id)) ? 'completed' : 'cancelled',
                })),
              };
            }
            const hasInitial = (prev as any)?.__workflowGraphInitial !== undefined;
            if (hasInitial) return { ...prev, __workflowGraph: graph } as any;
            return { ...prev, __workflowGraphInitial: graph, __workflowGraph: graph } as any;
          });
        }
      } catch {}
    },
    onWorkflowPlanDataset: (message: any) => {
      try {
        const ds = (message as any)?.data?.dataset;
        if (ds) deps.setMessageMetadata((prev: any) => ({ ...prev, __workflowPlanDataset: ds } as any));
      } catch {}
    },
    onWorkflowProgress: (message: any) => {
      try {
        const text = (message as any)?.data?.message || '';
        const workerId = (message as any)?.data?.workerId;
        const actorHint = (message as any)?.data?.actor;
        const timestamp = Date.now();
        
        // Handle cancel messages
        try {
          const lowered = String(text).toLowerCase();
          if (lowered.includes('cancel')) {
            let shouldAppend = false;
            deps.setMessageMetadata((prev: any) => {
              const already = !!((prev as any)?.__cancelMessageShown);
              const g = ((prev as any)?.__workflowGraph as any) || ((prev as any)?.__workflowGraphInitial as any);
              let transformed = g;
              let completedIds: number[] = Array.isArray((prev as any)?.__workflowCompletedAtCancel)
                ? (prev as any).__workflowCompletedAtCancel
                : [];
              if (g && Array.isArray(g.nodes)) {
                completedIds = g.nodes.filter((n: any) => n.status === 'completed').map((n: any) => Number(n.id));
                const keepCompleted = new Set(completedIds);
                transformed = {
                  ...g,
                  nodes: g.nodes.map((n: any) => ({ ...n, status: keepCompleted.has(Number(n.id)) ? 'completed' : 'cancelled' })),
                };
              }
              const next: any = {
                ...prev,
                __workflowCancelled: true,
                __cancelMessageShown: true,
                __workflowCompletedAtCancel: completedIds,
              };
              if (transformed) next.__workflowGraph = transformed;
              if (!already) shouldAppend = true;
              return next;
            });
            if (shouldAppend) {
              if (deps.lastAgentMessageRef.current) {
                const rootMsgId = `${deps.lastAgentMessageRef.current.timestamp}-${deps.lastAgentMessageRef.current.actor}`;
                deps.setMessages((prev: any) => prev.map((m: any) => ((`${m.timestamp}-${m.actor}` === rootMsgId) ? { ...m, content: 'Task cancelled' } : m)));
              }
              deps.setShowStopButton(false);
              deps.setInputEnabled(true);
              try { deps.setShowInlineWorkflow(false); } catch {}
            }
          }
        } catch {}
        
        // Only create aggregate message for browser-use or multi-agent workflows
        const isAppropriateWorkflow = deps.getCurrentTaskAgentType?.() === 'agent' || 
                                      deps.getCurrentTaskAgentType?.() === 'multiagent' ||
                                      actorHint === 'multiagent';
        if (!isAppropriateWorkflow) return;
        
        // Use the SAME utilities as single-agent workflow for consistency
        const actorToUse = actorHint === 'multiagent' ? Actors.MULTIAGENT : Actors.AGENT_NAVIGATOR;
        const traceActor = actorHint || Actors.SYSTEM;
        
        if (text) {
          if (!deps.agentTraceRootIdRef.current) {
            createAggregateRoot(actorToUse, text, timestamp, deps);
          }
          addTraceItem(traceActor, text, timestamp, deps);
        }
        
        // Update the main message content for phase lines
        try {
          const isPhaseLine = /^(Creating plan|Processing plan|Refining plan|Cancelling workflow|\d+\s+workers executing plan)\b/i.test(text);
          if (isPhaseLine) {
            updateAggregateRootContent(text, deps);
          }
        } catch {}
        
        // Handle worker-specific items
        if (workerId && deps.agentTraceRootIdRef.current) {
          const rootId = deps.agentTraceRootIdRef.current;
          deps.setMessageMetadata((prev: any) => {
            const existing: any = prev[rootId] || {};
            const workerKey = String(workerId);
            const prevWorkerItems: Array<any> = Array.isArray(existing.workerItems) ? existing.workerItems : [];
            const without = prevWorkerItems.filter((w: any) => String(w.workerId) !== workerKey);
            const item = { workerId: workerKey, text, agentName: `Web Agent ${workerKey}`, color: existing.agentColor || '#A78BFA', timestamp };
            return {
              ...prev,
              [rootId]: {
                ...existing,
                workerItems: [...without, item],
                totalWorkers: Math.max((existing.totalWorkers || 0), without.length + 1),
              },
            };
          });
        }
      } catch {}
    },
    onFinalAnswer: (message: any) => {
      const text = (message as any)?.data?.text || '';
      if (text) {
        const ts = Date.now();
        const isAgentV2 = deps.getCurrentTaskAgentType?.() === 'multiagent';
        const hasAggregate = !!deps.agentTraceRootIdRef.current;
        if (isAgentV2 && hasAggregate) {
          const rootId = deps.agentTraceRootIdRef.current as string;
          // Update the existing Agent v2 aggregate message instead of appending a SYSTEM line
          deps.setMessages((prev: any) => prev.map((m: any) => ((`${m.timestamp}-${m.actor}` === rootId) ? { ...m, content: text } : m)));
          // Add a trace item to the aggregate metadata for auditability
          deps.setMessageMetadata((prev: any) => {
            const existing: any = prev[rootId] || {};
            const traceItems = Array.isArray(existing.traceItems) ? existing.traceItems : [];
            return { ...prev, [rootId]: { ...existing, traceItems: [...traceItems, { actor: (deps.lastAgentMessageRef.current?.actor || Actors.MULTIAGENT), content: text, timestamp: ts }] } } as any;
          });
          // Persist as Agent v2 actor (OVERSEER aggregate) in history
          try {
            const sid = deps.sessionIdRef.current;
            const aggActor = (deps.lastAgentMessageRef.current?.actor || Actors.MULTIAGENT) as any;
            if (sid) chatHistoryStore.addMessage(sid, { actor: aggActor, content: text, timestamp: ts } as any);
          } catch {}
        } else {
          // Fallback for non-v2 flows: append as SYSTEM
          deps.appendMessage({ actor: Actors.SYSTEM, content: text, timestamp: ts });
          try {
            const sid = deps.sessionIdRef.current;
            if (sid) chatHistoryStore.addMessage(sid, { actor: Actors.SYSTEM, content: text, timestamp: ts } as any);
          } catch {}
        }
      }
      deps.setInputEnabled(true);
      try { deps.setShowInlineWorkflow(false); } catch {}
    },
    onWorkflowEnded: (message: any) => {
      try {
        const data = message.data || {};
        if (data.ok === false && data.error) {
          const lowered = String(data.error || '').toLowerCase();
          const isCancel = lowered.includes('cancel');
          const ts = Date.now();
          if (!isCancel) {
            deps.appendMessage({ actor: Actors.SYSTEM, content: String(data.error), timestamp: ts });
          }
          // Count structured summary from workflow end cancel and apply to cancel line if present
          try {
            const sid = String((message as any)?.data?.sessionId || deps.sessionIdRef.current || '');
            const s = (message as any)?.data?.summary;
            if (sid && s) {
              const jobSummaryId = `${sid}_${s.totalLatencyMs || 0}_${s.totalCost || 0}_workflow_end_cancel`;
              if (!deps.processedJobSummariesRef.current.has(jobSummaryId)) {
                deps.processedJobSummariesRef.current.add(jobSummaryId);
                deps.updateSessionStats({
                  totalInputTokens: Number(s.totalInputTokens) || 0,
                  totalOutputTokens: Number(s.totalOutputTokens) || 0,
                  totalLatencyMs: Number(s.totalLatencyMs) || Math.round(Number(s.totalLatencySeconds) * 1000) || 0,
                  totalCost: Number(s.totalCost) || 0,
                });
              }
              if (deps.cancelSummaryTargetsRef.current.has(sid)) {
                const cancelMsgId = deps.cancelSummaryTargetsRef.current.get(sid) as string;
                deps.setRequestSummaries((prev: any) => {
                  const existing = (prev as any)[cancelMsgId];
                  const summary = {
                    inputTokens: Number(s.totalInputTokens) || 0,
                    outputTokens: Number(s.totalOutputTokens) || 0,
                    latency: (s.totalLatencySeconds ?? (s.totalLatencyMs ? (s.totalLatencyMs/1000).toFixed(2) : '0.00')).toString(),
                    cost: Number(s.totalCost) || 0,
                    apiCalls: Number(s.apiCallCount) || 0,
                    modelName: s.modelName,
                    provider: s.provider,
                  } as any;
                  const next = { ...prev, [cancelMsgId]: { ...(existing || {}), ...summary } } as any;
                  try { if (deps.sessionIdRef.current) chatHistoryStore.storeRequestSummaries(deps.sessionIdRef.current, next); } catch {}
                  return next;
                });
              }
            }
        } catch {}
        // Mark final processed for this session to avoid double counting when session_logs arrives
        try {
          const sid = String((message as any)?.data?.sessionId || deps.sessionIdRef.current || '');
          if (sid) deps.processedJobSummariesRef.current.add(`${sid}:final`);
        } catch {}
          try {
            deps.setMessageMetadata((prev: any) => {
              const g = ((prev as any)?.__workflowGraph as any) || ((prev as any)?.__workflowGraphInitial as any);
              if (!g || !Array.isArray(g.nodes)) return { ...prev, __workflowCancelled: true } as any;
              const completedIds: number[] = g.nodes.filter((n: any) => n.status === 'completed').map((n: any) => Number(n.id));
              const keepCompleted = new Set(completedIds);
              const transformed = { ...g, nodes: g.nodes.map((n: any) => ({ ...n, status: keepCompleted.has(Number(n.id)) ? 'completed' : 'cancelled' })) };
              return { ...prev, __workflowGraph: transformed, __workflowCancelled: true, __workflowCompletedAtCancel: completedIds } as any;
            });
          } catch {}
        } else if (data.ok === true) {
          // Do not overwrite the last agent output on successful completion.
          // Optionally, we could add a minimal SYSTEM trace item, but avoid mutating the visible last agent message.
          if (deps.getCurrentTaskAgentType?.() !== 'multiagent') {
            if (deps.agentTraceRootIdRef.current) {
              const rootId = deps.agentTraceRootIdRef.current as string;
              deps.setMessageMetadata((prev: any) => {
                const existing: any = prev[rootId] || {};
                const traceItems = Array.isArray(existing.traceItems) ? existing.traceItems : [];
                return { ...prev, [rootId]: { ...existing, traceItems: [...traceItems, { actor: Actors.SYSTEM, content: 'Workflow completed', timestamp: Date.now() }] } } as any;
              });
            }
          }
        }
      } catch {}
      deps.setInputEnabled(true);
      deps.setShowStopButton(false);
      try { deps.setIsFollowUpMode(true); } catch {}
      try { deps.setShowInlineWorkflow(false); } catch {}
      try {
        const sid = String((message as any)?.data?.sessionId || deps.sessionIdRef.current || '');
        const setInFlight: Set<string> | undefined = (window as any).__v2InFlight;
        if (sid && setInFlight && setInFlight.has(sid)) setInFlight.delete(sid);
      } catch {}
      try {
        if ((deps.getWorkerTabGroups?.() || []).length > 0 || deps.getCurrentTaskAgentType?.() === 'multiagent') deps.setShowCloseTabs(true);
      } catch {}
      try {
        const sid = String((message as any)?.data?.sessionId || deps.sessionIdRef.current || '');
        if (deps.getCurrentTaskAgentType?.() === 'multiagent' && sid && deps.portRef.current?.name === 'side-panel-connection') {
          deps.portRef.current.postMessage({ type: 'get_session_logs', sessionId: sid });
        }
      } catch {}
    },
    onSessionLogs: (message: any) => {
      try {
        const sid = String((message as any)?.sessionId || '');
        if (!sid || (deps.sessionIdRef.current && String(deps.sessionIdRef.current) !== sid)) return;
        const data = (message as any)?.data;
        const { summary, totalLatencyMs } = computeRequestSummaryFromSessionLogs(data);
        if (!summary) return;

        const dedupeKey = `${sid}_${totalLatencyMs}_${summary.cost}`;
        if (deps.processedJobSummariesRef.current.has(dedupeKey)) return;
        deps.processedJobSummariesRef.current.add(dedupeKey);

        const target = deps.lastAgentMessageRef.current;
        if (!target) return;
        const messageId = `${target.timestamp}-${target.actor}`;

        deps.setRequestSummaries((prev: any) => {
          const existing = (prev as any)[messageId];
          if (existing && Number(existing.latency) > 0 && Number(summary.latency) === 0) return prev;
          const next = { ...prev, [messageId]: summary } as any;
          try { if (deps.sessionIdRef.current) chatHistoryStore.storeRequestSummaries(deps.sessionIdRef.current, next); } catch {}
          return next;
        });

        // Also apply to the v2 cancel SYSTEM line if anchored
        try {
          if (deps.cancelSummaryTargetsRef.current.has(sid)) {
            const cancelMsgId = deps.cancelSummaryTargetsRef.current.get(sid) as string;
            deps.setRequestSummaries((prev: any) => {
              const existing = (prev as any)[cancelMsgId];
              const next = { ...prev, [cancelMsgId]: { ...(existing || {}), ...summary } } as any;
              try { if (deps.sessionIdRef.current) chatHistoryStore.storeRequestSummaries(deps.sessionIdRef.current, next); } catch {}
              return next;
            });
          }
        } catch {}

        deps.updateSessionStats({
          totalInputTokens: Number(summary.inputTokens) || 0,
          totalOutputTokens: Number(summary.outputTokens) || 0,
          totalLatencyMs: totalLatencyMs || 0,
          totalCost: Number(summary.cost) || 0,
        });
      } catch {}
    },
    onError: (message: any) => {
      if (deps.setHistoryContextLoading) deps.setHistoryContextLoading(false);
      
      const msgText = message.error || '';
      if (msgText && msgText !== 'Unknown message type') {
        const isAbortLike = String(msgText).toLowerCase().includes('abort') || String(msgText).toLowerCase().includes('cancel');
        if (!isAbortLike) {
          const now = Date.now();
          if (msgText !== lastErrorContent || now - lastErrorTime > 2000) {
            deps.appendMessage({ actor: Actors.SYSTEM, content: msgText, timestamp: now });
            lastErrorContent = msgText;
            lastErrorTime = now;
          }
        }
        deps.showToast?.(msgText);
      }
      deps.setInputEnabled(true);
      deps.setShowStopButton(false);
      try { deps.setIsJobActive?.(false); } catch {}
      try { deps.setIsPaused?.(false); } catch {}
      try { deps.setShowInlineWorkflow?.(false); } catch {}
    },
    onTokenLog: (message: any) => {
      try { if (message?.data && Array.isArray(message.data)) deps.setTokenLog?.(message.data); } catch {}
      try { handleTokenLogForCancel(message, deps.cancelSummaryTargetsRef, deps.setRequestSummaries, deps.sessionIdRef); } catch {}
    },
    onTabsClosed: (message: any) => {
      const closedTaskId = message.taskId ? String(message.taskId) : '';
      const closedGroupId = typeof message.groupId === 'number' ? Number(message.groupId) : undefined;
      deps.setWorkerTabGroups((prev: any[]) => {
        let next = prev;
        if (typeof closedGroupId === 'number') next = prev.filter((g: any) => Number((g as any).groupId) !== closedGroupId);
        else if (closedTaskId) next = prev.filter((g: any) => String(g.taskId) !== closedTaskId);
        if (next.length === 0) deps.setShowCloseTabs(false);
        return next;
      });
      deps.setHasFirstPreview(false);
      deps.setMirrorPreview(null);
      deps.setMirrorPreviewBatch([]);
    },
    onTabMirrorUpdate: (message: any) => {
      const data = message.data;
      if (!data) {
        // Keep last preview visible if workflow ended; only clear during active runs
        try {
          const ended = !!(deps as any)?.jobActiveRef && (deps as any).jobActiveRef.current === false;
          if (!ended) {
            deps.setHasFirstPreview(false);
            deps.setMirrorPreview(null);
            deps.setMirrorPreviewBatch([]);
            deps.setIsAgentModeActive(false);
          }
        } catch {
          deps.setHasFirstPreview(false);
          deps.setMirrorPreview(null);
          deps.setMirrorPreviewBatch([]);
          deps.setIsAgentModeActive(false);
        }
      } else {
        // Session gate: ignore updates when no session is active or session mismatches
        const currentSession = deps.sessionIdRef.current ? String(deps.sessionIdRef.current) : '';
        if (!currentSession) return;
        const targetSessionId = String((data as any)?.sessionId || (data as any)?.agentId || '');
        if (!targetSessionId || targetSessionId !== currentSession) return;

        if (deps.jobActiveRef.current) deps.setShowStopButton(true);
        try { if (data.agentId) deps.closableTaskIdsRef.current.add(String(data.agentId)); } catch {}

        try {
          if (deps.portRef.current?.name === 'side-panel-connection' && deps.sessionIdRef.current) {
            deps.portRef.current.postMessage({ type: 'preview_visibility', sessionId: deps.sessionIdRef.current, visible: true });
          }
        } catch {}
        deps.setMirrorPreview((prev: any) => {
          // If tabId changed, this is a new tab - replace entirely to avoid stale data
          if (data.tabId && data.tabId !== prev?.tabId) {
            return { url: data.url || '', title: data.title || '', screenshot: data.screenshot, tabId: data.tabId, color: data.color };
          }
          // Same tab - merge incremental updates
          const hasChanges = data.url !== prev?.url || data.title !== prev?.title || data.screenshot !== prev?.screenshot || data.color !== prev?.color;
          if (!hasChanges) return prev;
          return { url: data.url || prev?.url, title: data.title || prev?.title, screenshot: data.screenshot || prev?.screenshot, tabId: prev?.tabId, color: data.color || prev?.color };
        });
        try {
          if (deps.agentTraceRootIdRef.current && data.color) {
            const rootId = deps.agentTraceRootIdRef.current as string;
            deps.setMessageMetadata((prev: any) => {
              const existing: any = prev[rootId] || {};
              return { ...prev, [rootId]: { ...existing, agentColor: String(data.color) } } as any;
            });
          }
        } catch {}
        deps.setMirrorPreviewBatch([]);
        if (data.screenshot || data.url || data.tabId) deps.setHasFirstPreview(true);
      }
    },
    onTabMirrorBatch: (message: any) => {
      const arr = Array.isArray(message.data) ? message.data : [];
      const currentSession = deps.sessionIdRef.current ? String(deps.sessionIdRef.current) : '';
      // Hard session gate: if no active session, ignore batches entirely
      if (!currentSession) return;
      let filteredAll = (arr as Array<any>).filter((d: any) => String((d as any)?.sessionId || (d as any)?.agentId || '') === currentSession);

      if (filteredAll.length === 0) {
        // Preserve last preview if job already ended; only clear during active runs
        try {
          const ended = !!(deps as any)?.jobActiveRef && (deps as any).jobActiveRef.current === false;
          if (!ended) {
            deps.setMirrorPreviewBatch([]);
            deps.setMirrorPreview(null);
            deps.setHasFirstPreview(false);
            deps.setIsAgentModeActive(false);
          }
        } catch {
          deps.setMirrorPreviewBatch([]);
          deps.setMirrorPreview(null);
          deps.setHasFirstPreview(false);
          deps.setIsAgentModeActive(false);
        }
        return;
      }

      if (deps.jobActiveRef.current) deps.setShowStopButton(true);
      try {
        for (const d of filteredAll as Array<any>) {
          if (d && (d as any).agentId) deps.closableTaskIdsRef.current.add(String((d as any).agentId));
        }
      } catch {}

      if (filteredAll.length > 1) {
        const latestByAgent = new Map<string, any>();
        for (const d of filteredAll as Array<any>) {
          const key = String((d as any)?.agentId || '');
          if (!key) continue;
          const prev = latestByAgent.get(key);
          if (!prev || (d?.lastUpdated || 0) > (prev?.lastUpdated || 0)) latestByAgent.set(key, d);
        }

        const groups: Array<{ taskId: string; name: string; color: string }> = (deps.getWorkerTabGroups?.() || []) as any;
        const batch = Array.from(latestByAgent.values()).map((d: any) => {
          const id = String(d?.agentId || '');
          // Prefer authoritative workerIndex from backend over first-seen ordinal
          let ordinal = typeof d?.workerIndex === 'number' ? d.workerIndex : deps.ensureAgentOrdinal(id, d?.workerIndex);
          let name = `Web Agent ${ordinal}`;
          try {
            const mapped = groups.find((g: any) => String(g.taskId) === id);
            if (mapped && mapped.name) {
              name = String(mapped.name);
              const m = /Web Agent\s+(\d+)/i.exec(name);
              if (m && m[1]) ordinal = Number(m[1]);
            }
          } catch {}
          return { url: d?.url, title: d?.title, screenshot: d?.screenshot, tabId: d?.tabId, color: d?.color, agentId: d?.agentId, agentOrdinal: ordinal, agentName: name };
        });

        deps.logger.log('[Panel] Setting mirror preview batch:', batch.length, 'items');
        deps.setMirrorPreviewBatch(batch);
        deps.setHasFirstPreview(true);
        deps.setIsAgentModeActive(true);
        deps.setMirrorPreview(null);

        try {
          const groupsMap = new Map<string, { taskId: string; name: string; color: string }>();
          batch.forEach((p: any, idx: number) => {
            const id = String(p.agentId || `agent-${idx + 1}`);
            const color = String(p.color || '#A78BFA');
            const name = String(p.agentName || '').trim() || `Web Agent ${p.agentOrdinal || deps.ensureAgentOrdinal(id)}`;
            if (!groupsMap.has(id)) groupsMap.set(id, { taskId: id, name, color });
          });
          const groupsNext = Array.from(groupsMap.values());
          if (groupsNext.length > 0) deps.setWorkerTabGroups(groupsNext);
        } catch {}

      } else {
        const chosen = filteredAll.slice().sort((a: any, b: any) => (b?.lastUpdated || 0) - (a?.lastUpdated || 0))[0] as any;
        deps.setMirrorPreview({ url: chosen?.url, title: chosen?.title, screenshot: chosen?.screenshot, tabId: chosen?.tabId, color: chosen?.color });
        try {
          if (deps.agentTraceRootIdRef.current && chosen?.color) {
            const rootId = deps.agentTraceRootIdRef.current as string;
            deps.setMessageMetadata((prev: any) => {
              const existing: any = prev[rootId] || {};
              return { ...prev, [rootId]: { ...existing, agentColor: String(chosen.color) } } as any;
            });
          }
        } catch {}
        deps.setMirrorPreviewBatch([]);
        deps.setHasFirstPreview(true);
        deps.setIsAgentModeActive(true);
      }
    },
    onTabMirrorBatchForCleanup: (message: any) => {
      const arr = Array.isArray(message.data) ? message.data : [];
      try {
        const groupsMap = new Map<string, { taskId: string; name: string; color: string; groupId?: number }>();
        const currentSession = deps.sessionIdRef.current ? String(deps.sessionIdRef.current) : '';
        for (const d of arr as Array<any>) {
          if (currentSession && String((d as any)?.sessionId || (d as any)?.agentId || '') !== currentSession) continue;
          const id = String(d?.agentId || '').trim();
          if (!id) continue;
          // Prefer authoritative workerIndex from backend
          const ordinal = typeof d?.workerIndex === 'number' ? d.workerIndex : deps.ensureAgentOrdinal(id, d?.workerIndex);
          const name = `Web Agent ${ordinal}`;
          const color = String(d?.color || '#A78BFA');
          const groupId = typeof d?.groupId === 'number' ? d.groupId : undefined;
          if (!groupsMap.has(id)) groupsMap.set(id, { taskId: id, name, color, groupId });
        }
        const groups = Array.from(groupsMap.values());
        if (groups.length > 0) {
          deps.setWorkerTabGroups(groups);
          deps.setShowCloseTabs(true);
        }
      } catch {}
    },
    onWorkerSessionCreated: (message: any) => {
      try {
        const data: any = (message as any)?.data || {};
        const rootId = deps.agentTraceRootIdRef.current as string;
        if (deps.getCurrentTaskAgentType?.() === 'multiagent') {
          deps.setShowCloseTabs(true);
          const workerId = String(data.workerId || '1');
          const taskId = String(data.workerSessionId || data.sessionId || workerId);
          const agentName = `Web Agent ${workerId}`;
          const color = data.color || '#A78BFA';
          deps.setWorkerTabGroups((prev: Array<{ taskId: string; name: string; color: string }>) => {
            const exists = prev.some((g: { taskId: string }) => g.taskId === taskId);
            if (!exists) return [...prev, { taskId, name: agentName, color }];
            return prev;
          });
        }
        if (rootId) {
          deps.setMessageMetadata((prev: any) => {
            const existing: any = prev[rootId] || {};
            const mapping = Array.isArray(existing.workerSessionMap) ? existing.workerSessionMap : [];
            const dedup = mapping.filter((m: any) => String(m.workerId) !== String(data.workerId));
            const nextMap = [...dedup, { workerId: String(data.workerId), sessionId: String(data.workerSessionId) }];
            return { ...prev, [rootId]: { ...existing, workerSessionMap: nextMap } } as any;
          });
        }
      } catch {}
    },
    onHistoryContextUpdated: (message: any) => {
      try {
        const active = (message as any)?.active ?? false;
        if (deps.setHistoryContextActive) {
          deps.setHistoryContextActive(active);
        }
        if (deps.setHistoryContextLoading) {
          deps.setHistoryContextLoading(false);
        }
        if (active) {
          const windowHours = (message as any)?.windowHours || 24;
          
          // Set "just completed" state for 1 minute
          if (deps.setHistoryJustCompleted) {
            deps.setHistoryJustCompleted(true);
            
            // Clear any existing timer
            if (deps.historyCompletedTimerRef?.current) {
              clearTimeout(deps.historyCompletedTimerRef.current);
            }
            
            // Set timer to clear after 60 seconds
            deps.historyCompletedTimerRef.current = window.setTimeout(() => {
              if (deps.setHistoryJustCompleted) {
                deps.setHistoryJustCompleted(false);
              }
            }, 60000);
          }
          
          // Show toast notification instead of chat message
          if (deps.showToast) {
            deps.showToast(`✓ History context loaded (${windowHours}h window)`);
          }
        }
      } catch (e) {
        deps.logger.error('Failed to handle history context updated:', e);
      }
    },
    onHistoryContextStatus: (message: any) => {
      try {
        const active = (message as any)?.active ?? false;
        if (deps.setHistoryContextActive) {
          deps.setHistoryContextActive(active);
        }
      } catch (e) {
        deps.logger.error('Failed to handle history context status:', e);
      }
    },
    /** Handles confirmation of cancel_task from backend */
    onCancelTaskResult: (message: any) => {
      const data = (message as any)?.data || message || {};
      
      // Clear timeout and reset cancellation tracking
      if (deps.cancelTimeoutRef?.current) {
        clearTimeout(deps.cancelTimeoutRef.current);
        deps.cancelTimeoutRef.current = null;
      }
      if (deps.isCancellingRef) deps.isCancellingRef.current = false;
      deps.setIsStopping?.(false);
      
      if (data.success) {
        deps.setIsJobActive?.(false);
        deps.setInputEnabled(true);
        deps.setShowStopButton(false);
        deps.setIsPaused?.(false);
        
        // Stop animations - mark aggregate message as completed and update content
        const rootId = deps.agentTraceRootIdRef?.current;
        if (deps.lastAgentMessageRef?.current) {
          const rootMsgId = `${deps.lastAgentMessageRef.current.timestamp}-${deps.lastAgentMessageRef.current.actor}`;
          deps.setMessages?.((prev: any[]) => prev.map((m: any) => 
            `${m.timestamp}-${m.actor}` === rootMsgId ? { ...m, content: 'Task cancelled' } : m
          ));
        }
        deps.setMessageMetadata?.((prev: any) => {
          const update: any = { ...prev, __workflowCancelled: true };
          if (rootId) update[rootId] = { ...prev[rootId], isCompleted: true };
          return update;
        });
        deps.agentTraceRootIdRef && (deps.agentTraceRootIdRef.current = null);
        deps.agentTraceActiveRef && (deps.agentTraceActiveRef.current = false);
        deps.setAgentTraceRootId?.(null);
        
        // Show Close Tabs if there were workers
        const hasWorkers = (deps.getWorkerTabGroups?.() || []).length > 0;
        if (hasWorkers || deps.getCurrentTaskAgentType?.() === 'multiagent' || data.workflowCancelled) {
          deps.setShowCloseTabs?.(true);
        }
      } else {
        // Cancellation failed - keep stop button visible for retry
        deps.appendMessage({ 
          actor: Actors.SYSTEM, 
          content: `Failed to stop: ${data.error || 'Cancellation failed'}. Try Emergency Stop if the issue persists.`, 
          timestamp: Date.now() 
        });
        deps.setInputEnabled(true);
      }
    },
    onKillAllComplete: (message: any) => {
      const data = (message as any)?.data || {};
      
      // Clear any pending cancellation state
      if (deps.cancelTimeoutRef?.current) {
        clearTimeout(deps.cancelTimeoutRef.current);
        deps.cancelTimeoutRef.current = null;
      }
      if (deps.isCancellingRef) deps.isCancellingRef.current = false;
      deps.setIsStopping?.(false);
      
      // Stop animations - mark aggregate message as completed and update content
      const rootId = deps.agentTraceRootIdRef?.current;
      if (deps.lastAgentMessageRef?.current) {
        const rootMsgId = `${deps.lastAgentMessageRef.current.timestamp}-${deps.lastAgentMessageRef.current.actor}`;
        deps.setMessages?.((prev: any[]) => prev.map((m: any) => 
          `${m.timestamp}-${m.actor}` === rootMsgId ? { ...m, content: 'Task cancelled' } : m
        ));
      }
      deps.setMessageMetadata?.((prev: any) => {
        const update: any = { ...prev, __workflowCancelled: true };
        if (rootId) update[rootId] = { ...prev[rootId], isCompleted: true };
        return update;
      });
      deps.agentTraceRootIdRef && (deps.agentTraceRootIdRef.current = null);
      deps.agentTraceActiveRef && (deps.agentTraceActiveRef.current = false);
      deps.setAgentTraceRootId?.(null);
      
      // Reset all UI state
      deps.setInputEnabled(true);
      deps.setShowStopButton(false);
      deps.setIsJobActive?.(false);
      deps.setIsPaused?.(false);
      deps.setShowInlineWorkflow?.(false);
      deps.setShowCloseTabs?.(false);
      deps.setMirrorPreview?.(null);
      deps.setMirrorPreviewBatch?.([]);
      deps.setHasFirstPreview?.(false);
      
      if (data.success) {
        deps.appendMessage({ 
          actor: Actors.SYSTEM, 
          content: `**Emergency stop complete**\nTerminated: ${data.killedWorkflows || 0} workflows, ${data.killedTasks || 0} tasks, ${data.killedMirrors || 0} previews`, 
          timestamp: Date.now() 
        });
      } else if (data.error) {
        deps.appendMessage({ 
          actor: Actors.SYSTEM, 
          content: `Emergency stop encountered issues: ${data.error}`, 
          timestamp: Date.now() 
        });
      }
    },
    onDisconnect: () => { deps.setInputEnabled(true); },
  };
}


