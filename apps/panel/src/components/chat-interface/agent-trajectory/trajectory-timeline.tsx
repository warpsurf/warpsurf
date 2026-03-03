import { useMemo } from 'react';
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
  const label = workerItem?.agentName || (num ? `Sailor ${num}` : `Sailor ${workerId}`);
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

export default function AgentTrajectory({ traceItems, isDarkMode, workerItems }: AgentTrajectoryProps) {
  const hasWorkerIds = traceItems.some(t => t.workerId != null);

  const workerGroups = useMemo(() => {
    if (!hasWorkerIds) return null;

    const groups = new Map<string, TraceItem[]>();
    const unassigned: TraceItem[] = [];

    for (const item of traceItems) {
      if (item.workerId != null) {
        const key = String(item.workerId);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      } else {
        unassigned.push(item);
      }
    }

    if (groups.size === 0) return null;
    return { groups, unassigned };
  }, [traceItems, hasWorkerIds]);

  if (workerGroups && workerGroups.groups.size > 0) {
    const workerMap = new Map<string, WorkerItem>();
    if (workerItems) {
      for (const w of workerItems) workerMap.set(String(w.workerId), w);
    }

    const sortedKeys = Array.from(workerGroups.groups.keys()).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    const unassignedActions = flattenToActions(workerGroups.unassigned, isDarkMode);

    return (
      <div className="mt-2">
        {unassignedActions.length > 0 && (
          <div className="mb-2">
            <div className={`text-[11px] font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
              Workflow
            </div>
            <div className="ml-2 space-y-0.5">
              {unassignedActions.map(action => (
                <ActionItem key={action.id} action={action} isDarkMode={isDarkMode} showTimestamp />
              ))}
            </div>
          </div>
        )}
        {sortedKeys.map(key => (
          <WorkerSection
            key={key}
            workerId={key}
            workerItem={workerMap.get(key)}
            traceItems={workerGroups.groups.get(key)!}
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
