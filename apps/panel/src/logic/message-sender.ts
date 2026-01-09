/* eslint-disable @typescript-eslint/no-explicit-any */
import { Actors, chatHistoryStore, generalSettingsStore } from '@extension/storage';

export type MessageSenderDeps = {
  logger: any;
  ensurePerChatBeforeNewSession: (isFollowUpMode: boolean, hasSession: boolean) => Promise<void>;
  isFollowUpMode: () => boolean;
  isHistoricalSession: () => boolean;
  incognitoMode: () => boolean;
  sessionIdRef: React.MutableRefObject<string | null>;
  setCurrentSessionId: (id: string | null) => void;
  setInputEnabled: (v: boolean) => void;
  setShowStopButton: (v: boolean) => void;
  appendMessage: (msg: any, sessionId?: string | null) => void;
  lastUserPromptRef: React.MutableRefObject<string | null>;
  setupConnection: () => void;
  stopConnection: () => void;
  portRef: React.MutableRefObject<chrome.runtime.Port | null>;
  sendMessage: (payload: any) => any;
  setCurrentTaskAgentType: (t: string | null) => void;
  chatSessions: Array<{ id: string; title: string }>;
  loadChatSessions: () => Promise<void>;
  showToast?: (t: string) => void;
  createTaskId: () => string;
  resetRunState?: () => void;
};

export function createMessageSender(deps: MessageSenderDeps) {
  const {
    logger,
    ensurePerChatBeforeNewSession,
    isFollowUpMode,
    isHistoricalSession,
    incognitoMode,
    sessionIdRef,
    setCurrentSessionId,
    setInputEnabled,
    setShowStopButton,
    appendMessage,
    lastUserPromptRef,
    setupConnection,
    stopConnection,
    portRef,
    sendMessage,
    setCurrentTaskAgentType,
    chatSessions,
    loadChatSessions,
    createTaskId,
  } = deps;

  async function handleReplay(historySessionId: string): Promise<void> {
    try {
      try {
        deps.resetRunState?.();
      } catch {}
      if (isHistoricalSession()) {
        // historical session gate is not the same as replay enabled; leave behavior to panel UX
      }
      const historyData = await chatHistoryStore.loadAgentStepHistory(historySessionId);
      if (!historyData) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: `No action history found for session "${historySessionId.substring(0, 20)}...". This session may not contain replayable actions. \n\nIt's a replay session itself (replay sessions cannot be replayed again), or it was created before the replay feature was available.`,
          timestamp: Date.now(),
        });
        return;
      }

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) throw new Error('No active tab found');

      const newTaskId = createTaskId();
      sessionIdRef.current = newTaskId;
      setCurrentSessionId(newTaskId);

      setInputEnabled(false);
      setShowStopButton(true);

      const userMessage = { actor: Actors.USER, content: `/replay ${historySessionId}`, timestamp: Date.now() };
      appendMessage(userMessage, sessionIdRef.current);

      if (!portRef.current) {
        setupConnection();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!portRef.current || portRef.current.name !== 'side-panel-connection') {
        throw new Error('Connection not ready. Please try again.');
      }

      portRef.current.postMessage({
        type: 'replay',
        taskId: newTaskId,
        tabId,
        historySessionId,
        task: historyData.task,
      });

      appendMessage({
        actor: Actors.SYSTEM,
        content: `Starting replay of task:\n\n"${historyData.task}"`,
        timestamp: Date.now(),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      appendMessage({ actor: Actors.SYSTEM, content: `Replay failed: ${errorMessage}`, timestamp: Date.now() });
    }
  }

  async function handleCommand(command: string): Promise<boolean> {
    try {
      if (!portRef.current) {
        setupConnection();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!portRef.current || portRef.current.name !== 'side-panel-connection') {
        throw new Error('Connection not ready. Please try again.');
      }

      if (command.startsWith('/replay ')) {
        const parts = command.split(' ').filter(p => p.trim() !== '');
        if (parts.length !== 2) {
          appendMessage({
            actor: Actors.SYSTEM,
            content: 'Invalid replay command format. Usage: /replay <historySessionId>',
            timestamp: Date.now(),
          });
          return true;
        }
        await handleReplay(parts[1]);
        return true;
      }

      appendMessage({ actor: Actors.SYSTEM, content: `Unsupported command: ${command}.`, timestamp: Date.now() });
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Command error', errorMessage);
      appendMessage({ actor: Actors.SYSTEM, content: errorMessage, timestamp: Date.now() });
      return true;
    }
  }

  return async function handleSendMessage(text: string, agentType?: string, contextTabIds?: number[]) {
    logger.log('handleSendMessage', text, agentType, contextTabIds);
    const trimmedText = text.trim();
    if (!trimmedText) return;

    // Ensure per-run UI state is reset so each run gets a fresh root message and trace
    try {
      deps.resetRunState?.();
    } catch {}

    let finalAgentType: any = agentType;
    if (!finalAgentType || finalAgentType === 'auto') {
      if (trimmedText.startsWith('/chat')) finalAgentType = 'chat';
      else if (trimmedText.startsWith('/search')) finalAgentType = 'search';
      else if (trimmedText.startsWith('/agent')) finalAgentType = 'agent';
    }

    if (trimmedText.startsWith('/')) {
      if (!trimmedText.startsWith('/chat') && !trimmedText.startsWith('/search') && !trimmedText.startsWith('/agent')) {
        const wasHandled = await handleCommand(trimmedText);
        if (wasHandled) return;
      }
    }

    if (isHistoricalSession()) {
      logger.log('Cannot send messages in historical sessions');
      return;
    }

    try {
      await ensurePerChatBeforeNewSession(isFollowUpMode(), !!sessionIdRef.current);

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) throw new Error('No active tab found');

      setInputEnabled(false);
      setShowStopButton(true);

      if (!isFollowUpMode()) {
        if (incognitoMode()) {
          const newId = deps.createTaskId();
          sessionIdRef.current = newId;
          setCurrentSessionId(newId);
        } else {
          const newSession = await chatHistoryStore.createSession(
            text.substring(0, 50) + (text.length > 50 ? '...' : ''),
          );
          logger.log('newSession', newSession);
          const sessionId = newSession.id;
          setCurrentSessionId(sessionId);
          sessionIdRef.current = sessionId;
        }
      }

      const userMessage = { actor: Actors.USER, content: text, timestamp: Date.now() };
      appendMessage(userMessage, sessionIdRef.current);
      lastUserPromptRef.current = text;

      if (!portRef.current) {
        setupConnection();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!portRef.current || portRef.current.name !== 'side-panel-connection') {
        throw new Error('Connection not ready. Please try again.');
      }

      if (String(finalAgentType) === 'multiagent') {
        await sendMessage({
          type: 'start_multi_agent_workflow_v2',
          query: trimmedText.replace(/^\/(chat|search|agent|agentv2)\b\s*/i, ''),
          sessionId: sessionIdRef.current,
          contextTabIds,
        } as any);
        logger.log('start_multi_agent_workflow_v2 sent', trimmedText, sessionIdRef.current, contextTabIds);
        setCurrentTaskAgentType('multiagent');
      } else if (isFollowUpMode()) {
        await sendMessage({
          type: 'follow_up_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
          agentType: finalAgentType,
          contextTabIds,
        });
        logger.log('follow_up_task sent', text, tabId, sessionIdRef.current, finalAgentType);
        setCurrentTaskAgentType(finalAgentType || null);
        try {
          if (sessionIdRef.current) {
            const current = chatSessions.find(s => s.id === sessionIdRef.current);
            await chatHistoryStore.updateTitle(sessionIdRef.current, current?.title || '');
            await loadChatSessions();
          }
        } catch {}
      } else {
        let maxWorkersOverride = 3;
        try {
          const getFn: any = (generalSettingsStore as any)?.getSettings;
          const s = typeof getFn === 'function' ? await getFn.call(generalSettingsStore) : null;
          if (s && typeof s.maxWorkerAgents === 'number') maxWorkersOverride = s.maxWorkerAgents;
        } catch {}
        await sendMessage({
          type: 'new_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
          agentType: finalAgentType,
          maxWorkersOverride,
          contextTabIds,
        });
        logger.log('new_task sent', text, tabId, sessionIdRef.current, finalAgentType);
        setCurrentTaskAgentType(finalAgentType || null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Task error', errorMessage);
      appendMessage({ actor: Actors.SYSTEM, content: errorMessage, timestamp: Date.now() });
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
    }
  };
}
