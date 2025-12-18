import { globalTokenTracker } from '../utils/token-tracker';
import { errorLog } from '../utils/error-log';
import { sessionLogArchive } from '../utils/session-log-archive';

export function handleGetTokenLog(port: chrome.runtime.Port, taskId: string) {
  if (!taskId) return port.postMessage({ type: 'token_log', error: 'No taskId provided' });
  const usages = globalTokenTracker.getTokensForTask(String(taskId)) || [];
  return port.postMessage({ type: 'token_log', taskId: String(taskId), data: usages });
}

export function handleGetErrorLog(port: chrome.runtime.Port, sessionId: string) {
  if (!sessionId) return port.postMessage({ type: 'error_log', error: 'No sessionId provided' });
  const entries = errorLog.getBySession(sessionId);
  return port.postMessage({ type: 'error_log', sessionId, data: entries });
}

export function handleGetAgentLog(port: chrome.runtime.Port, taskManager: any, taskId: string) {
  if (!taskId) return port.postMessage({ type: 'agent_log', error: 'No taskId provided' });
  const tasks = taskManager.getAllTasks();
  const main = tasks.find((t: any) => String((t as any).id) === taskId);
  const related = tasks.filter((t: any) => String((t as any).parentSessionId || '') === taskId);
  const scope = [main, ...related].filter(Boolean) as any[];

  const apiLines: string[] = [];
  apiLines.push(`# Agent API Log for session ${taskId}`);
  const fmt = (ts: number) => new Date(ts).toISOString();
  const usages = [
    ...globalTokenTracker.getTokensForTask(taskId),
    ...tasks.filter((t: any) => String((t as any).parentSessionId || '') === taskId).flatMap((t: any) => globalTokenTracker.getTokensForTask(String((t as any).id)))
  ];
  if (usages.length === 0) {
    apiLines.push('\n_No API calls recorded._');
  } else {
    const sorted = [...usages].sort((a: any, b: any) => (Number(a.timestamp||0)) - (Number(b.timestamp||0)));
    for (const u of sorted) {
      const ts = fmt(Number(u.timestamp || Date.now()));
      apiLines.push(`- [${ts}] ${u.provider} • ${u.modelName} • in=${u.inputTokens} out=${u.outputTokens} total=${u.totalTokens} cost=$${(u.cost||0).toFixed(6)}`);
      try {
        if ((u as any).response) {
          const copy: any = Array.isArray((u as any).response) ? (u as any).response : { ...(u as any).response };
          const str = JSON.stringify(copy);
          apiLines.push('```json');
          apiLines.push(str);
          apiLines.push('```');
        }
      } catch {}
    }
  }

  for (const t of scope) {
    try {
      apiLines.push('');
      apiLines.push(`## Agent: ${(t as any).name} (${(t as any).id})`);
    } catch {}
  }

  const content = apiLines.join('\n');
  return port.postMessage({ type: 'agent_log', taskId, data: content });
}

export function handleGetCombinedTokenLog(port: chrome.runtime.Port, taskManager: any, sessionId: string) {
  if (!sessionId) return port.postMessage({ type: 'combined_token_log', error: 'No sessionId provided' });
  const tasks = taskManager.getAllTasks();
  const main = tasks.find((t: any) => String((t as any).id) === sessionId);
  const related = tasks.filter((t: any) => String((t as any).parentSessionId || '') === sessionId);
  const scopeIds = [ ...(main ? [String((main as any).id)] : [String(sessionId)]), ...related.map((t: any) => String((t as any).id)) ];
  const allUsages: any[] = [];
  for (const id of scopeIds) {
    try {
      const list = (globalTokenTracker as any)?.getTokensForTask?.(id) || [];
      allUsages.push(...list);
    } catch {}
  }
  const seen = new Set<string>();
  const dedup = allUsages.filter((u: any) => {
    const key = `${u.taskId || ''}|${u.timestamp}|${u.provider}|${u.modelName}|${u.totalTokens}|${u.cost}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  }).sort((a: any, b: any) => (a.timestamp||0) - (b.timestamp||0));

  let workerSessions: Array<{ sessionId: string; workerIndex: number }> = [];
  try {
    const fromTracker = (globalTokenTracker as any)?.getWorkersForParent?.(sessionId);
    if (Array.isArray(fromTracker) && fromTracker.length > 0) {
      workerSessions = fromTracker;
    } else {
      for (const t of related) {
        try {
          const wid = Number((t as any).workerIndex);
          const id = String((t as any).id);
          if (Number.isFinite(wid) && wid > 0 && id) {
            workerSessions.push({ sessionId: id, workerIndex: wid });
          }
        } catch {}
      }
    }
  } catch {}

  return port.postMessage({ type: 'combined_token_log', sessionId, data: dedup, workerSessions });
}

/**
 * New structured export: returns main/worker grouped logs and totals for a session.
 */
export function handleGetSessionLogs(port: chrome.runtime.Port, taskManager: any, sessionId: string) {
  if (!sessionId) return port.postMessage({ type: 'session_logs', error: 'No sessionId provided' });
  try {
    // Build scope similar to combined export for robustness
    const tasks = taskManager.getAllTasks();
    const main = tasks.find((t: any) => String((t as any).id) === sessionId);
    const related = tasks.filter((t: any) => String((t as any).parentSessionId || '') === sessionId);
    const scopeIds: string[] = [ ...(main ? [String((main as any).id)] : [String(sessionId)]), ...related.map((t: any) => String((t as any).id)) ];

    const allUsages: any[] = [];
    for (const id of scopeIds) {
      try {
        const list = (globalTokenTracker as any)?.getTokensForTask?.(id) || [];
        allUsages.push(...list);
      } catch {}
    }
    // Dedup conservatively
    const seen = new Set<string>();
    const usages = allUsages.filter((u: any) => {
      const key = `${u.taskId || ''}|${u.timestamp}|${u.provider}|${u.modelName}|${u.totalTokens}|${u.cost}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).sort((a: any, b: any) => (a.timestamp||0) - (b.timestamp||0));

    // Group into main and workers
    const mainUsages: any[] = usages.filter((u: any) => !u?.workerIndex);
    const workers: Record<number, any[]> = {};
    for (const u of usages) {
      const idx = Number(u?.workerIndex);
      if (Number.isFinite(idx) && idx > 0) {
        if (!workers[idx]) workers[idx] = [];
        workers[idx].push(u);
      }
    }
    // Within worker groups, stable sort and we will group by subtaskId in the panel
    for (const k of Object.keys(workers)) {
      workers[Number(k)] = workers[Number(k)].sort((a: any, b: any) => (a.timestamp||0) - (b.timestamp||0));
    }

    // Totals (cost -1 means unavailable, only sum valid costs)
    const sum = (arr: any[]) => {
      let hasAnyCost = false;
      const result = arr.reduce((acc, u) => {
        acc.inputTokens += Math.max(0, Number(u.inputTokens) || 0);
        acc.outputTokens += Math.max(0, Number(u.outputTokens) || 0);
        acc.totalTokens += Math.max(0, Number(u.totalTokens) || 0);
        const uCost = Number(u.cost);
        if (isFinite(uCost) && uCost >= 0) {
          acc.cost += uCost;
          hasAnyCost = true;
        }
        return acc;
      }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 });
      if (!hasAnyCost) result.cost = -1;
      return result;
    };
    const perWorker: Record<number, { inputTokens: number; outputTokens: number; totalTokens: number; cost: number }> = {};
    for (const [k, arr] of Object.entries(workers)) {
      perWorker[Number(k)] = sum(arr);
    }
    const overall = sum(usages);

    const data = { main: mainUsages, workers, totals: { perWorker, overall } };
    return port.postMessage({ type: 'session_logs', sessionId: String(sessionId), data });
  } catch (e) {
    return port.postMessage({ type: 'session_logs', sessionId: String(sessionId), error: (e as any)?.message || 'Failed to get session logs' });
  }
}

/**
 * Return combined logs for a session: live current run logs + archived prior runs, chronologically.
 * Logs are enriched with workerIndex and workflowRunIndex from task manager/token tracker if not already present.
 */
export function handleGetCombinedSessionLogs(port: chrome.runtime.Port, taskManager: any, sessionId: string) {
  if (!sessionId) return port.postMessage({ type: 'combined_session_logs', error: 'No sessionId provided' });
  try {
    const sid = String(sessionId);
    // Live usages across scope (main + workers)
    const tasks = taskManager.getAllTasks();
    const main = tasks.find((t: any) => String((t as any).id) === sid);
    const related = tasks.filter((t: any) => String((t as any).parentSessionId || '') === sid);
    const scopeIds: string[] = [ ...(main ? [String((main as any).id)] : [sid]), ...related.map((t: any) => String((t as any).id)) ];
    
    // Build a map of taskId -> workerIndex from tasks for enrichment
    const taskToWorkerIndex = new Map<string, number>();
    for (const t of related) {
      try {
        const wid = Number((t as any).workerIndex);
        const tid = String((t as any).id);
        if (Number.isFinite(wid) && wid > 0 && tid) {
          taskToWorkerIndex.set(tid, wid);
        }
      } catch {}
    }
    
    // Get the current workflow run index for this session
    const currentRunIndex = (globalTokenTracker as any)?.getWorkflowRunIndex?.(sid) || 0;
    
    const live: any[] = [];
    for (const id of scopeIds) {
      try {
        const list = (globalTokenTracker as any)?.getTokensForTask?.(id) || [];
        live.push(...list);
      } catch {}
    }
    // Archived prior runs
    const archived = sessionLogArchive.get(sid);
    const merged = [...archived, ...live];
    // Deduplicate merged list using stable key similar to archive (now includes workflowRunIndex)
    const seen = new Set<string>();
    const all = merged.filter((u: any) => {
      const key = `${Number(u?.timestamp||0)}|${String(u?.provider||'')}|${String(u?.modelName||'')}|${Number(u?.inputTokens||0)}|${Number(u?.outputTokens||0)}|${Number(u?.totalTokens||(Number(u?.inputTokens||0)+Number(u?.outputTokens||0)))}|${Number(u?.cost||0)}|${Number((u as any)?.workerIndex||0)}|${Number((u as any)?.subtaskId||0)}|${Number((u as any)?.workflowRunIndex||0)}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).sort((a: any, b: any) => (Number(a?.timestamp||0)) - (Number(b?.timestamp||0)));
    
    // Enrich logs with workerIndex and workflowRunIndex if not already present
    const enriched = all.map((u: any) => {
      let enrichedLog = u;
      
      // Enrich workerIndex if missing
      if (typeof enrichedLog?.workerIndex !== 'number' || enrichedLog.workerIndex <= 0) {
        const tid = String(enrichedLog?.taskId || '');
        const wid = taskToWorkerIndex.get(tid);
        if (typeof wid === 'number' && wid > 0) {
          enrichedLog = { ...enrichedLog, workerIndex: wid };
        }
      }
      
      // Enrich workflowRunIndex if missing (use current run index as fallback for live logs)
      if (typeof enrichedLog?.workflowRunIndex !== 'number' || enrichedLog.workflowRunIndex <= 0) {
        // Only enrich with current run index if this appears to be a live log (not archived)
        // We can detect this by checking if the log was found in live array
        const isLiveLog = live.some(l => 
          l.timestamp === enrichedLog.timestamp && 
          l.provider === enrichedLog.provider &&
          l.totalTokens === enrichedLog.totalTokens
        );
        if (isLiveLog && currentRunIndex > 0) {
          enrichedLog = { ...enrichedLog, workflowRunIndex: currentRunIndex };
        }
      }
      
      return enrichedLog;
    });
    
    return port.postMessage({ type: 'combined_session_logs', sessionId: sid, data: enriched });
  } catch (e) {
    return port.postMessage({ type: 'combined_session_logs', sessionId: String(sessionId), error: (e as any)?.message || 'Failed to get combined session logs' });
  }
}


