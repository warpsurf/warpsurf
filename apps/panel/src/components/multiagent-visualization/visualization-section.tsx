import React from 'react';
import WorkflowGraph from './visualization-graph';

type Props = {
  isDarkMode: boolean;
  graph: any | null;
  laneInfo: any;
  showInline: boolean;
  setShowInline: (v: boolean | ((prev: boolean) => boolean)) => void;
  onOpenFullScreen: () => void;
};

const WorkflowGraphSection: React.FC<Props> = ({
  isDarkMode,
  graph,
  laneInfo,
  showInline,
  setShowInline,
  onOpenFullScreen,
}) => {
  if (!graph) return null;
  return (
    <div className="px-2 pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded-lg p-1 transition-colors ${isDarkMode ? 'bg-[#1d1d1a] hover:bg-[#252522] border border-[#2f2f29]' : 'bg-[#f7f7f5] hover:bg-[#ededeb] border border-[#deded7]'}`}
            onClick={() => setShowInline(v => !v)}
            aria-label={showInline ? 'Collapse workflow' : 'Expand workflow'}
            title={showInline ? 'Collapse' : 'Expand'}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round">
              {showInline ? <polyline points="6 9 12 15 18 9" /> : <polyline points="9 6 15 12 9 18" />}
            </svg>
          </button>
          <span className="text-xs font-medium" style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}>
            Plan
          </span>
        </div>
        <button
          type="button"
          className={`text-[10px] font-medium rounded-lg px-2.5 py-1 transition-colors ${isDarkMode ? 'bg-[#1d1d1a] hover:bg-[#252522] border border-[#2f2f29] text-slate-300' : 'bg-[#f7f7f5] hover:bg-[#ededeb] border border-[#deded7] text-gray-600'}`}
          onClick={onOpenFullScreen}>
          Full screen
        </button>
      </div>
      {showInline && <WorkflowGraph graph={graph} compact laneInfo={laneInfo} isDarkMode={isDarkMode} />}
    </div>
  );
};

export default WorkflowGraphSection;
