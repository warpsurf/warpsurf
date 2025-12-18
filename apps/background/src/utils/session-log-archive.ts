import type { TokenUsage } from './token-tracker';

class SessionLogArchive {
  private archive: Map<string, TokenUsage[]> = new Map();
  private keys: Map<string, Set<string>> = new Map();

  private keyFor(u: TokenUsage): string {
    try {
      const ts = Number(u?.timestamp || 0);
      const prov = String(u?.provider || '');
      const model = String(u?.modelName || '');
      const inT = Number(u?.inputTokens || 0);
      const outT = Number(u?.outputTokens || 0);
      const totT = Number(u?.totalTokens || inT + outT);
      const cost = Number(u?.cost || 0);
      const worker = Number((u as any)?.workerIndex || 0);
      const subtask = Number((u as any)?.subtaskId || 0);
      const runIdx = Number((u as any)?.workflowRunIndex || 0);
      // Avoid including large request/response in fingerprint
      return `${ts}|${prov}|${model}|${inT}|${outT}|${totT}|${cost}|${worker}|${subtask}|${runIdx}`;
    } catch {
      return `${Date.now()}|${Math.random()}`;
    }
  }

  append(sessionId: string, usages: TokenUsage[]): void {
    const sid = String(sessionId);
    if (!sid) return;
    if (!Array.isArray(usages) || usages.length === 0) return;
    const list = this.archive.get(sid) || [];
    const seen = this.keys.get(sid) || new Set<string>();
    for (const u of usages) {
      const k = this.keyFor(u);
      if (seen.has(k)) continue;
      seen.add(k);
      list.push(u);
    }
    // Stable chronological order
    list.sort((a, b) => (Number(a?.timestamp || 0)) - (Number(b?.timestamp || 0)));
    this.archive.set(sid, list);
    this.keys.set(sid, seen);
  }

  get(sessionId: string): TokenUsage[] {
    const sid = String(sessionId);
    const list = this.archive.get(sid) || [];
    return [...list].sort((a, b) => (Number(a?.timestamp || 0)) - (Number(b?.timestamp || 0)));
  }

  clear(sessionId: string): void {
    const sid = String(sessionId);
    this.archive.delete(sid);
    this.keys.delete(sid);
  }
}

export const sessionLogArchive = new SessionLogArchive();


