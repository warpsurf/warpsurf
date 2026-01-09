import { useState } from 'react';
import type { SiteGroup as SiteGroupType } from './types';
import { formatTime } from './utils';
import ActionItem from './action-item';

interface SiteGroupProps {
  group: SiteGroupType;
  isDarkMode: boolean;
  defaultExpanded?: boolean;
}

export default function SiteGroup({ group, isDarkMode, defaultExpanded = true }: SiteGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasActions = group.actions.length > 0;

  return (
    <div className="mb-2">
      {/* Site header */}
      <button
        type="button"
        onClick={() => hasActions && setExpanded(!expanded)}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
          isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-gray-100/70'
        } ${hasActions ? 'cursor-pointer' : 'cursor-default'}`}>
        {/* Favicon */}
        {group.favicon ? (
          <img
            src={group.favicon}
            alt=""
            className="size-4 shrink-0 rounded-sm"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span className="size-4 shrink-0 text-center">🌐</span>
        )}

        {/* Domain */}
        <span
          className={`min-w-0 flex-1 truncate text-[13px] font-medium ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
          {group.domain || 'Page'}
        </span>

        {/* Timestamp */}
        <span className={`shrink-0 text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
          {formatTime(group.firstTimestamp)}
        </span>

        {/* Expand/collapse indicator */}
        {hasActions && (
          <svg
            className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''} ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>

      {/* Actions list */}
      {expanded && hasActions && (
        <div className={`ml-6 border-l pl-2 ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
          {group.actions.map(action => (
            <ActionItem key={action.id} action={action} isDarkMode={isDarkMode} showTimestamp />
          ))}
        </div>
      )}
    </div>
  );
}
