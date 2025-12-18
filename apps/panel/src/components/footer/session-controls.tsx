import React from 'react';
import { FiAlertOctagon } from 'react-icons/fi';
import SessionStatsBar from './session-stats-bar';
import CloseTabsButton from './close-tabs-button';

type WorkerGroup = { taskId: string; groupId?: number };

type Props = {
  isDarkMode: boolean;
  sessionStats: any;
  formatUsd: (v: number) => string;
  onClearChat: () => void;
  showCloseTabs: boolean;
  workerTabGroups: WorkerGroup[];
  sessionIdForCleanup?: string | null;
  onClosedTabs: () => void;
  children?: React.ReactNode; // allows DebugButtons and dev controls to be slotted in
  // Emergency Stop button props - visible whenever session controls are shown
  showEmergencyStop?: boolean;
  onEmergencyStop?: () => void;
};

const SessionControls: React.FC<Props> = ({
  isDarkMode,
  sessionStats,
  formatUsd,
  onClearChat,
  showCloseTabs,
  workerTabGroups,
  sessionIdForCleanup,
  onClosedTabs,
  children,
  showEmergencyStop,
  onEmergencyStop,
}) => {
  return (
    <div className={`px-3 py-2 text-xs flex items-center justify-between gap-3 ${isDarkMode ? 'bg-slate-900/60 text-slate-300 border-slate-600' : 'bg-white/80 text-gray-600 border-gray-200'} border-t backdrop-blur-sm`}>
      {/* Left side: Stats, Clear Chat, Close Tabs, Debug */}
      <div className="flex items-center gap-2">
        <SessionStatsBar
          isDarkMode={isDarkMode}
          sessionStats={sessionStats}
          formatUsd={formatUsd}
          onClearChat={onClearChat}
        />

        {(showCloseTabs || workerTabGroups.length > 0) && (
          <CloseTabsButton
            isDarkMode={isDarkMode}
            workerTabGroups={workerTabGroups}
            sessionIdForCleanup={sessionIdForCleanup}
            onCompleted={onClosedTabs}
          />
        )}

        {children}
      </div>

      {/* Right side: Emergency Stop button */}
      {showEmergencyStop && onEmergencyStop && (
        <button
          type="button"
          onClick={onEmergencyStop}
          title="Emergency Stop - Immediately terminate ALL extension activity including all workflows and API calls"
          aria-label="Emergency stop all extension activity"
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-200 ${
            isDarkMode 
              ? 'bg-red-950 text-red-300 border border-red-800 hover:bg-red-900 hover:border-red-700' 
              : 'bg-red-900 text-red-100 border border-red-700 hover:bg-red-800'
          }`}
        >
          <FiAlertOctagon className="h-3.5 w-3.5" />
          <span>Emergency Stop</span>
        </button>
      )}
    </div>
  );
};

export default SessionControls;


