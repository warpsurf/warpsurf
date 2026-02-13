import React from 'react';
import { FiX } from 'react-icons/fi';

type WorkerGroup = { taskId: string; groupId?: number };

interface CloseTabsButtonProps {
  isDarkMode: boolean;
  workerTabGroups: WorkerGroup[];
  sessionIdForCleanup?: string | null;
  onCompleted?: () => void;
}

const CloseTabsButton: React.FC<CloseTabsButtonProps> = ({
  isDarkMode,
  workerTabGroups,
  sessionIdForCleanup,
  onCompleted,
}) => {
  const handleClose = () => {
    try {
      // Close by group id when available
      const uniqueGroupIds = new Set<number>();
      const groupIdToTaskId = new Map<number, string>();
      const taskIdsWithoutGroup: string[] = [];

      for (const g of workerTabGroups) {
        if (typeof g.groupId === 'number') {
          uniqueGroupIds.add(g.groupId);
          if (!groupIdToTaskId.has(g.groupId)) groupIdToTaskId.set(g.groupId, g.taskId);
        } else if (g.taskId) {
          taskIdsWithoutGroup.push(g.taskId);
        }
      }

      for (const gid of uniqueGroupIds) {
        try {
          chrome.runtime.sendMessage({ type: 'close_task_group', groupId: gid });
        } catch {}
      }
      for (const tid of taskIdsWithoutGroup) {
        try {
          chrome.runtime.sendMessage({ type: 'close_task_tabs', taskId: tid });
        } catch {}
      }
      if (sessionIdForCleanup) {
        try {
          chrome.runtime.sendMessage({ type: 'close_all_tabs_for_session', sessionId: sessionIdForCleanup });
        } catch {}
      }
    } finally {
      try {
        onCompleted?.();
      } catch {}
    }
  };

  return (
    <button
      type="button"
      onClick={handleClose}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition-colors ${
        isDarkMode
          ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
      }`}
      aria-label="Close all agent tabs"
      title="Close all tabs opened by the agents">
      <FiX className="h-3.5 w-3.5" />
      <span>Close Tabs</span>
    </button>
  );
};

export default CloseTabsButton;
