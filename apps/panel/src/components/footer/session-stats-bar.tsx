import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiBarChart2 } from 'react-icons/fi';

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
}

const SessionStatsBar: React.FC<SessionStatsBarProps> = ({ isDarkMode, sessionStats, formatUsd }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const totalTokens = sessionStats.totalInputTokens + sessionStats.totalOutputTokens;
  const avgLatency = (sessionStats.avgLatencyPerRequest / 1000).toFixed(1);

  useEffect(() => {
    if (showTooltip && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipPosition({
        top: rect.top - 8, // Position above the button with some margin
        left: rect.left,
      });
    }
  }, [showTooltip]);

  const tooltipContent = showTooltip && (
    <div
      style={{
        position: 'fixed',
        top: tooltipPosition.top,
        left: tooltipPosition.left,
        transform: 'translateY(-100%)',
      }}
      className={`min-w-[160px] rounded-md border px-3 py-2 text-xs shadow-lg z-[9999] pointer-events-none ${
        isDarkMode ? 'bg-slate-800 border-slate-600 text-slate-200' : 'bg-white border-gray-200 text-gray-700'
      }`}>
      <div className="font-medium mb-1.5">Session Stats</div>
      <div className="space-y-1">
        <div className="flex justify-between gap-3">
          <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Cost:</span>
          <span className="font-medium">{formatUsd(sessionStats.totalCost)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Tokens:</span>
          <span className="font-medium">{totalTokens.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Avg latency:</span>
          <span className="font-medium">{avgLatency}s</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Requests:</span>
          <span className="font-medium">{sessionStats.totalRequests}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative" onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
      <button
        ref={buttonRef}
        type="button"
        className={`inline-flex items-center justify-center rounded-md p-1.5 transition-colors ${
          isDarkMode
            ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
        }`}
        aria-label="Session statistics">
        <FiBarChart2 className="h-4 w-4" />
      </button>

      {showTooltip && createPortal(tooltipContent, document.body)}
    </div>
  );
};

export default SessionStatsBar;
