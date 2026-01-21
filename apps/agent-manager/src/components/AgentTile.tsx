import { useMemo } from 'react';
import { FaBrain, FaSearch, FaRobot } from 'react-icons/fa';
import { StatusBadge } from './StatusBadge';
import { LivePreview } from './LivePreview';
import type { AgentData } from '@src/types';

interface AgentTileProps {
  agent: AgentData;
  isDarkMode: boolean;
  onClick: () => void;
}

const agentTypeIcons: Record<string, typeof FaBrain> = {
  chat: FaBrain,
  search: FaSearch,
  agent: FaRobot,
  multiagent: FaRobot,
};

const agentTypeLabels: Record<string, string> = {
  chat: 'Chat',
  search: 'Search',
  agent: 'Agent',
  multiagent: 'Multi-Agent',
};

function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatElapsed(startTime: number): string {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatCost(cost?: number): string {
  if (cost === undefined || cost === null) return '';
  return `$${cost.toFixed(3)}`;
}

export function AgentTile({ agent, isDarkMode, onClick }: AgentTileProps) {
  const needsAttention = agent.status === 'needs_input';
  const Icon = agentTypeIcons[agent.agentType] || FaRobot;
  const typeLabel = agentTypeLabels[agent.agentType] || 'Agent';

  const title = useMemo(() => {
    if (agent.taskDescription?.trim()) return agent.taskDescription.trim();
    if (agent.sessionTitle?.trim()) return agent.sessionTitle.trim();
    return 'Agent Task';
  }, [agent.taskDescription, agent.sessionTitle]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border overflow-hidden transition-all hover:scale-[1.02] hover:shadow-lg ${
        needsAttention ? 'attention-pulse' : ''
      } ${
        isDarkMode ? 'border-slate-700 bg-slate-800/60 hover:bg-slate-800' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}>
      {/* Preview */}
      <LivePreview
        screenshot={agent.preview?.screenshot}
        url={agent.preview?.url}
        title={agent.preview?.title}
        status={agent.status}
        isDarkMode={isDarkMode}
      />

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-1">
          <StatusBadge status={agent.status} isDarkMode={isDarkMode} />
          <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
            {agent.endTime ? formatTimeSince(agent.endTime) : formatElapsed(agent.startTime)}
          </span>
        </div>
        <div className={`text-sm font-medium truncate mb-1 ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
          {title}
        </div>
        <div className={`flex items-center gap-2 text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
          {agent.metrics?.totalCost !== undefined && <span>{formatCost(agent.metrics.totalCost)}</span>}
          {agent.metrics?.totalCost !== undefined && <span>•</span>}
          <span className="flex items-center gap-1">
            <Icon className="h-3 w-3" />
            {typeLabel}
          </span>
        </div>
      </div>
    </button>
  );
}
