type Status = 'not_started' | 'running' | 'completed' | 'failed' | 'cancelled' | undefined;

const statusColor: Record<Exclude<Status, undefined>, string> = {
  not_started: '#9CA3AF',
  running: '#F59E0B',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#A020F0',
};

export default function WorkflowGraph({ graph, compact = false, laneInfo = {} as Record<number, { label: string; color?: string }> }: { graph: any; compact?: boolean; laneInfo?: Record<number, { label: string; color?: string }> }) {
  if (!graph || !Array.isArray(graph.nodes)) return null;
  const positions = graph.positions || {};
  const scaleX = 180;
  const scaleY = compact ? 40 : 120;
  const marginX = 140;
  const marginY = compact ? 24 : 100;
  const maxX = Math.max(0, ...Object.values(positions).map((p: any) => (p as any).x || 0));
  const maxY = Math.max(0, ...Object.values(positions).map((p: any) => (p as any).y || 0));
  const width = Math.max(1200, (maxX + 6) * scaleX + marginX);
  const height = Math.max(compact ? 180 : 520, (maxY + (compact ? 1 : 4)) * scaleY + marginY);

  const computedWidthById: Record<number, number> = {};
  for (const n of graph.nodes) {
    const p = positions[n.id] || { x: 0, y: 0, width: undefined };
    const w = Math.max(110, (p.width || 1) * Math.floor(scaleX * 0.75));
    computedWidthById[n.id] = w;
  }

  const SAME_EDGE_COLOR = '#2E86AB';
  const CROSS_EDGE_COLOR = '#A23B72';

  const wrapLabel = (text: string, maxChars: number): string[] => {
    if (!text) return [''];
    const words = String(text).split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      if ((current + (current ? ' ' : '') + w).length <= Math.max(8, maxChars)) {
        current = current ? current + ' ' + w : w;
      } else {
        if (current) lines.push(current);
        if (w.length > maxChars) {
          for (let i = 0; i < w.length; i += maxChars) {
            lines.push(w.slice(i, i + maxChars));
          }
          current = '';
        } else {
          current = w;
        }
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 8);
  };
  return (
    <div className="rounded-md border p-2 mb-2" style={{ borderColor: 'rgba(148,163,184,0.3)' }}>
      <div className="text-xs font-semibold mb-2">Workflow</div>
      <div className="relative" style={{ overflowX: 'auto', overflowY: compact ? 'auto' : 'visible', maxHeight: compact ? 180 : undefined }}>
        <svg width={width} height={height}>
          {(() => {
            const lanes = new Set<number>();
            Object.values(positions).forEach((p: any) => { const y = (p as any)?.y || 0; lanes.add(y); });
            return Array.from(lanes).sort((a, b) => a - b).map((yVal) => {
              const y = (yVal || 0) * scaleY + marginY;
              const info = laneInfo[yVal] || { label: `Web Agent ${yVal + 1}`, color: '#A78BFA' };
              const label = String(info.label || `Web Agent ${yVal + 1}`);
              const approxWidth = Math.max(72, Math.min(180, label.length * 6 + 16));
              const x = 12;
              return (
                <g key={`lane-${yVal}`}>
                  <rect x={x} y={y - 10} width={approxWidth} height={18} rx={9} fill={info.color || '#A78BFA'} opacity={0.95} />
                  <text x={x + approxWidth / 2} y={y + 4} textAnchor="middle" fontSize="9" fill="#fff">{label}</text>
                </g>
              );
            });
          })()}
          {(graph.edges || []).map((e: any, i: number) => {
            const a = positions[e.from] || { x: 0, y: 0 };
            const b = positions[e.to] || { x: 0, y: 0 };
            const fromLeftX = (a.x || 0) * scaleX + marginX;
            const fromY = (a.y || 0) * scaleY + marginY;
            const toX = (b.x || 0) * scaleX + marginX;
            const toY = (b.y || 0) * scaleY + marginY;
            const fromWidth = computedWidthById[e.from] ?? Math.max(110, Math.floor(scaleX * 0.9));
            const x1 = fromLeftX + fromWidth;
            const y1 = fromY;
            const x2 = toX;
            const y2 = toY;
            const isSameWorker = a.y === b.y;
            const color = isSameWorker ? SAME_EDGE_COLOR : CROSS_EDGE_COLOR;
            const strokeWidth = isSameWorker ? 2 : 1.5;
            const marker = isSameWorker ? 'url(#arrow-same)' : 'url(#arrow-cross)';
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth} markerEnd={marker} />;
          })}
          <defs>
            <marker id="arrow-same" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={SAME_EDGE_COLOR} />
            </marker>
            <marker id="arrow-cross" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={CROSS_EDGE_COLOR} />
            </marker>
          </defs>
          {graph.nodes.map((n: any) => {
            const p = positions[n.id] || { x: 0, y: 0 };
            const x = (p.x || 0) * scaleX + marginX;
            const y = (p.y || 0) * scaleY + marginY;
            const w = computedWidthById[n.id];
            const nodeHeight = compact ? 28 : 36;
            const color = statusColor[(n.status as Status) || 'not_started'];
            const maxCharsPerLine = Math.max(10, Math.floor((w - 18) / 4.5));
            const lines = wrapLabel(n.label || String(n.id), maxCharsPerLine).slice(0, 3);
            return (
              <g key={n.id}>
                <rect x={x} y={y - nodeHeight / 2} width={w} height={nodeHeight} rx={8} fill={color} opacity={0.95} />
                <text x={x + w / 2} y={y - (nodeHeight / 2 - 10)} textAnchor="middle" fontSize="8" fill="#fff">
                  {lines.map((line: string, idx: number) => (
                    <tspan key={idx} x={x + w / 2} dy={idx === 0 ? 0 : 9}>{line}</tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] items-center">
        <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 10, background: '#10B981', display: 'inline-block', borderRadius: 2 }} />Complete</span>
        <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 10, background: '#F59E0B', display: 'inline-block', borderRadius: 2 }} />Running</span>
        <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 10, background: '#EF4444', display: 'inline-block', borderRadius: 2 }} />Failed</span>
        <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 10, background: '#9CA3AF', display: 'inline-block', borderRadius: 2 }} />Not started</span>
        <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 10, background: '#A020F0', display: 'inline-block', borderRadius: 2 }} />Cancelled</span>
        <span className="inline-flex items-center gap-1">
          <svg width="16" height="8" viewBox="0 0 16 8"><line x1="0" y1="4" x2="16" y2="4" stroke={SAME_EDGE_COLOR} strokeWidth="2" /></svg>
          Same worker
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width="16" height="8" viewBox="0 0 16 8"><line x1="0" y1="4" x2="16" y2="4" stroke={CROSS_EDGE_COLOR} strokeWidth="1.5" /></svg>
          Cross worker
        </span>
      </div>
    </div>
  );
}


