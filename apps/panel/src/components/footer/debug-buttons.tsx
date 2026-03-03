import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiDownload, FiChevronUp, FiTerminal } from 'react-icons/fi';
import {
  downloadCommodoreLogs,
  downloadQuartermasterLogs,
  downloadCaptainLogs,
  downloadSailorLogs,
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
  agentTraceRootIdRef: _agentTraceRootIdRef,
  currentTaskAgentType,
  messageMetadata,
  portRef,
  isDarkMode,
  setErrorLogEntries,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.top, left: rect.left });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    updatePosition();
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [menuOpen, updatePosition]);

  if (!currentSessionId) return null;

  const hasMultiAgentInSession =
    currentTaskAgentType === 'multiagent' || !!(messageMetadata as any)?.__workflowPlanDataset;

  const handleDownload = (fn: () => void) => {
    fn();
    setMenuOpen(false);
  };

  const buttonClass = `w-full text-left flex items-center gap-2 px-3 py-1.5 text-[11px] ${
    isDarkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-gray-100 text-gray-700'
  }`;

  const dividerClass = `border-t ${isDarkMode ? 'border-slate-700' : 'border-gray-100'}`;

  const menu =
    menuOpen && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', bottom: window.innerHeight - menuPos.top + 4, left: menuPos.left }}
            className={`z-[9999] min-w-[160px] rounded border shadow-lg ${
              isDarkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'
            }`}>
            {hasMultiAgentInSession && (
              <>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => handleDownload(() => downloadCommodoreLogs(portRef.current, currentSessionId))}>
                  <FiDownload size={12} /> Commodore
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => handleDownload(() => downloadQuartermasterLogs(currentSessionId, messageMetadata))}>
                  <FiDownload size={12} /> Quartermaster
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => handleDownload(() => downloadCaptainLogs(portRef.current, currentSessionId))}>
                  <FiDownload size={12} /> Captain
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => handleDownload(() => downloadSailorLogs(portRef.current, currentSessionId))}>
                  <FiDownload size={12} /> Sailors
                </button>
                <div className={dividerClass} />
              </>
            )}
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                handleDownload(() => downloadCombinedSessionLogs(portRef.current, currentSessionId, messageMetadata))
              }>
              <FiDownload size={12} /> Session Log
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                handleDownload(() => downloadErrors(portRef.current, currentSessionId, setErrorLogEntries))
              }>
              <FiDownload size={12} /> Debug
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
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
      {menu}
    </div>
  );
};
