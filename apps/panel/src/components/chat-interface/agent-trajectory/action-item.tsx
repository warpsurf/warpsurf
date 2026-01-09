import type { DisplayAction } from './types';
import { formatRelativeTime, formatTime } from './utils';

interface ActionItemProps {
  action: DisplayAction;
  isDarkMode: boolean;
  showTimestamp?: boolean;
}

export default function ActionItem({ action, isDarkMode, showTimestamp = false }: ActionItemProps) {
  const failedClass = !action.success ? (isDarkMode ? 'text-red-400' : 'text-red-600') : '';

  return (
    <div className="group/action flex items-start gap-2 py-0.5">
      <span className="w-5 shrink-0 text-center" title={action.category}>
        {action.icon}
      </span>
      <div className="min-w-0 flex-1">
        <span
          className={`text-[13px] leading-tight ${failedClass || (isDarkMode ? 'text-slate-300' : 'text-gray-700')}`}>
          {action.label}
          {action.collapsed && action.collapsed > 1 && (
            <span className={`ml-1 text-[11px] ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
              (×{action.collapsed})
            </span>
          )}
        </span>
        {action.details?.primary && (
          <div
            className={`truncate text-[11px] ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}
            title={action.details.primary}>
            {action.details.primary}
          </div>
        )}
      </div>
      {showTimestamp && (
        <span
          className={`shrink-0 text-[10px] opacity-0 transition-opacity group-hover/action:opacity-100 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}
          title={formatTime(action.timestamp)}>
          {formatRelativeTime(action.timestamp)}
        </span>
      )}
    </div>
  );
}
