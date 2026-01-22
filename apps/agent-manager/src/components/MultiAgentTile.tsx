import { useMemo } from 'react';
import { FaRobot } from 'react-icons/fa';
import { FiTrash2 } from 'react-icons/fi';
import { StatusBadge } from './StatusBadge';
import type { AgentData, WorkerPreview } from '@src/types';

interface MultiAgentTileProps {
  agent: AgentData;
  isDarkMode: boolean;
  onClick: () => void;
  onDelete?: () => void;
}

function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatCost(cost?: number): string {
  if (cost === undefined || cost === null) return '';
  return `$${cost.toFixed(3)}`;
}

function MiniPreview({ worker, isDarkMode }: { worker: WorkerPreview; isDarkMode: boolean }) {
  return (
    <div
      className={`relative aspect-video rounded overflow-hidden ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}
      style={{ borderColor: worker.color, borderWidth: 2 }}>
      {worker.screenshot ? (
        <img src={worker.screenshot} alt={`Worker ${worker.workerIndex}`} className="w-full h-full object-cover" />
      ) : (
        <div
          className={`flex items-center justify-center h-full text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
          W{worker.workerIndex}
        </div>
      )}
    </div>
  );
}

export function MultiAgentTile({ agent, isDarkMode, onClick, onDelete }: MultiAgentTileProps) {
  const needsAttention = agent.status === 'needs_input';
  const workers = agent.workers || [];
  const isInactive = agent.status === 'completed' || agent.status === 'failed' || agent.status === 'cancelled';

  const title = useMemo(() => {
    if (agent.taskDescription?.trim()) return agent.taskDescription.trim();
    if (agent.sessionTitle?.trim()) return agent.sessionTitle.trim();
    return 'Multi-Agent Task';
  }, [agent.taskDescription, agent.sessionTitle]);

  // Determine grid layout based on worker count
  const gridCols = workers.length <= 2 ? 2 : workers.length <= 4 ? 2 : 3;

  // Time since last update: prefer preview.lastUpdated, then endTime, then startTime
  const lastUpdateTime = agent.preview?.lastUpdated || agent.endTime || agent.startTime;

  return (
    <div
      className={`group relative w-full text-left rounded-xl border overflow-hidden transition-all hover:scale-[1.02] hover:shadow-lg ${
        needsAttention ? 'attention-pulse' : ''
      } ${
        isDarkMode ? 'border-slate-700 bg-slate-800/60 hover:bg-slate-800' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}>
      <button type="button" onClick={onClick} className="w-full text-left">
        {/* Mini-grid of worker previews */}
        <div className={`p-2 ${isDarkMode ? 'bg-slate-900/50' : 'bg-gray-50'} ${isInactive ? 'opacity-50' : ''}`}>
          {workers.length > 0 ? (
            <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
              {workers.slice(0, 6).map((worker, idx) => (
                <MiniPreview key={worker.workerId || idx} worker={worker} isDarkMode={isDarkMode} />
              ))}
            </div>
          ) : (
            <div
              className={`flex items-center justify-center aspect-video rounded ${
                isDarkMode ? 'bg-slate-800 text-slate-500' : 'bg-gray-100 text-gray-400'
              }`}>
              <FaRobot className="h-8 w-8" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-1">
            <StatusBadge status={agent.status} isDarkMode={isDarkMode} />
            <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
              {formatTimeSince(lastUpdateTime)}
            </span>
          </div>
          <div className={`text-sm font-medium truncate mb-1 ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
            {title}
          </div>
          {agent.metrics?.totalCost !== undefined && (
            <div className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
              {formatCost(agent.metrics.totalCost)}
            </div>
          )}
        </div>
      </button>

      {/* Delete button */}
      {onDelete && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
          className={`absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${
            isDarkMode
              ? 'bg-slate-900/80 text-slate-400 hover:text-red-400'
              : 'bg-white/80 text-gray-400 hover:text-red-500'
          }`}
          title="Delete workflow">
          <FiTrash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
