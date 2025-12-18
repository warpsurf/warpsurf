import { useEffect } from 'react';
import WorkflowGraph from './visualization-graph';

export default function WorkflowGraphModal({ graph, laneInfo, onClose }: { graph: any; laneInfo?: Record<number, { label: string; color?: string }>; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Workflow visualization">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Content */}
      <div className="relative z-10 w-[95vw] h-[85vh] rounded-lg overflow-hidden shadow-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-slate-700">
          <div className="text-sm font-semibold">Workflow (Full screen)</div>
          <button onClick={onClose} className="text-xs rounded-md px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700">Close</button>
        </div>
        <div className="w-full h-full overflow-auto p-2">
          <WorkflowGraph graph={graph} laneInfo={laneInfo} />
        </div>
      </div>
    </div>
  );
}


