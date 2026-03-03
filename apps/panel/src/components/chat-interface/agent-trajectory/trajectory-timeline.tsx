import { useMemo } from 'react';
import { FaAnchor, FaCompass, FaClipboardList } from 'react-icons/fa';
import type { TraceItem, WorkerItem } from '../types';
import { groupActionsBySite, flattenToActions } from './trajectory-parser';
import SiteGroup from './site-group';
import ActionItem from './action-item';

export interface AgentTrajectoryProps {
  traceItems: TraceItem[];
  isDarkMode: boolean;
  compactMode?: boolean;
  workerItems?: WorkerItem[];
}

function WorkerSection({
  workerId,
  workerItem,
  traceItems,
  isDarkMode,
}: {
  workerId: string;
  workerItem?: WorkerItem;
  traceItems: TraceItem[];
  isDarkMode: boolean;
}) {
  const siteGroups = useMemo(() => groupActionsBySite(traceItems, isDarkMode), [traceItems, isDarkMode]);
  const flatActions = useMemo(() => flattenToActions(traceItems, isDarkMode), [traceItems, isDarkMode]);
  const useFlatView = siteGroups.length <= 1 || siteGroups.every(g => !g.url || g.url === 'Starting page');

  if (flatActions.length === 0) return null;

  const num = workerId.replace(/\D/g, '') || '';
  const label = workerItem?.agentName || (num ? `Crew ${num}` : `Crew ${workerId}`);
  const color = workerItem?.color;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] shrink-0"
          style={{
            backgroundColor: color || (isDarkMode ? '#334155' : '#94a3b8'),
            color: '#fff',
          }}>
          {num || '•'}
        </span>
        <span
          className={`text-[11px] font-medium ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}
          style={color ? { color } : undefined}>
          {label}
        </span>
      </div>
      {useFlatView ? (
        <div className="ml-6 space-y-0.5">
          {flatActions.map(action => (
            <ActionItem key={action.id} action={action} isDarkMode={isDarkMode} showTimestamp />
          ))}
        </div>
      ) : (
        <div className="ml-6 space-y-1">
          {siteGroups.map(group => (
            <SiteGroup key={group.id} group={group} isDarkMode={isDarkMode} defaultExpanded={true} />
          ))}
        </div>
      )}
    </div>
  );
}

function RoleSection({
  items,
  isDarkMode,
  label,
  icon,
  bgColor,
  textColor,
  keyPrefix,
}: {
  items: TraceItem[];
  isDarkMode: boolean;
  label: string;
  icon: React.ReactNode;
  bgColor: { dark: string; light: string };
  textColor: { dark: string; light: string };
  keyPrefix: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 mb-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full"
          style={{ backgroundColor: isDarkMode ? bgColor.dark : bgColor.light }}>
          {icon}
        </span>
        <span className={`text-[11px] font-medium ${isDarkMode ? textColor.dark : textColor.light}`}>{label}</span>
      </div>
      <div className="ml-6 space-y-1">
        {items.map((item, i) => (
          <div key={`${keyPrefix}-${item.timestamp}-${i}`} className="flex items-start gap-2 text-[11px]">
            <span className={`shrink-0 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
              {new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            <span className={isDarkMode ? 'text-slate-300' : 'text-gray-600'}>{item.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommodoreSection({ items, isDarkMode }: { items: TraceItem[]; isDarkMode: boolean }) {
  return (
    <RoleSection
      items={items}
      isDarkMode={isDarkMode}
      label="Commodore"
      icon={<FaAnchor className="h-2 w-2 text-white" />}
      bgColor={{ dark: '#1e40af', light: '#3b82f6' }}
      textColor={{ dark: 'text-blue-400', light: 'text-blue-700' }}
      keyPrefix="commodore"
    />
  );
}

function CaptainSection({ items, isDarkMode }: { items: TraceItem[]; isDarkMode: boolean }) {
  return (
    <RoleSection
      items={items}
      isDarkMode={isDarkMode}
      label="Captain"
      icon={<FaCompass className="h-2 w-2 text-white" />}
      bgColor={{ dark: '#d97706', light: '#f59e0b' }}
      textColor={{ dark: 'text-amber-400', light: 'text-amber-700' }}
      keyPrefix="captain"
    />
  );
}

function QuartermasterSection({ items, isDarkMode }: { items: TraceItem[]; isDarkMode: boolean }) {
  return (
    <RoleSection
      items={items}
      isDarkMode={isDarkMode}
      label="Quartermaster"
      icon={<FaClipboardList className="h-2 w-2 text-white" />}
      bgColor={{ dark: '#0369a1', light: '#38bdf8' }}
      textColor={{ dark: 'text-sky-400', light: 'text-sky-700' }}
      keyPrefix="quartermaster"
    />
  );
}

export default function AgentTrajectory({ traceItems, isDarkMode, workerItems }: AgentTrajectoryProps) {
  const { commodoreItems, captainItems, quartermasterItems, workerGroups, unassigned } = useMemo(() => {
    const commodore: TraceItem[] = [];
    const captain: TraceItem[] = [];
    const qm: TraceItem[] = [];
    const workers = new Map<string, TraceItem[]>();
    const other: TraceItem[] = [];

    for (const item of traceItems) {
      if (item.actor === 'planner' || item.actor === 'commodore') {
        commodore.push(item);
      } else if (item.actor === 'captain') {
        captain.push(item);
      } else if (item.actor === 'quartermaster') {
        qm.push(item);
      } else if (item.workerId != null) {
        const key = String(item.workerId);
        if (!workers.has(key)) workers.set(key, []);
        workers.get(key)!.push(item);
      } else {
        other.push(item);
      }
    }

    return {
      commodoreItems: commodore,
      captainItems: captain,
      quartermasterItems: qm,
      workerGroups: workers.size > 0 ? workers : null,
      unassigned: other,
    };
  }, [traceItems]);

  const hasRoleSections =
    (workerGroups && workerGroups.size > 0) ||
    captainItems.length > 0 ||
    commodoreItems.length > 0 ||
    quartermasterItems.length > 0;

  if (hasRoleSections) {
    const workerMap = new Map<string, WorkerItem>();
    if (workerItems) {
      for (const w of workerItems) workerMap.set(String(w.workerId), w);
    }

    const sortedKeys = workerGroups
      ? Array.from(workerGroups.keys()).sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, '')) || 0;
          const numB = parseInt(b.replace(/\D/g, '')) || 0;
          return numA - numB;
        })
      : [];

    const PHASE_RE =
      /^(creating plan|processing plan|refining plan|cancelling workflow|commodore planning|plan created|quartermaster assigning|\d+\s+(?:workers?|crew)\s+(executing plan|deployed))\b/i;
    const nonPhaseMessages = unassigned.filter(item => !PHASE_RE.test(item.content || ''));
    const unassignedActions = flattenToActions(nonPhaseMessages, isDarkMode);

    return (
      <div className="mt-2">
        {unassignedActions.length > 0 && (
          <div className="mb-2">
            <div className="ml-2 space-y-0.5">
              {unassignedActions.map(action => (
                <ActionItem key={action.id} action={action} isDarkMode={isDarkMode} showTimestamp />
              ))}
            </div>
          </div>
        )}
        <CommodoreSection items={commodoreItems} isDarkMode={isDarkMode} />
        <QuartermasterSection items={quartermasterItems} isDarkMode={isDarkMode} />
        <CaptainSection items={captainItems} isDarkMode={isDarkMode} />
        {sortedKeys.map(key => (
          <WorkerSection
            key={key}
            workerId={key}
            workerItem={workerMap.get(key)}
            traceItems={workerGroups!.get(key)!}
            isDarkMode={isDarkMode}
          />
        ))}
      </div>
    );
  }

  const siteGroups = groupActionsBySite(traceItems, isDarkMode);
  const flatActions = flattenToActions(traceItems, isDarkMode);
  const useFlatView = siteGroups.length <= 1 || siteGroups.every(g => !g.url || g.url === 'Starting page');

  if (flatActions.length === 0) {
    return <div className={`text-[12px] ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>No actions recorded</div>;
  }

  if (useFlatView) {
    return (
      <div className="mt-2 space-y-0.5">
        {flatActions.map(action => (
          <ActionItem key={action.id} action={action} isDarkMode={isDarkMode} showTimestamp />
        ))}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className={`mb-2 text-[11px] font-medium ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
        Sites Visited ({siteGroups.length})
      </div>
      <div className="space-y-1">
        {siteGroups.map(group => (
          <SiteGroup key={group.id} group={group} isDarkMode={isDarkMode} defaultExpanded={true} />
        ))}
      </div>
    </div>
  );
}
