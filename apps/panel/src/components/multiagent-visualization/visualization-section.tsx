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
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded-md p-1 ${isDarkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-gray-100 hover:bg-gray-200'}`}
            onClick={() => setShowInline(v => !v)}
            aria-label={showInline ? 'Collapse workflow visualization' : 'Expand workflow visualization'}
            title={showInline ? 'Collapse' : 'Expand'}
          >
            {showInline ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 15 12 9 18"></polyline>
              </svg>
            )}
          </button>
          <div className="text-xs">Workflow Visualization</div>
        </div>
        <button
          type="button"
          className={`text-[11px] rounded-md px-2 py-0.5 ${isDarkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-gray-100 hover:bg-gray-200'}`}
          onClick={onOpenFullScreen}
        >Open full screen</button>
      </div>
      {showInline ? (
        <WorkflowGraph graph={graph} compact laneInfo={laneInfo} />
      ) : null}
    </div>
  );
};

export default WorkflowGraphSection;


