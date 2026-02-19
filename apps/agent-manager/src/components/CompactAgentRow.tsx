import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { FiTrash2 } from 'react-icons/fi';
import { StatusBadge } from './StatusBadge';
import { TypewriterText } from './TypewriterText';
import type { AgentData } from '@src/types';

interface CompactAgentRowProps {
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

export function CompactAgentRow({ agent, isDarkMode, onClick, onDelete }: CompactAgentRowProps) {
  const [animationComplete, setAnimationComplete] = useState(false);
  const lastAnimatedTitleRef = useRef<string | null>(null);

  const title = useMemo(() => {
    if (agent.sessionTitle?.trim()) return agent.sessionTitle.trim();
    if (agent.taskDescription?.trim()) {
      const desc = agent.taskDescription.trim();
      return desc.length > 60 ? desc.substring(0, 60) + '...' : desc;
    }
    return 'New Task';
  }, [agent.sessionTitle, agent.taskDescription]);

  // Reset animation state when title changes
  useEffect(() => {
    if (lastAnimatedTitleRef.current !== null && lastAnimatedTitleRef.current !== title) {
      setAnimationComplete(false);
    }
  }, [title]);

  const handleAnimationComplete = useCallback(() => {
    setAnimationComplete(true);
    lastAnimatedTitleRef.current = title;
  }, [title]);

  // Get the last message snippet (or task description as fallback)
  const snippet = useMemo(() => {
    const text = agent.lastMessage || agent.taskDescription || '';
    if (!text) return null;
    const truncated = text.slice(0, 100);
    return truncated.length < text.length ? `${truncated}...` : truncated;
  }, [agent.lastMessage, agent.taskDescription]);

  // Time since last update: prefer preview.lastUpdated, then endTime, then startTime
  const lastUpdateTime = agent.preview?.lastUpdated || agent.endTime || agent.startTime;

  return (
    <div
      className={`group relative w-full text-left rounded-lg border p-3 transition-all hover:scale-[1.01] ${
        isDarkMode
          ? 'border-slate-700 bg-slate-800/40 hover:bg-slate-800/70'
          : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}>
      <button type="button" onClick={onClick} className="w-full text-left">
        <div className="flex items-center gap-3">
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-sm font-medium truncate ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
                <TypewriterText
                  text={title}
                  animate={agent.titleAnimating && !animationComplete}
                  onComplete={handleAnimationComplete}
                />
              </span>
              <StatusBadge status={agent.status} isDarkMode={isDarkMode} compact />
            </div>
            {snippet && (
              <p className={`text-xs truncate ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>{snippet}</p>
            )}
          </div>

          {/* Meta */}
          <div className={`flex-shrink-0 text-right text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
            <div>{formatTimeSince(lastUpdateTime)}</div>
            {agent.metrics?.totalCost !== undefined && (
              <div className="mt-0.5">{formatCost(agent.metrics.totalCost)}</div>
            )}
          </div>
        </div>
      </button>

      {/* Delete button */}
      {onDelete && (
        <button
          type="button"
          onClick={e => {
            console.log('[CompactAgentRow Debug] Delete button clicked', { sessionId: agent.sessionId });
            e.stopPropagation();
            e.preventDefault();
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
