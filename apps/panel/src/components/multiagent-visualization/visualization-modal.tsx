import { useEffect } from 'react';
import WorkflowGraph from './visualization-graph';

export default function WorkflowGraphModal({
  graph,
  laneInfo,
  isDarkMode = false,
  onClose,
}: {
  graph: any;
  laneInfo?: Record<number, { label: string; color?: string }>;
  isDarkMode?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Workflow visualization">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative z-10 w-[95vw] h-[85vh] rounded-xl overflow-hidden shadow-2xl border"
        style={{
          background: isDarkMode ? '#111c28' : '#f5f8fb',
          borderColor: isDarkMode ? '#2d4054' : '#b0c4d8',
        }}>
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b"
          style={{
            borderColor: isDarkMode ? '#2d4054' : '#b0c4d8',
            background: isDarkMode ? '#162030' : '#edf2f7',
          }}>
          <span className="text-sm font-semibold tracking-wide" style={{ color: isDarkMode ? '#8da4be' : '#3d6b8e' }}>
            {'\u2693'} Plan
          </span>
          <button
            onClick={onClose}
            className={`text-xs font-medium rounded-lg px-3 py-1.5 transition-colors ${isDarkMode ? 'bg-[#1d1d1a] hover:bg-[#252522] border border-[#2f2f29] text-slate-300' : 'bg-white hover:bg-gray-50 border border-[#deded7] text-gray-600'}`}>
            Close
          </button>
        </div>
        <div className="w-full h-[calc(100%-44px)] overflow-auto p-3">
          <WorkflowGraph graph={graph} laneInfo={laneInfo} isDarkMode={isDarkMode} />
        </div>
      </div>
    </div>
  );
}
