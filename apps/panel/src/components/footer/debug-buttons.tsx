import React, { useState, useRef, useEffect } from 'react';
import { FiDownload, FiChevronUp, FiTerminal } from 'react-icons/fi';
import {
  downloadPlan,
  downloadWorkerMessages,
  downloadErrors,
  downloadCombinedSessionLogs,
} from './log-export-helpers';

interface DebugButtonsProps {
  currentSessionId: string | null;
  agentTraceRootIdRef: React.RefObject<string | null>;
  currentTaskAgentType: string | null;
  messageMetadata: any;
  portRef: React.RefObject<chrome.runtime.Port | null>;
  isDarkMode: boolean;
  setErrorLogEntries: (entries: any[]) => void;
}

export const DebugButtons: React.FC<DebugButtonsProps> = ({
  currentSessionId,
  agentTraceRootIdRef,
  currentTaskAgentType,
  messageMetadata,
  portRef,
  isDarkMode,
  setErrorLogEntries,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  if (!currentSessionId) return null;

  // Show multi-agent options if multiagent was used at any point in the session
  const hasMultiAgentInSession =
    currentTaskAgentType === 'multiagent' || !!(messageMetadata as any)?.__workflowPlanDataset;

  const handleDownload = (fn: () => void) => {
    fn();
    setMenuOpen(false);
  };

  const buttonClass = `w-full text-left flex items-center gap-2 px-3 py-1.5 text-[11px] ${
    isDarkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-gray-100 text-gray-700'
  }`;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className={`inline-flex items-center justify-center rounded-md p-1.5 transition-colors ${
          isDarkMode
            ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
        }`}
        aria-label="Debug options"
        aria-expanded={menuOpen}
        title="Debug & Export">
        <FiTerminal className="h-4 w-4" />
        <FiChevronUp size={10} className={`ml-0.5 transition-transform ${menuOpen ? '' : 'rotate-180'}`} />
      </button>

      {menuOpen && (
        <div
          className={`absolute bottom-full left-0 mb-1 min-w-[140px] rounded border shadow-lg ${
            isDarkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'
          }`}>
          {hasMultiAgentInSession && (
            <>
              <button
                type="button"
                className={buttonClass}
                onClick={() => handleDownload(() => downloadPlan(portRef.current, currentSessionId))}>
                <FiDownload size={12} /> Plan
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={() =>
                  handleDownload(() =>
                    downloadWorkerMessages(
                      portRef.current,
                      currentSessionId,
                      agentTraceRootIdRef.current,
                      messageMetadata,
                    ),
                  )
                }>
                <FiDownload size={12} /> Workers
              </button>
              <div className={`border-t ${isDarkMode ? 'border-slate-700' : 'border-gray-100'}`} />
            </>
          )}
          <button
            type="button"
            className={buttonClass}
            onClick={() => handleDownload(() => downloadCombinedSessionLogs(portRef.current, currentSessionId))}>
            <FiDownload size={12} /> Session Log
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => handleDownload(() => downloadErrors(portRef.current, currentSessionId, setErrorLogEntries))}>
            <FiDownload size={12} /> Errors
          </button>
        </div>
      )}
    </div>
  );
};
