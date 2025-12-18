/* eslint-disable @typescript-eslint/no-explicit-any */
// ---------- Generic text helpers ----------

export function clampText(s: string): string {
  try { return String(s || ''); } catch { return String(s || ''); }
}

export function getTextFromParts(parts: any[]): string {
  try {
    if (!Array.isArray(parts)) return '';
    return parts.map((p: any) => {
      if (!p) return '';
      if (typeof p === 'string') return p;
      if (typeof p.text === 'string') return p.text;
      if (typeof p.input_text === 'string') return p.input_text;
      if (p?.type === 'text' && typeof p?.text === 'string') return p.text; // Anthropic
      return '';
    }).filter(Boolean).join('\n');
  } catch { return ''; }
}

function isSystemishContent(content: string): boolean {
  return (
    content.startsWith('[Chat History]') ||
    content.startsWith('<chat_history>') ||
    content.includes('<system_instructions>')
  );
}

function isUserRequestContent(content: string): boolean {
  return content.startsWith('[User Request]') || content.includes('<nano_user_request>');
}

// ---------- Request/Response extraction with role formatting ----------

export function extractRequestTextFromMessages(messages: any[], defaultRole?: string): string {
  try {
    const lines: string[] = [];
    for (const m of messages) {
      const content = ((): string => {
        if (typeof m?.content === 'string') return m.content;
        if (Array.isArray(m?.content)) return getTextFromParts(m.content);
        if (m?.type === 'text' && typeof m?.text === 'string') return m.text;
        return '';
      })();
      if (!content) continue;
      const role = String(m?.role || m?.author || defaultRole || 'user').toUpperCase();
      if (isUserRequestContent(content)) lines.push(content);
      else if (isSystemishContent(content) || role === 'SYSTEM') lines.push(`SYSTEM: ${content}`);
      else lines.push(`${role}: ${content}`);
    }
    return lines.filter(Boolean).join('\n');
  } catch { return ''; }
}

export function extractRequestText(req: any, defaultRole?: string): string {
  try {
    if (!req) return 'N/A';
    if (Array.isArray(req.messages)) return extractRequestTextFromMessages(req.messages, defaultRole);
    if (Array.isArray(req.contents)) {
      const out: string[] = [];
      for (const c of req.contents) {
        const content = getTextFromParts(c?.parts || []);
        if (!content) continue;
        const role = String(c?.role || defaultRole || 'user').toUpperCase();
        if (isUserRequestContent(content)) out.push(content);
        else if (isSystemishContent(content) || role === 'SYSTEM') out.push(`SYSTEM: ${content}`);
        else out.push(`${role}: ${content}`);
      }
      return out.filter(Boolean).join('\n');
    }
    if (typeof req.prompt === 'string') return req.prompt;
    if (typeof req.input === 'string') return req.input;
    return JSON.stringify(req, null, 2);
  } catch { return JSON.stringify(req || {}); }
}

export function extractResponseText(res: any): string {
  try {
    if (!res) return 'N/A';
    // OpenAI
    if (Array.isArray(res?.choices)) {
      const c = res.choices[0] || {};
      if (typeof c?.message?.content === 'string') return c.message.content;
      if (Array.isArray(c?.message?.content)) return getTextFromParts(c.message.content);
      if (typeof c?.text === 'string') return c.text;
    }
    // Gemini
    if (Array.isArray(res?.candidates)) {
      const cand = res.candidates[0] || {};
      const parts = cand?.content?.parts || [];
      const txt = getTextFromParts(parts);
      if (txt) return txt;
    }
    // Anthropic
    if (Array.isArray(res?.content)) {
      const txt = getTextFromParts(res.content);
      if (txt) return txt;
    }
    if (typeof res?.output_text === 'string') return res.output_text;
    if (typeof res?.text === 'string') return res.text;
    return JSON.stringify(res, null, 2);
  } catch { return JSON.stringify(res || {}); }
}

// ---------- Download handlers (ported from component) ----------

export function downloadPlan(port: chrome.runtime.Port | null, sessionIdRaw: string | null): void {
  try {
    const sessionId = String(sessionIdRaw || '');
    if (!port || port.name !== 'side-panel-connection' || !sessionId) return;
    let timeoutId: any = null;
    let knownWorkers: Array<{ sessionId: string; workerIndex: number }> = [];

    const once = (ev: any) => {
      try {
        if (ev?.type === 'combined_token_log' && String(ev?.sessionId || '') === sessionId) {
          try { port.onMessage.removeListener(once); } catch {}
          try { if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; } } catch {}
          const usages: any[] = Array.isArray(ev?.data) ? ev.data : [];
          knownWorkers = Array.isArray((ev as any)?.workerSessions) ? (ev as any).workerSessions as Array<{ sessionId: string; workerIndex: number }> : [];

          const mainOnly = usages.filter(u => !knownWorkers.some(w => String(w.sessionId) === String(u?.sessionId || '')));

          const lines: string[] = [];
          lines.push(`# Main Messages for session ${sessionId}`);
          lines.push('');
          lines.push(`API calls: ${mainOnly.length}`);

          if (mainOnly.length === 0) {
            lines.push('');
            lines.push('_No main API calls recorded._');
          } else {
            let step = 0;
            for (const u of mainOnly) {
              step += 1;
              const ts = new Date(Number(u?.timestamp || Date.now())).toISOString();
              const provider = String(u?.provider || 'Unknown');
              const model = String(u?.modelName || 'unknown');
              const inTok = Number(u?.inputTokens || 0);
              const outTok = Number(u?.outputTokens || 0);
              const thoughtTok = Number(u?.thoughtTokens || 0);
              const totalTok = Number(u?.totalTokens || (inTok + outTok));
              const cost = typeof u?.cost === 'number' ? u.cost.toFixed(6) : String(u?.cost || 0);
              lines.push('');
              lines.push(`## Main • Step ${step} • ${ts}`);
              lines.push(`- provider: ${provider}`);
              lines.push(`- model: ${model}`);
              lines.push(`- tokens: in ${inTok}, out ${outTok}, thought ${thoughtTok}, total ${totalTok}`);
              lines.push(`- cost: $${cost}`);
              lines.push('');
              lines.push('Input');
              lines.push('```text');
              lines.push(extractRequestText((u as any)?.request, (u as any)?.role));
              lines.push('```');
              lines.push('');
              lines.push('Output');
              lines.push('```text');
              lines.push(extractResponseText((u as any)?.response));
              lines.push('```');
              lines.push('');
            }
          }

          const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `main-messages-${sessionId}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch {}
    };

    try { port.onMessage.addListener(once); } catch {}
    port.postMessage({ type: 'get_combined_token_log', sessionId });
    timeoutId = setTimeout(() => {
      try { port.onMessage.removeListener(once); } catch {}
      console.warn('[Panel] Main messages (plan) download timed out after 10s');
    }, 10000);
  } catch {}
}

export function downloadWorkerMessages(port: chrome.runtime.Port | null, sessionIdRaw: string | null, agentTraceRootId: string | null, messageMetadata: any): void {
  try {
    if (!port || port.name !== 'side-panel-connection') return;
    const sessionId = String(sessionIdRaw || '');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let knownWorkers: Array<{ sessionId: string; workerIndex: number }> = [];

    const once = (ev: any) => {
      try {
        if (ev?.type === 'combined_token_log' && String(ev?.sessionId || '') === sessionId) {
          try { port.onMessage.removeListener(once); } catch {}
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
          const usages: any[] = Array.isArray(ev?.data) ? ev.data : [];
          knownWorkers = Array.isArray((ev as any)?.workerSessions) ? (ev as any).workerSessions : [];

          const planDataset = (messageMetadata as any)?.__workflowPlanDataset;
          const sessionToSubtask = new Map<string, any>();
          if (Array.isArray(planDataset?.subtasks)) {
            for (const subtask of planDataset.subtasks) {
              if (subtask?.sessionId) sessionToSubtask.set(String(subtask.sessionId), subtask);
            }
          }

          const byLabel = new Map<string, any[]>();
          for (const u of usages) {
            const uSid = String(u?.sessionId || '');
            let label = 'Main';
            const worker = knownWorkers.find(w => String(w.sessionId) === uSid);
            if (worker) label = `Worker ${worker.workerIndex}`;
            else if (uSid !== sessionId) label = `Unknown Worker (${uSid.substring(0, 8)})`;
            if (!byLabel.has(label)) byLabel.set(label, []);
            byLabel.get(label)!.push(u);
          }

          const labels = Array.from(byLabel.keys()).sort((a, b) => {
            if (a === 'Main') return -1; if (b === 'Main') return 1;
            const aMatch = a.match(/^Worker (\d+)$/); const bMatch = b.match(/^Worker (\d+)$/);
            if (aMatch && bMatch) return Number(aMatch[1]) - Number(bMatch[1]);
            if (aMatch) return -1; if (bMatch) return 1; return a.localeCompare(b);
          });

          const lines: string[] = [];
          lines.push(`# Worker Messages for session ${sessionId}`);
          lines.push('');
          if (labels.length === 0 || usages.length === 0) {
            lines.push('_No worker messages recorded._');
          } else {
            for (const label of labels) {
              const labelUsages = byLabel.get(label) || [];
              lines.push(`## ${label} (${labelUsages.length} API calls)`);
              lines.push('');
              if (labelUsages.length === 0) {
                lines.push('_No API calls recorded for this worker._');
                lines.push('');
                continue;
              }
              let step = 0;
              for (const u of labelUsages) {
                step += 1;
                const ts = new Date(Number(u?.timestamp || Date.now())).toISOString();
                const provider = String(u?.provider || 'Unknown');
                const model = String(u?.modelName || 'unknown');
                const inTok = Number(u?.inputTokens || 0);
                const outTok = Number(u?.outputTokens || 0);
                const thoughtTok = Number(u?.thoughtTokens || 0);
                const totalTok = Number(u?.totalTokens || (inTok + outTok));
                const cost = typeof u?.cost === 'number' ? u.cost.toFixed(6) : String(u?.cost || 0);
                lines.push(`### ${label} • Step ${step} • ${ts}`);
                lines.push(`- provider: ${provider}`);
                lines.push(`- model: ${model}`);
                lines.push(`- tokens: in ${inTok}, out ${outTok}, thought ${thoughtTok}, total ${totalTok}`);
                lines.push(`- cost: $${cost}`);
                lines.push('');
                lines.push('Request');
                lines.push('```text');
                lines.push(extractRequestText((u as any)?.request, (u as any)?.role));
                lines.push('```');
                lines.push('');
                lines.push('Response');
                lines.push('```text');
                lines.push(extractResponseText((u as any)?.response));
                lines.push('```');
                lines.push('');
              }
              lines.push('');
            }
          }

          const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `workers-${sessionId}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch {}
    };

    timeoutId = setTimeout(() => {
      try { port.onMessage.removeListener(once); } catch {}
      console.warn('[Panel] Worker Messages download timed out after 10s');
    }, 10000);

    try { port.onMessage.addListener(once); } catch {}
    port.postMessage({ type: 'get_combined_token_log', sessionId });
  } catch {}
}

export function downloadErrors(port: chrome.runtime.Port | null, sessionIdRaw: string | null, setErrorLogEntries: (entries: any[]) => void): void {
  try {
    if (!port || port.name !== 'side-panel-connection') return;
    const sessionId = String(sessionIdRaw || '');
    const once = (ev: any) => {
      try {
        if (ev?.type === 'error_log' && String(ev?.sessionId || '') === sessionId) {
          try { port.onMessage.removeListener(once); } catch {}
          const entries: any[] = Array.isArray(ev?.data) ? ev.data : [];
          setErrorLogEntries(entries);
          const lines: string[] = [];
          lines.push(`# Errors for session ${sessionId}`);
          if (entries.length === 0) {
            lines.push('\n_No errors recorded._');
          } else {
            for (const e of entries) {
              const ts = new Date(Number(e?.timestamp || Date.now())).toISOString();
              const wid = e?.workerId != null ? `Worker ${e.workerId}` : '';
              const src = e?.source ? ` • ${e.source}` : '';
              lines.push(`- [${ts}] ${wid}${src} — ${e?.message || ''}`);
            }
          }
          const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `session-errors-${sessionId}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch {}
    };
    try { port.onMessage.addListener(once); } catch {}
    port.postMessage({ type: 'get_error_log', sessionId });
  } catch {}
}

export function downloadCombinedSessionLogs(port: chrome.runtime.Port | null, sessionIdRaw: string | null): void {
  try {
    if (!port || port.name !== 'side-panel-connection') return;
    const sessionId = String(sessionIdRaw || '');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const once = (ev: any) => {
      try {
        if (ev?.type === 'combined_session_logs' && String(ev?.sessionId || '') === sessionId) {
          try { port.onMessage.removeListener(once); } catch {}
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
          const usages: any[] = Array.isArray(ev?.data) ? ev.data : [];
          const lines: string[] = [];
          lines.push(`# Combined API Call Logs for session ${sessionId}`);
          lines.push('');
          lines.push(`Total calls: ${usages.length}`);

          // Helper function to format a single log entry
          const formatLogEntry = (u: any, stepNum?: number, headingLevel: string = '###'): string[] => {
            const entryLines: string[] = [];
            const ts = new Date(Number(u?.timestamp || Date.now())).toISOString();
            const provider = String(u?.provider || 'Unknown');
            const model = String(u?.modelName || 'unknown');
            const role = String(u?.role || 'unknown');
            const inTok = Number(u?.inputTokens || 0);
            const outTok = Number(u?.outputTokens || 0);
            const totalTok = Number(u?.totalTokens || (inTok + outTok));
            const cost = typeof u?.cost === 'number' ? u.cost.toFixed(6) : String(u?.cost || 0);
            const stepPrefix = typeof stepNum === 'number' ? `Step ${stepNum} • ` : '';
            entryLines.push(`\n${headingLevel} ${stepPrefix}[${role}] ${provider} • ${model} • ${ts}`);
            entryLines.push(`- tokens: in ${inTok}, out ${outTok}, total ${totalTok}`);
            entryLines.push(`- cost: $${cost}`);
            entryLines.push('Request');
            entryLines.push('```text');
            entryLines.push(clampText(extractRequestText((u as any)?.request)) || '');
            entryLines.push('```');
            entryLines.push('Response');
            entryLines.push('```text');
            entryLines.push(clampText(extractResponseText((u as any)?.response)) || '');
            entryLines.push('```');
            return entryLines;
          };

          // Helper to categorize logs within a run
          interface RunLogs {
            estimator: any[];
            planner: any[];
            refiner: any[];
            validator: any[];
            workers: Map<number, any[]>;
            other: any[];
          }

          const categorizeLogsForRun = (logs: any[]): RunLogs => {
            const result: RunLogs = {
              estimator: [],
              planner: [],
              refiner: [],
              validator: [],
              workers: new Map(),
              other: []
            };
            
            for (const u of logs) {
              const role = String(u?.role || 'unknown').toLowerCase();
              const workerIndex = Number(u?.workerIndex);
              
              if (role.includes('estimator')) {
                result.estimator.push(u);
              } else if (role.includes('planner')) {
                result.planner.push(u);
              } else if (role.includes('refiner')) {
                result.refiner.push(u);
              } else if (role.includes('validator')) {
                result.validator.push(u);
              } else if (Number.isFinite(workerIndex) && workerIndex > 0) {
                if (!result.workers.has(workerIndex)) {
                  result.workers.set(workerIndex, []);
                }
                result.workers.get(workerIndex)!.push(u);
              } else {
                result.other.push(u);
              }
            }
            return result;
          };

          // Helper to output logs for a run (or ungrouped)
          const outputRunLogs = (runLogs: RunLogs, headingLevel: string = '##', subHeadingLevel: string = '###') => {
            // Output estimator logs first (before workflow execution)
            if (runLogs.estimator.length > 0) {
              lines.push('\n---');
              lines.push(`\n${headingLevel} Estimator`);
              lines.push(`\n_${runLogs.estimator.length} API call(s)_`);
              runLogs.estimator.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
              runLogs.estimator.forEach((u, idx) => {
                lines.push(...formatLogEntry(u, idx + 1, subHeadingLevel));
              });
            }

            // Output planner logs
            if (runLogs.planner.length > 0) {
              lines.push('\n---');
              lines.push(`\n${headingLevel} Planner`);
              lines.push(`\n_${runLogs.planner.length} API call(s)_`);
              runLogs.planner.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
              runLogs.planner.forEach((u, idx) => {
                lines.push(...formatLogEntry(u, idx + 1, subHeadingLevel));
              });
            }

            // Output refiner logs
            if (runLogs.refiner.length > 0) {
              lines.push('\n---');
              lines.push(`\n${headingLevel} Refiner`);
              lines.push(`\n_${runLogs.refiner.length} API call(s)_`);
              runLogs.refiner.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
              runLogs.refiner.forEach((u, idx) => {
                lines.push(...formatLogEntry(u, idx + 1, subHeadingLevel));
              });
            }

            // Output worker logs grouped by worker number
            const sortedWorkerIds = Array.from(runLogs.workers.keys()).sort((a, b) => a - b);
            for (const workerId of sortedWorkerIds) {
              const workerUsages = runLogs.workers.get(workerId)!;
              lines.push('\n---');
              lines.push(`\n${headingLevel} Web Agent ${workerId}`);
              lines.push(`\n_${workerUsages.length} API call(s)_`);
              workerUsages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
              workerUsages.forEach((u, idx) => {
                lines.push(...formatLogEntry(u, idx + 1, subHeadingLevel));
              });
            }

            // Output validator logs
            if (runLogs.validator.length > 0) {
              lines.push('\n---');
              lines.push(`\n${headingLevel} Validator`);
              lines.push(`\n_${runLogs.validator.length} API call(s)_`);
              runLogs.validator.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
              runLogs.validator.forEach((u, idx) => {
                lines.push(...formatLogEntry(u, idx + 1, subHeadingLevel));
              });
            }

            // Output any other logs that don't fit categories
            if (runLogs.other.length > 0) {
              lines.push('\n---');
              lines.push(`\n${headingLevel} Other`);
              lines.push(`\n_${runLogs.other.length} API call(s)_`);
              runLogs.other.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
              runLogs.other.forEach((u, idx) => {
                lines.push(...formatLogEntry(u, idx + 1, subHeadingLevel));
              });
            }
          };

          // Group logs by workflow run index first
          const runIndices = new Set<number>();
          for (const u of usages) {
            const runIdx = Number(u?.workflowRunIndex || 0);
            if (runIdx > 0) runIndices.add(runIdx);
          }

          // Check if we have multiple runs
          const hasMultipleRuns = runIndices.size > 1;
          const sortedRunIndices = Array.from(runIndices).sort((a, b) => a - b);

          if (hasMultipleRuns) {
            // Multiple workflow runs - group by run first
            lines.push(`\n_${sortedRunIndices.length} workflow run(s) in this session_`);

            for (const runIdx of sortedRunIndices) {
              const runUsages = usages.filter(u => Number(u?.workflowRunIndex || 0) === runIdx);
              lines.push('\n---');
              lines.push('\n---');
              lines.push(`\n# Run ${runIdx}`);
              lines.push(`\n_${runUsages.length} API call(s) in this run_`);
              
              const runLogs = categorizeLogsForRun(runUsages);
              outputRunLogs(runLogs, '##', '###');
            }

            // Handle logs without a run index (shouldn't happen, but just in case)
            const unassignedLogs = usages.filter(u => !Number(u?.workflowRunIndex));
            if (unassignedLogs.length > 0) {
              lines.push('\n---');
              lines.push('\n---');
              lines.push('\n# Unassigned Logs');
              lines.push(`\n_${unassignedLogs.length} API call(s) without run assignment_`);
              
              const unassignedRunLogs = categorizeLogsForRun(unassignedLogs);
              outputRunLogs(unassignedRunLogs, '##', '###');
            }
          } else {
            // Single run or no run tracking - use simple grouping
            const runLogs = categorizeLogsForRun(usages);
            outputRunLogs(runLogs, '##', '###');
          }

          const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `session-log-${sessionId}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch {}
    };

    try { port.onMessage.addListener(once); } catch {}
    port.postMessage({ type: 'get_combined_session_logs', sessionId });
    timeoutId = setTimeout(() => {
      try { port.onMessage.removeListener(once); } catch {}
      console.warn('[Panel] combined_session_logs request timed out after 10s');
    }, 10000);
  } catch {}
}


