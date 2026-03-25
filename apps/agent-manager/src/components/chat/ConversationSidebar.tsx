import { useMemo, useCallback } from 'react';
import { FiPlus, FiMessageSquare } from 'react-icons/fi';
import type { AgentData } from '../../types';

interface ConversationSidebarProps {
  agents: AgentData[];
  activeSessionId: string | null;
  isDarkMode: boolean;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
}

function StatusDot({ status, className }: { status: string; className?: string }) {
  const color =
    status === 'running'
      ? 'bg-green-500'
      : status === 'paused' || status === 'needs_input'
        ? 'bg-amber-500'
        : status === 'completed'
          ? 'bg-slate-400'
          : status === 'failed' || status === 'cancelled'
            ? 'bg-red-400'
            : 'bg-slate-500';
  return <div className={`h-2 w-2 rounded-full flex-shrink-0 ${color} ${className || ''}`} />;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function ConversationSidebar({
  agents,
  activeSessionId,
  isDarkMode,
  onSelectSession,
  onNewChat,
}: ConversationSidebarProps) {
  const { active, recent, older } = useMemo(() => {
    const now = Date.now();
    const sorted = [...agents].sort((a, b) => {
      const tA = a.preview?.lastUpdated || a.endTime || a.startTime || 0;
      const tB = b.preview?.lastUpdated || b.endTime || b.startTime || 0;
      return tB - tA;
    });

    const active: AgentData[] = [];
    const recent: AgentData[] = [];
    const older: AgentData[] = [];

    for (const agent of sorted) {
      const isRunning = ['running', 'paused', 'needs_input'].includes(agent.status);
      const lastActivity = agent.preview?.lastUpdated || agent.endTime || agent.startTime || 0;
      if (isRunning) active.push(agent);
      else if (now - lastActivity < 900000)
        recent.push(agent); // 15min
      else older.push(agent);
    }
    return { active, recent, older };
  }, [agents]);

  const renderItem = useCallback(
    (agent: AgentData) => {
      const isActive = agent.sessionId === activeSessionId;
      const lastTime = agent.preview?.lastUpdated || agent.endTime || agent.startTime || 0;
      return (
        <button
          key={agent.sessionId}
          onClick={() => onSelectSession(agent.sessionId)}
          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
            isActive
              ? isDarkMode
                ? 'bg-[#262622]'
                : 'bg-[#efeee8]'
              : isDarkMode
                ? 'hover:bg-[#1e1e1c]'
                : 'hover:bg-[#f3f3ee]'
          }`}>
          <StatusDot status={agent.status} />
          <div className="flex-1 min-w-0">
            <div className={`text-xs truncate ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
              {agent.sessionTitle || agent.taskDescription?.substring(0, 40) || 'Untitled'}
            </div>
          </div>
          <span className={`text-[10px] flex-shrink-0 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
            {formatRelativeTime(lastTime)}
          </span>
        </button>
      );
    },
    [activeSessionId, isDarkMode, onSelectSession],
  );

  const sectionLabel = (label: string) => (
    <div
      className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-medium ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
      {label}
    </div>
  );

  return (
    <div
      className={`w-56 flex-shrink-0 flex flex-col h-full border-r ${
        isDarkMode ? 'border-[#2f2f29] bg-[#151513]' : 'border-[#deded7] bg-[#f9f9f7]'
      }`}>
      {/* New Chat button */}
      <div className="p-2">
        <button
          onClick={onNewChat}
          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
            isDarkMode ? 'hover:bg-[#262622] text-slate-300' : 'hover:bg-[#efeee8] text-gray-700'
          }`}>
          <FiPlus className="h-4 w-4" />
          New Chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-2 space-y-1">
        {agents.length === 0 && (
          <div
            className={`flex flex-col items-center justify-center py-8 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
            <FiMessageSquare className="h-6 w-6 mb-2 opacity-40" />
            <span className="text-xs">No conversations</span>
          </div>
        )}
        {active.length > 0 && (
          <>
            {sectionLabel('Active')}
            {active.map(renderItem)}
          </>
        )}
        {recent.length > 0 && (
          <>
            {sectionLabel('Recent')}
            {recent.map(renderItem)}
          </>
        )}
        {older.length > 0 && (
          <>
            {sectionLabel('Earlier')}
            {older.map(renderItem)}
          </>
        )}
      </div>
    </div>
  );
}
