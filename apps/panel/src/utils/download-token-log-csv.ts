export type TokenLogEntry = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  thoughtTokens?: number;
  provider?: string;
  modelName?: string;
  timestamp?: number;
  cost?: number;
};

export function downloadTokenLogCsv(entries: TokenLogEntry[], sessionId?: string | null) {
  try {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const headers = [
      'Input Tokens',
      'Output Tokens',
      'Total Tokens',
      'Thought Tokens',
      'Provider',
      'Model',
      'Timestamp',
      'Cost',
    ];
    const rows = entries.map(entry => [
      (entry.inputTokens ?? 0).toString(),
      (entry.outputTokens ?? 0).toString(),
      (entry.totalTokens ?? 0).toString(),
      (entry.thoughtTokens ?? 0).toString(),
      entry.provider ?? '',
      entry.modelName ?? '',
      entry.timestamp ? new Date(entry.timestamp).toISOString() : '',
      (entry.cost ?? 0).toString(),
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeId = sessionId ? String(sessionId) : 'session';
    a.download = `token-log-${safeId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {}
}


