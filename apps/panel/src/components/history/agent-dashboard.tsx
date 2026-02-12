import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { safePostMessage } from '@extension/shared/lib/utils';
import { FiArrowLeft, FiActivity, FiCheckCircle, FiClock, FiExternalLink, FiTrash2 } from 'react-icons/fi';
import { FaRobot } from 'react-icons/fa';

interface RunningAgent {
  sessionId: string;
  sessionTitle: string;
  taskDescription: string;
  startTime: number;
  agentType: string;
  status: 'running' | 'paused';
  lastUpdate: number;
  // optional metrics
  totalCost?: number;
  totalLatencyMs?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

interface CompletedAgent {
  sessionId: string;
  sessionTitle: string;
  taskDescription: string;
  startTime: number;
  endTime: number;
  agentType: string;
  status: 'completed' | 'failed' | 'cancelled';
  cost?: number;
  tokensUsed?: number;
  latencyMs?: number;
}

interface AgentDashboardProps {
  isDarkMode: boolean;
  onBack: () => void;
  onSelectSession: (sessionId: string) => void;
  chatSessions: Array<{ id: string; title: string; createdAt: number; updatedAt: number }>;
}

export const AgentDashboard: React.FC<AgentDashboardProps> = ({
  isDarkMode,
  onBack,
  onSelectSession,
  chatSessions,
}) => {
  const [runningAgents, setRunningAgents] = useState<RunningAgent[]>([]);
  const [completedAgents, setCompletedAgents] = useState<CompletedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [bgRunningIds, setBgRunningIds] = useState<Set<string>>(new Set());
  const dashboardPortRef = useRef<chrome.runtime.Port | null>(null);

  // Load agent data from storage
  const loadAgentData = useCallback(async () => {
    try {
      setLoading(true);

      // Get running agents from storage
      const runningKey = 'agent_dashboard_running';
      const completedKey = 'agent_dashboard_completed';

      const storedRunning = await chrome.storage.local.get(runningKey);
      const storedCompleted = await chrome.storage.local.get(completedKey);

      if (storedRunning[runningKey]) {
        const list: RunningAgent[] = (storedRunning[runningKey] || []) as any[];
        list.sort((a, b) => (b.lastUpdate || b.startTime || 0) - (a.lastUpdate || a.startTime || 0));
        setRunningAgents(list);
      }

      if (storedCompleted[completedKey]) {
        // Keep only last 50 completed agents, newest first
        const completed: CompletedAgent[] = (storedCompleted[completedKey] || []) as any[];
        completed.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
        setCompletedAgents(completed.slice(0, 50));
      }
    } catch (error) {
      console.error('Failed to load agent data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data on mount and set up listener for updates
  useEffect(() => {
    loadAgentData();

    // Listen for storage changes
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.agent_dashboard_running) {
        const list: RunningAgent[] = (changes.agent_dashboard_running.newValue || []) as any[];
        list.sort((a, b) => (b.lastUpdate || b.startTime || 0) - (a.lastUpdate || a.startTime || 0));
        setRunningAgents(list);
      }
      if (changes.agent_dashboard_completed) {
        const completed: CompletedAgent[] = (changes.agent_dashboard_completed.newValue || []) as any[];
        completed.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
        setCompletedAgents(completed.slice(0, 50));
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    // Refresh every 5 seconds for running agents
    const interval = setInterval(loadAgentData, 5000);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      clearInterval(interval);
    };
  }, [loadAgentData]);

  // Connect to background dashboard port and poll for live task status to avoid stale running entries
  useEffect(() => {
    try {
      const port = chrome.runtime.connect({ name: 'dashboard' });
      dashboardPortRef.current = port;
      const requestStatus = () => {
        safePostMessage(port, { type: 'get-agents-status' });
      };
      port.onMessage.addListener(message => {
        if (message?.type === 'agents-status' && message?.data?.agents) {
          try {
            const ids = new Set<string>();
            for (const a of message.data.agents as Array<any>) {
              if (!a) continue;
              const isActive = a.status === 'running' || a.status === 'pending';
              if (!isActive) continue;
              // Prefer parentSessionId when present so multi-agent workers collapse to session id
              const key = a.parentSessionId ? String(a.parentSessionId) : a.id ? String(a.id) : null;
              if (key) ids.add(key);
            }
            setBgRunningIds(ids);
          } catch {}
        }
      });
      // Initial and periodic poll
      requestStatus();
      const poll = setInterval(requestStatus, 4000);
      return () => {
        clearInterval(poll);
        try {
          port.disconnect();
        } catch {}
        dashboardPortRef.current = null;
      };
    } catch {
      // Ignore connection errors; fallback to storage-only view
      return undefined;
    }
  }, []);

  const displayRunningAgents = useMemo(() => {
    // Remove any running agent that already exists in completed list
    const completedIds = new Set(completedAgents.map(a => String(a.sessionId)));
    let list = runningAgents.filter(a => !completedIds.has(String(a.sessionId)));
    // If we have live background running IDs, intersect with them to avoid stale entries
    // Keep Multi Agent entries even if not present in background running IDs (workers are tracked individually)
    if (bgRunningIds.size > 0) {
      list = list.filter(a => {
        // Keep Multi Agent entries even if not present in background running IDs (workers are tracked individually)
        if (a.agentType === 'Multi Agent') return true;
        return bgRunningIds.has(String(a.sessionId));
      });
    }
    return list;
  }, [runningAgents, completedAgents, bgRunningIds]);

  const formatDuration = (startTime: number, endTime?: number) => {
    const end = endTime || Date.now();
    const duration = Math.floor((end - startTime) / 1000);

    if (duration < 60) return `${duration}s`;
    if (duration < 3600) return `${Math.floor(duration / 60)}m ${duration % 60}s`;
    return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
  };

  const removeRunning = async (sessionId: string) => {
    const runningKey = 'agent_dashboard_running';
    try {
      const data = await chrome.storage.local.get(runningKey);
      const list: RunningAgent[] = (data[runningKey] || []) as any[];
      const next = list.filter(a => a.sessionId !== sessionId);
      await chrome.storage.local.set({ [runningKey]: next });
      setRunningAgents(next);
    } catch (e) {
      console.error('Failed to remove running agent', e);
    }
  };

  const removeCompleted = async (sessionId: string, startTime: number) => {
    const completedKey = 'agent_dashboard_completed';
    try {
      const data = await chrome.storage.local.get(completedKey);
      const list: CompletedAgent[] = (data[completedKey] || []) as any[];
      const next = list.filter(a => !(a.sessionId === sessionId && a.startTime === startTime));
      await chrome.storage.local.set({ [completedKey]: next });
      setCompletedAgents(next);
    } catch (e) {
      console.error('Failed to remove completed agent', e);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const deleteAllCompleted = async () => {
    const completedKey = 'agent_dashboard_completed';
    try {
      await chrome.storage.local.set({ [completedKey]: [] });
      setCompletedAgents([]);
    } catch (e) {
      console.error('Failed to delete all completed agents', e);
    }
  };

  const deleteAllRunning = async () => {
    const runningKey = 'agent_dashboard_running';
    try {
      await chrome.storage.local.set({ [runningKey]: [] });
      setRunningAgents([]);
    } catch (e) {
      console.error('Failed to delete all running agents', e);
    }
  };

  const deleteAll = async () => {
    await deleteAllCompleted();
    await deleteAllRunning();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return isDarkMode ? 'text-green-400' : 'text-green-600';
      case 'paused':
        return isDarkMode ? 'text-yellow-400' : 'text-yellow-600';
      case 'completed':
        return isDarkMode ? 'text-blue-400' : 'text-blue-600';
      case 'failed':
        return isDarkMode ? 'text-red-400' : 'text-red-600';
      case 'cancelled':
        return isDarkMode ? 'text-gray-400' : 'text-gray-600';
      default:
        return isDarkMode ? 'text-gray-400' : 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <FiActivity className="animate-pulse" />;
      case 'paused':
        return <FiClock />;
      case 'completed':
        return <FiCheckCircle />;
      default:
        return <FaRobot />;
    }
  };

  const renderMetrics = (agent: RunningAgent | CompletedAgent) => {
    const cost = (agent as any).cost ?? (agent as any).totalCost;
    const latencyMs = (agent as any).latencyMs ?? (agent as any).totalLatencyMs;
    const parts: string[] = [];
    if (typeof cost === 'number') parts.push(`$${Number(cost).toFixed(3)}`);
    if (typeof latencyMs === 'number') parts.push(`${(Number(latencyMs) / 1000).toFixed(1)}s`);
    if (parts.length === 0) return null;
    return <div className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>{parts.join(' • ')}</div>;
  };

  const formatAgentTitle = (agent: RunningAgent | CompletedAgent) => {
    const desc = (agent as any).taskDescription;
    if (typeof desc === 'string' && desc.trim().length > 0) return desc.trim();
    const fallback = (agent as any).sessionTitle;
    if (typeof fallback === 'string' && fallback.trim().length > 0) return fallback.trim();
    return 'Agent';
  };

  return (
    <div className={`flex flex-col h-full ${isDarkMode ? 'bg-slate-900 text-slate-200' : 'bg-white text-gray-800'}`}>
      {/* Header */}
      <div
        className={`flex items-center gap-3 px-4 py-3 border-b ${isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'}`}>
        <button
          onClick={onBack}
          className={`p-1.5 rounded-md transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-200'}`}
          aria-label="Back to chat">
          <FiArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FaRobot className="h-5 w-5" />
          Agent Dashboard
        </h2>
        {/* Delete all button on right side */}
        <button
          onClick={deleteAll}
          className={`p-1.5 rounded-md transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-200'}`}
          aria-label="Delete all">
          <FiTrash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div
            className={`animate-spin h-8 w-8 border-2 border-t-transparent rounded-full ${isDarkMode ? 'border-slate-400' : 'border-gray-400'}`}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Running Agents Section */}
          <div className={`border-b ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
            <div className={`px-4 py-3 ${isDarkMode ? 'bg-slate-800/30' : 'bg-gray-50/50'}`}>
              <h3 className="font-medium flex items-center gap-2">
                <FiActivity className="h-4 w-4" />
                Currently Running ({displayRunningAgents.length})
              </h3>
            </div>

            {displayRunningAgents.length === 0 ? (
              <div className={`px-4 py-8 text-center ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                No agents currently running
              </div>
            ) : (
              <div className="divide-y divide-slate-700/50">
                {displayRunningAgents.map(agent => (
                  <div
                    key={`${agent.sessionId}-${agent.startTime}`}
                    className={`px-4 py-3 ${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-gray-50'} transition-colors`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`flex items-center gap-1 ${getStatusColor(agent.status)}`}>
                            {getStatusIcon(agent.status)}
                            <span className="text-xs font-medium uppercase">{agent.status}</span>
                          </span>
                          <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                            {formatDuration(agent.startTime)}
                          </span>
                        </div>
                        <div className="font-medium mb-1 truncate">{formatAgentTitle(agent)}</div>
                        {renderMetrics(agent)}
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                          Started {formatTime(agent.startTime)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => onSelectSession(agent.sessionId)}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            isDarkMode
                              ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          }`}>
                          Go to chat
                          <FiExternalLink className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => removeRunning(agent.sessionId)}
                          className={`p-1.5 rounded-md ${isDarkMode ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-gray-100 text-gray-600'}`}
                          title="Remove from running"
                          aria-label="Remove from running">
                          <FiTrash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Completed Agents Section */}
          <div>
            <div className={`px-4 py-3 ${isDarkMode ? 'bg-slate-800/30' : 'bg-gray-50/50'}`}>
              <h3 className="font-medium flex items-center gap-2">
                <FiCheckCircle className="h-4 w-4" />
                Recently Completed ({completedAgents.length})
              </h3>
            </div>

            {completedAgents.length === 0 ? (
              <div className={`px-4 py-8 text-center ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                No completed agents yet
              </div>
            ) : (
              <div className="divide-y divide-slate-700/50">
                {completedAgents.map(agent => (
                  <div
                    key={`${agent.sessionId}-${agent.startTime}`}
                    className={`px-4 py-3 ${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-gray-50'} transition-colors`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`flex items-center gap-1 ${getStatusColor(agent.status)}`}>
                            {getStatusIcon(agent.status)}
                            <span className="text-xs font-medium uppercase">{agent.status}</span>
                          </span>
                          <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                            {formatDuration(agent.startTime, agent.endTime)}
                          </span>
                          {agent.cost !== undefined && (
                            <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                              • ${agent.cost.toFixed(3)}
                            </span>
                          )}
                        </div>
                        <div className="font-medium mb-1 truncate">{formatAgentTitle(agent)}</div>
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                          Completed {formatTime(agent.endTime)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => onSelectSession(agent.sessionId)}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            isDarkMode
                              ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          }`}>
                          Go to chat
                          <FiExternalLink className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => removeCompleted(agent.sessionId, agent.startTime)}
                          className={`p-1.5 rounded-md ${isDarkMode ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-gray-100 text-gray-600'}`}
                          title="Remove from completed"
                          aria-label="Remove from completed">
                          <FiTrash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
