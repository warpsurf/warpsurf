type Status = 'not_started' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped' | 'obsolete' | undefined;

const PLAN_STATUS_MAP: Record<string, string> = {
  done: 'completed',
  current: 'running',
  skipped: 'skipped',
  pending: 'not_started',
};

export function planItemsToGraph(items: Array<{ text: string; status: string }>) {
  const nodes = items.map((item, i) => ({
    id: i + 1,
    label: item.text,
    status: PLAN_STATUS_MAP[item.status] || 'not_started',
  }));
  const edges = items.slice(0, -1).map((_, i) => ({ from: i + 1, to: i + 2 }));
  const positions: Record<number, { x: number; y: number; width?: number }> = {};
  nodes.forEach((n, i) => {
    positions[n.id] = { x: i, y: 0 };
  });
  return { nodes, edges, positions };
}

const STATUS_COLORS = {
  light: {
    not_started: { bg: '#e8eef4', text: '#5a7290', border: '#b0c4d8' },
    running: { bg: '#fef6e0', text: '#8a6914', border: '#d4a843' },
    completed: { bg: '#daf0ef', text: '#1a6b66', border: '#5bbfb6' },
    failed: { bg: '#fce4e4', text: '#9b2c2c', border: '#e88888' },
    cancelled: { bg: '#e8e3f0', text: '#5b4a7a', border: '#b0a0c8' },
    skipped: { bg: '#f0ebe0', text: '#7a6a40', border: '#c4b080' },
    obsolete: { bg: '#edecea', text: '#8a8a82', border: '#c4c2b8' },
  },
  dark: {
    not_started: { bg: '#1a2535', text: '#8da4be', border: '#2d4054' },
    running: { bg: '#3a2e10', text: '#e8c65a', border: '#a88520' },
    completed: { bg: '#0e2e2b', text: '#5ec4b8', border: '#1a7a6e' },
    failed: { bg: '#3a1515', text: '#e88888', border: '#a03030' },
    cancelled: { bg: '#261e38', text: '#b0a0c8', border: '#6a508a' },
    skipped: { bg: '#2e2a1a', text: '#c4b080', border: '#8a7a50' },
    obsolete: { bg: '#1e1e1a', text: '#7a7a70', border: '#3a3a30' },
  },
} as const;

const EDGE_COLORS = {
  light: { same: '#3d6b8e', cross: '#7a9ab5' },
  dark: { same: '#5a9ec4', cross: '#8ab4d0' },
};

function wrapLabel(text: string, maxChars: number): string[] {
  if (!text) return [''];
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + (current ? ' ' : '') + w).length <= Math.max(8, maxChars)) {
      current = current ? current + ' ' + w : w;
    } else {
      if (current) lines.push(current);
      current = w.length > maxChars ? w.slice(0, maxChars) + '…' : w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

export default function WorkflowGraph({
  graph,
  compact = false,
  laneInfo = {},
  isDarkMode = false,
}: {
  graph: any;
  compact?: boolean;
  laneInfo?: Record<number, { label: string; color?: string }>;
  isDarkMode?: boolean;
}) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return null;

  const theme = isDarkMode ? 'dark' : 'light';
  const positions = graph.positions || {};
  const scaleX = 210;
  const scaleY = compact ? 52 : 110;
  const nodeHeight = compact ? 36 : 44;
  const nodeRadius = 10;
  const fontSize = compact ? 9 : 10;
  const laneFontSize = 9;

  const rawMaxX = Math.max(0, ...Object.values(positions).map((p: any) => Number(p?.x) || 0));
  const rawMaxY = Math.max(0, ...Object.values(positions).map((p: any) => Number(p?.y) || 0));
  const maxX = Number.isFinite(rawMaxX) ? rawMaxX : 0;
  const maxY = Number.isFinite(rawMaxY) ? rawMaxY : 0;
  const hasMultipleLanes = maxY > 0;
  const marginX = hasMultipleLanes ? 120 : 20;
  const marginY = compact ? 32 : 80;
  const minHeight = compact ? (hasMultipleLanes ? 220 : 80) : 450;
  const width = Math.max(hasMultipleLanes ? 900 : 400, (maxX + 5) * scaleX + marginX);
  const height = Math.max(minHeight, (maxY + (compact ? 1.5 : 3)) * scaleY + marginY);

  const nodeWidths: Record<number, number> = {};
  for (const n of graph.nodes) {
    const p = positions[n.id] || { width: 1 };
    nodeWidths[n.id] = Math.max(150, (p.width || 1) * Math.floor(scaleX * 0.7));
  }

  const edgeColor = EDGE_COLORS[theme];
  const statusColors = STATUS_COLORS[theme];

  // Compute unique lanes
  const lanes = new Set<number>();
  Object.values(positions).forEach((p: any) => lanes.add(p?.y ?? 0));
  const sortedLanes = Array.from(lanes).sort((a, b) => a - b);

  const STATUS_LABELS: Record<string, string> = {
    not_started: 'Pending',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    skipped: 'Skipped',
    obsolete: 'Obsolete',
  };
  const activeStatuses = [
    ...new Set(
      graph.nodes.map((n: any) => {
        const raw = (n.status as string) || 'not_started';
        if (raw === 'pending' || raw === 'not_started') return 'not_started';
        if (raw === 'dispatched') return 'running';
        return raw;
      }),
    ),
  ].filter((s): s is keyof typeof statusColors => s in statusColors);

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: isDarkMode ? '#2d4054' : '#b0c4d8',
        background: isDarkMode ? '#111c28' : '#f5f8fb',
      }}>
      <div
        className="relative"
        style={{
          overflowX: 'auto',
          overflowY: compact ? 'auto' : 'visible',
          maxHeight: compact ? (hasMultipleLanes ? 260 : 100) : undefined,
          padding: '8px',
        }}>
        <svg width={width} height={height}>
          <defs>
            <marker id="arrow-same" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={edgeColor.same} opacity={0.8} />
            </marker>
            <marker id="arrow-cross" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={edgeColor.cross} opacity={0.6} />
            </marker>
          </defs>

          {/* Lane labels (hidden for single-lane graphs) */}
          {hasMultipleLanes &&
            sortedLanes.map(yVal => {
              const y = yVal * scaleY + marginY;
              const info = laneInfo[yVal] || { label: `Crew ${yVal + 1}` };
              const label = String(info.label || `Crew ${yVal + 1}`);
              return (
                <g key={`lane-${yVal}`}>
                  <rect
                    x={4}
                    y={y - 10}
                    rx={8}
                    width={Math.max(64, label.length * 5.5 + 16)}
                    height={20}
                    fill={info.color || (isDarkMode ? '#2a5a7e' : '#3d6b8e')}
                    opacity={0.9}
                  />
                  <text
                    x={4 + Math.max(64, label.length * 5.5 + 16) / 2}
                    y={y + 4}
                    textAnchor="middle"
                    fontSize={laneFontSize}
                    fill="#fff"
                    fontWeight="500">
                    {label}
                  </text>
                </g>
              );
            })}

          {/* Edges */}
          {(graph.edges || []).map((e: any, i: number) => {
            const a = positions[e.from] || { x: 0, y: 0 };
            const b = positions[e.to] || { x: 0, y: 0 };
            const fromW = nodeWidths[e.from] ?? 110;
            const x1 = (a.x || 0) * scaleX + marginX + fromW;
            const y1 = (a.y || 0) * scaleY + marginY;
            const x2 = (b.x || 0) * scaleX + marginX;
            const y2 = (b.y || 0) * scaleY + marginY;
            const isSame = a.y === b.y;
            const color = isSame ? edgeColor.same : edgeColor.cross;

            // Curved path for cross-worker edges
            if (!isSame) {
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={i}
                  d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.2}
                  strokeDasharray="4 3"
                  opacity={0.7}
                  markerEnd="url(#arrow-cross)"
                />
              );
            }
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={1.5}
                opacity={0.8}
                markerEnd="url(#arrow-same)"
              />
            );
          })}

          {/* Nodes */}
          {graph.nodes.map((n: any) => {
            const p = positions[n.id] || { x: 0, y: 0 };
            const x = (p.x || 0) * scaleX + marginX;
            const y = (p.y || 0) * scaleY + marginY;
            const w = nodeWidths[n.id];
            const rawStatus = (n.status as string) || 'not_started';
            const status: Status =
              rawStatus === 'pending' || rawStatus === 'not_started'
                ? 'not_started'
                : rawStatus === 'dispatched'
                  ? 'running'
                  : (rawStatus as Status);
            const colors = statusColors[status || 'not_started'] || statusColors['not_started'];
            const isRunning = status === 'running';
            const maxChars = Math.max(12, Math.floor((w - 16) / 4.5));
            const lines = wrapLabel(n.label || String(n.id), maxChars);

            return (
              <g key={n.id}>
                {isRunning && (
                  <rect
                    x={x - 1}
                    y={y - nodeHeight / 2 - 1}
                    width={w + 2}
                    height={nodeHeight + 2}
                    rx={nodeRadius + 1}
                    fill="none"
                    stroke={colors.border}
                    strokeWidth={1.5}
                    opacity={0.5}>
                    <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2s" repeatCount="indefinite" />
                  </rect>
                )}
                <rect
                  x={x}
                  y={y - nodeHeight / 2}
                  width={w}
                  height={nodeHeight}
                  rx={nodeRadius}
                  fill={colors.bg}
                  stroke={colors.border}
                  strokeWidth={1}
                />
                <text
                  x={x + w / 2}
                  y={y - (lines.length > 1 ? (lines.length - 1) * 4 : 0) + 1}
                  textAnchor="middle"
                  fontSize={fontSize}
                  fill={colors.text}
                  fontWeight="500">
                  {lines.map((line, idx) => (
                    <tspan key={idx} x={x + w / 2} dy={idx === 0 ? 0 : 11}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div
        className="flex items-center gap-3 px-3 py-1.5 border-t flex-wrap"
        style={{
          borderColor: isDarkMode ? '#2d4054' : '#b0c4d8',
          color: isDarkMode ? '#5a7a94' : '#7a9ab5',
          fontSize: 9,
        }}>
        {activeStatuses.map(status => (
          <span key={status} className="inline-flex items-center gap-1">
            <span
              className="rounded-sm"
              style={{ width: 7, height: 7, background: statusColors[status].border, display: 'inline-block' }}
            />
            {STATUS_LABELS[status] || status}
          </span>
        ))}
      </div>
    </div>
  );
}
