import React from 'react';

interface SessionStats {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatency: number;
  totalCost: number;
  avgLatencyPerRequest: number;
}

interface SessionStatsBarProps {
  isDarkMode: boolean;
  sessionStats: SessionStats;
  formatUsd: (cost: number) => string;
  onClearChat: () => void;
}

const SessionStatsBar: React.FC<SessionStatsBarProps> = ({ isDarkMode, sessionStats, formatUsd, onClearChat }) => {
  return (
    <>
      <div className={`rounded-full border px-2 py-1 text-[11px] inline-block ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}`}>
        {`${formatUsd(sessionStats.totalCost)} • ${(sessionStats.totalInputTokens + sessionStats.totalOutputTokens).toLocaleString()} tokens • ${(sessionStats.avgLatencyPerRequest / 1000).toFixed(1)}s avg`}
      </div>
      <button
        type="button"
        onClick={onClearChat}
        className={`rounded border px-2 py-1 text-[11px] ${isDarkMode ? 'border-slate-600 hover:bg-slate-800 text-slate-300' : 'border-gray-300 hover:bg-gray-100 text-gray-700'}`}
        aria-label="Clear chat"
      >
        Clear Chat
      </button>
    </>
  );
};

export default SessionStatsBar;


