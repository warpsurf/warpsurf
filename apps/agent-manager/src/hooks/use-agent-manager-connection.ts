import { useState, useEffect, useRef, useCallback } from 'react';
import { warningsSettingsStore } from '@extension/storage';
import type { AgentData, PreviewData } from '@src/types';

interface UseAgentManagerConnectionResult {
  agents: AgentData[];
  isConnected: boolean;
  sendNewTask: (task: string, agentType?: string, contextTabIds?: number[]) => Promise<void>;
  openSidepanelToSession: (sessionId: string) => void;
}

export function useAgentManagerConnection(): UseAgentManagerConnectionResult {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    try {
      const port = chrome.runtime.connect({ name: 'agent-manager' });
      portRef.current = port;
      setIsConnected(true);

      port.onMessage.addListener((message: any) => {
        const type = message?.type;

        if (type === 'agents-data') {
          const data = message.data?.agents || [];
          setAgents(data);
        }

        // Handle refresh request (e.g., after killswitch)
        if (type === 'refresh-required') {
          port.postMessage({ type: 'get-agents' });
        }

        if (type === 'previews-update') {
          // Update previews for existing agents - only for agents that are actively running
          const previews = message.data || [];
          setAgents(prev =>
            prev.map(agent => {
              // Only update previews for running agents to avoid showing running preview in completed agents
              const isRunning = ['running', 'paused', 'needs_input'].includes(agent.status);
              if (!isRunning) {
                return agent; // Don't update preview for completed/failed/cancelled agents
              }

              // Find matching preview for this agent - only match on explicit sessionId
              const preview = previews.find(
                (p: any) => p.sessionId && agent.sessionId && p.sessionId === agent.sessionId,
              );
              if (preview) {
                if (agent.agentType === 'multiagent' && agent.workers) {
                  // Update worker previews
                  const updatedWorkers = agent.workers.map(worker => {
                    const workerPreview = previews.find(
                      (p: any) => p.agentId === worker.workerId || p.tabId === worker.tabId,
                    );
                    return workerPreview
                      ? {
                          ...worker,
                          screenshot: workerPreview.screenshot,
                          url: workerPreview.url,
                          title: workerPreview.title,
                        }
                      : worker;
                  });
                  return { ...agent, workers: updatedWorkers };
                }
                return {
                  ...agent,
                  preview: {
                    tabId: preview.tabId,
                    url: preview.url,
                    title: preview.title,
                    screenshot: preview.screenshot,
                    lastUpdated: preview.lastUpdated,
                  } as PreviewData,
                };
              }
              return agent;
            }),
          );
        }
      });

      port.onDisconnect.addListener(() => {
        setIsConnected(false);
        portRef.current = null;
        // Attempt reconnect after a delay
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 2000);
      });

      // Request initial data
      port.postMessage({ type: 'get-agents' });
    } catch (e) {
      setIsConnected(false);
      // Retry connection
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 2000);
    }
  }, []);

  useEffect(() => {
    connect();

    // Also listen for storage changes to catch completed agents
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.agent_dashboard_running || changes.agent_dashboard_completed) {
        // Request fresh data
        portRef.current?.postMessage({ type: 'get-agents' });
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      portRef.current?.disconnect();
    };
  }, [connect]);

  const sendNewTask = useCallback(async (task: string, agentType?: string, contextTabIds?: number[]) => {
    // Check if per-chat warnings are enabled
    let warningsEnabled = false;
    try {
      const settings = await warningsSettingsStore.getWarnings();
      warningsEnabled = !settings.disablePerChatWarnings;
    } catch {}

    if (warningsEnabled) {
      // Route through side panel to show disclaimer first
      await chrome.storage.session.set({
        pendingAction: {
          prompt: task,
          autoStart: true,
          workflowType: agentType || 'agent',
          contextTabIds,
          forceNewSession: true,
          requireWarningCheck: true, // Flag to show disclaimer before executing
        },
      });
      // Open side panel to process the pending action
      try {
        const currentWindow = await chrome.windows.getCurrent();
        if (currentWindow?.id) {
          await chrome.sidePanel.open({ windowId: currentWindow.id });
        }
      } catch {}
    } else {
      // Warnings disabled - send directly to background
      if (!portRef.current) return;
      portRef.current.postMessage({ type: 'start-new-task', task, agentType, contextTabIds });
    }
  }, []);

  const openSidepanelToSession = useCallback(async (sessionId: string) => {
    // Pre-warm: notify background to persist trajectory data immediately
    if (portRef.current) {
      portRef.current.postMessage({ type: 'prewarm-session', sessionId });
    }

    // Store target session for sidepanel to navigate to
    await chrome.storage.local.set({
      pending_sidepanel_session: sessionId,
      pending_sidepanel_timestamp: Date.now(),
    });

    // Open sidepanel directly (requires user gesture context)
    try {
      const currentWindow = await chrome.windows.getCurrent();
      if (currentWindow?.id) {
        await chrome.sidePanel.open({ windowId: currentWindow.id });
      }
    } catch (e) {
      // Fallback: try via background if direct open fails
      if (portRef.current) {
        portRef.current.postMessage({ type: 'open-sidepanel-to-session', sessionId });
      }
    }
  }, []);

  return {
    agents,
    isConnected,
    sendNewTask,
    openSidepanelToSession,
  };
}
