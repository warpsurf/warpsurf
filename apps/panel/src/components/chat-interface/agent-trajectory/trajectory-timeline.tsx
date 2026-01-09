import { useMemo } from 'react';
import type { TraceItem } from '../types';
import { groupActionsBySite, flattenToActions } from './trajectory-parser';
import SiteGroup from './site-group';
import ActionItem from './action-item';

export interface AgentTrajectoryProps {
  traceItems: TraceItem[];
  isDarkMode: boolean;
  compactMode?: boolean;
}

export default function AgentTrajectory({ traceItems, isDarkMode }: AgentTrajectoryProps) {
  const siteGroups = useMemo(() => groupActionsBySite(traceItems, isDarkMode), [traceItems, isDarkMode]);
  const flatActions = useMemo(() => flattenToActions(traceItems, isDarkMode), [traceItems, isDarkMode]);

  // Use flat view if no meaningful site grouping (all actions on same page or no URLs)
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
        📍 Sites Visited ({siteGroups.length})
      </div>
      <div className="space-y-1">
        {siteGroups.map(group => (
          <SiteGroup key={group.id} group={group} isDarkMode={isDarkMode} defaultExpanded={true} />
        ))}
      </div>
    </div>
  );
}
