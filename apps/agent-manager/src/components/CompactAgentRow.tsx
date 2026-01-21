import { useMemo } from 'react';
import { FaBrain, FaSearch, FaRobot } from 'react-icons/fa';
import { StatusBadge } from './StatusBadge';
import type { AgentData } from '@src/types';

interface CompactAgentRowProps {
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

export function CompactAgentRow({ agent, isDarkMode, onClick }: CompactAgentRowProps) {
  const Icon = agentTypeIcons[agent.agentType] || FaRobot;

  const title = useMemo(() => {
    if (agent.taskDescription?.trim()) return agent.taskDescription.trim();
    if (agent.sessionTitle?.trim()) return agent.sessionTitle.trim();
    return 'Agent Task';
  }, [agent.taskDescription, agent.sessionTitle]);

  // Get the last message snippet (or task description as fallback)
  const snippet = useMemo(() => {
    const text = agent.lastMessage || agent.taskDescription || '';
    if (!text) return null;
    const truncated = text.slice(0, 100);
    return truncated.length < text.length ? `${truncated}...` : truncated;
  }, [agent.lastMessage, agent.taskDescription]);

  const timeDisplay = agent.endTime ? formatTimeSince(agent.endTime) : formatTimeSince(agent.startTime);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-all hover:scale-[1.01] ${
        isDarkMode
          ? 'border-slate-700 bg-slate-800/40 hover:bg-slate-800/70'
          : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}>
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className={`flex-shrink-0 p-2 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-gray-100'}`}>
          {agent.agentType === 'multiagent' ? (
            <div className="relative">
              <FaRobot className="h-4 w-4" />
              <FaRobot className="h-4 w-4 absolute -right-1 -bottom-1 opacity-60" />
            </div>
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-sm font-medium truncate ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
              {title}
            </span>
            <StatusBadge status={agent.status} isDarkMode={isDarkMode} compact />
          </div>
          {snippet && (
            <p className={`text-xs truncate ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>{snippet}</p>
          )}
        </div>

        {/* Meta */}
        <div className={`flex-shrink-0 text-right text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
          <div>{timeDisplay}</div>
          {agent.metrics?.totalCost !== undefined && (
            <div className="mt-0.5">{formatCost(agent.metrics.totalCost)}</div>
          )}
        </div>
      </div>
    </button>
  );
}
