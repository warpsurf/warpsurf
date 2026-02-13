import React from 'react';
import CloseTabsButton from './close-tabs-button';

type WorkerGroup = { taskId: string; groupId?: number };

type Props = {
  isDarkMode: boolean;
  showCloseTabs: boolean;
  workerTabGroups: WorkerGroup[];
  sessionIdForCleanup?: string | null;
  onClosedTabs: () => void;
};

const SessionControls: React.FC<Props> = ({
  isDarkMode,
  showCloseTabs,
  workerTabGroups,
  sessionIdForCleanup,
  onClosedTabs,
}) => {
  // Only render if there are tabs to close
  if (!showCloseTabs && workerTabGroups.length === 0) {
    return null;
  }

  return (
    <div
      className={`px-3 py-1.5 text-xs flex items-center gap-2 ${isDarkMode ? 'bg-slate-900/60 text-slate-300 border-slate-600' : 'bg-white/80 text-gray-600 border-gray-200'} border-t backdrop-blur-sm`}>
      <CloseTabsButton
        isDarkMode={isDarkMode}
        workerTabGroups={workerTabGroups}
        sessionIdForCleanup={sessionIdForCleanup}
        onCompleted={onClosedTabs}
      />
    </div>
  );
};

export default SessionControls;
