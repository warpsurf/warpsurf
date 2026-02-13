import { type MutableRefObject, useState, useEffect, useCallback } from 'react';
import { Actors } from '@extension/storage';
import type { FavoritePrompt } from '@extension/storage/lib/prompt/favorites';
import { INLINE_CHAT_DISCLAIMER } from '@extension/shared/lib/utils/disclaimers';
import MessageList from '../components/chat-interface/message-list';
import ChatInput from '../components/chat-interface/chat-input';
import AvailableChatSection from '../components/chat-interface/available-chat-section';
import SessionControls from '../components/footer/session-controls';
import { formatUsd } from '../components/chat-interface/message-list';
import type { ContextTabInfo } from '../components/chat-interface/types';

export interface ChatScreenProps {
  isDarkMode: boolean;
  messages: any[];
  inputEnabled: boolean;
  showStopButton: boolean;
  isPaused: boolean;
  isHistoricalSession: boolean;
  currentSessionId: string | null;
  forceChatView: boolean;
  compactMode: boolean;
  sessionStats: any;
  requestSummaries: any;
  messageMetadata: any;
  mirrorPreview: any;
  mirrorPreviewBatch: any[];
  hasFirstPreview: boolean;
  isPreviewCollapsed: boolean;
  agentTraceRootId: string | null;
  pendingEstimation: any;
  availableModelsForEstimation: any[];
  showJumpToLatest: boolean;
  showCloseTabs: boolean;
  workerTabGroups: any[];
  pinnedMessageIds: Set<string>;
  currentTaskAgentType: string | null;
  isJobActive: boolean;
  tokenLog: any[];
  useFullPlanningPipeline: boolean;
  enablePlanner: boolean;
  enableValidator: boolean;
  useVisionState: boolean;
  hasConfiguredModels: boolean | null;
  favoritePrompts: FavoritePrompt[];
  replayEnabled: boolean;
  showEmergencyStop?: boolean;
  isStopping?: boolean;
  // Auto tab context props
  autoContextEnabled?: boolean;
  autoContextTabIds?: number[];
  excludedAutoTabIds?: number[];
  onExcludedAutoTabIdsChange?: (tabIds: number[]) => void;
  onAutoContextToggle?: (enabled: boolean) => Promise<void>;
  logger: any;
  portRef: MutableRefObject<chrome.runtime.Port | null>;
  sessionIdRef: MutableRefObject<string | null>;
  agentTraceRootIdRef: MutableRefObject<string | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  messagesEndRef: MutableRefObject<HTMLDivElement | null>;
  setInputTextRef: MutableRefObject<((text: string) => void) | null>;
  setSelectedAgentRef: MutableRefObject<((agent: any) => void) | null>;
  setContextTabIdsRef?: MutableRefObject<((tabIds: number[]) => void) | null>;
  setIsPreviewCollapsed: (v: boolean) => void;
  setSelectedEstimationModel: (v: any) => void;
  setRecalculatedEstimation: (v: any) => void;
  setPendingEstimation: (v: any) => void;
  setShowCloseTabs: (v: boolean) => void;
  setWorkerTabGroups: (v: any[]) => void;
  handleSendMessage: (text: string, agentType?: string) => Promise<void>;
  handleStopTask: () => Promise<void>;
  handlePauseTask: () => Promise<void>;
  handleResumeTask: () => Promise<void>;
  handleReplay: (historySessionId: string) => Promise<void>;
  handleClearChat: () => Promise<void>;
  handleBookmarkSelect: (content: string, agentType?: any) => void;
  handleBookmarkAdd: (title: string, content: string, agentType?: any) => Promise<void>;
  handleBookmarkUpdate: (id: number, title: string, content: string, agentType?: any) => Promise<void>;
  handleBookmarkDelete: (id: number) => Promise<void>;
  handleBookmarkReorder: (draggedId: number, targetId: number) => Promise<void>;
  handlePinMessage: (messageId: string) => void;
  handleQuoteMessage: (text: string) => void;
  appendMessage: (message: any) => void;
  setupConnection: () => void;
  handleKillSwitch?: () => void;
  // For storing context tabs metadata
  setMessageMetadata?: (updater: (prev: any) => any) => void;
  // Callback to set pending context tabs (will be stored when user message is created)
  setPendingContextTabs?: (tabs: ContextTabInfo[] | null) => void;
  // Speech-to-text props
  onMicClick?: () => void;
  onMicStop?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  recordingDurationMs?: number;
  audioLevel?: number;
  sttConfigured?: boolean;
  onOpenVoiceSettings?: () => void;
}

export function ChatScreen(props: ChatScreenProps) {
  const {
    isDarkMode,
    messages,
    inputEnabled,
    showStopButton,
    isPaused,
    isHistoricalSession,
    currentSessionId,
    forceChatView,
    compactMode,
    sessionStats,
    requestSummaries,
    messageMetadata,
    mirrorPreview,
    mirrorPreviewBatch,
    hasFirstPreview,
    isPreviewCollapsed,
    agentTraceRootId,
    pendingEstimation,
    availableModelsForEstimation,
    showJumpToLatest,
    showCloseTabs,
    workerTabGroups,
    pinnedMessageIds,
    currentTaskAgentType,
    isJobActive,
    tokenLog,
    useFullPlanningPipeline,
    enablePlanner,
    enableValidator,
    useVisionState,
    hasConfiguredModels,
    favoritePrompts,
    replayEnabled,
    showEmergencyStop,
    isStopping,
    logger,
    portRef,
    sessionIdRef,
    agentTraceRootIdRef,
    panelRef,
    messagesEndRef,
    setInputTextRef,
    setSelectedAgentRef,
    setContextTabIdsRef,
    setIsPreviewCollapsed,
    setSelectedEstimationModel,
    setRecalculatedEstimation,
    setPendingEstimation,
    setShowCloseTabs,
    setWorkerTabGroups,
    handleSendMessage,
    handleStopTask,
    handlePauseTask,
    handleResumeTask,
    handleReplay,
    handleClearChat,
    handleBookmarkSelect,
    handleBookmarkAdd,
    handleBookmarkUpdate,
    handleBookmarkDelete,
    handleBookmarkReorder,
    handlePinMessage,
    handleQuoteMessage,
    appendMessage,
    setupConnection,
    handleKillSwitch,
    autoContextEnabled = false,
    autoContextTabIds = [],
    excludedAutoTabIds = [],
    onExcludedAutoTabIdsChange,
    onAutoContextToggle,
    setMessageMetadata,
    setPendingContextTabs,
    onMicClick,
    onMicStop,
    isRecording: isRecordingProp = false,
    isProcessingSpeech: isProcessingSpeechProp = false,
    recordingDurationMs: recordingDurationMsProp = 0,
    audioLevel: audioLevelProp = 0,
    sttConfigured: sttConfiguredProp = false,
    onOpenVoiceSettings,
  } = props;

  // Context tabs state lifted here to persist across ChatInput remounts
  const [contextTabIds, setContextTabIds] = useState<number[]>([]);

  // Expose setContextTabIds via ref for external control (e.g., context menu)
  useEffect(() => {
    if (setContextTabIdsRef) {
      setContextTabIdsRef.current = setContextTabIds;
    }
    return () => {
      if (setContextTabIdsRef) {
        setContextTabIdsRef.current = null;
      }
    };
  }, [setContextTabIdsRef]);

  // Callback to capture context tabs info when sending a message
  // This sets the pending tabs in SidePanel, which will be stored when user message is created
  const handleContextTabsCapture = useCallback(
    (_timestamp: number, contextTabs: ContextTabInfo[]) => {
      setPendingContextTabs?.(contextTabs);
    },
    [setPendingContextTabs],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Loading */}
      {hasConfiguredModels === null && messages.length === 0 && (
        <div
          className={`flex flex-1 items-center justify-center p-8 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <div className="text-center">
            <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-violet-400 border-t-transparent"></div>
            <p>Checking configuration...</p>
          </div>
        </div>
      )}

      {/* Setup */}
      {hasConfiguredModels === false && messages.length === 0 && (
        <div
          className={`flex flex-1 items-center justify-center p-8 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <div className="max-w-md text-center">
            <img src="/warpsurflogo_tagline.png" alt="warpsurf Logo" className="mx-auto mb-4 size-48" />
            <h3 className={`mb-2 text-3xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              Welcome to warpsurf!
            </h3>
            <p className="mb-4">To get started, please configure your API keys in the settings page.</p>
            <button
              onClick={() => chrome.runtime.openOptionsPage()}
              className={`my-4 rounded-lg px-4 py-2 font-medium transition-colors ${isDarkMode ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-violet-500 text-white hover:bg-violet-600'}`}>
              Open Settings
            </button>
          </div>
        </div>
      )}

      {/* Chat interface */}
      {hasConfiguredModels === true && (
        <>
          {/* When no messages - show input at top, then examples */}
          {messages.length === 0 && !forceChatView && (
            <div className="flex h-full min-h-0 flex-1 flex-col">
              <div className="px-2 pt-2">
                <ChatInput
                  isDarkMode={isDarkMode}
                  disabled={!inputEnabled || isHistoricalSession}
                  showStopButton={showStopButton}
                  isPaused={isPaused}
                  isJobActive={isJobActive}
                  isStopping={isStopping}
                  historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                  onSendMessage={handleSendMessage}
                  onStopTask={handleStopTask}
                  onPauseTask={handlePauseTask}
                  onResumeTask={handleResumeTask}
                  onReplay={handleReplay}
                  setContent={setter => {
                    setInputTextRef.current = setter;
                  }}
                  setAgentSelector={setter => {
                    setSelectedAgentRef.current = setter;
                  }}
                  contextTabIds={contextTabIds}
                  onContextTabsChange={setContextTabIds}
                  autoContextEnabled={autoContextEnabled}
                  autoContextTabIds={autoContextTabIds}
                  excludedAutoTabIds={excludedAutoTabIds}
                  onExcludedAutoTabIdsChange={onExcludedAutoTabIdsChange}
                  onAutoContextToggle={onAutoContextToggle}
                  onContextTabsCapture={handleContextTabsCapture}
                  onMicClick={onMicClick}
                  onMicStop={onMicStop}
                  isRecording={isRecordingProp}
                  isProcessingSpeech={isProcessingSpeechProp}
                  recordingDurationMs={recordingDurationMsProp}
                  audioLevel={audioLevelProp}
                  sttConfigured={sttConfiguredProp}
                  onOpenVoiceSettings={onOpenVoiceSettings}
                  expandedComposer={true}
                  sessionStats={sessionStats}
                  formatUsd={formatUsd}
                  currentSessionId={currentSessionId}
                  agentTraceRootIdRef={agentTraceRootIdRef}
                  currentTaskAgentType={currentTaskAgentType}
                  messageMetadata={messageMetadata}
                  portRef={portRef}
                  showEmergencyStop={showEmergencyStop}
                  onEmergencyStop={handleKillSwitch}
                  onHandBackControl={instructions => {
                    const tabId = mirrorPreview?.tabId;
                    try {
                      if (portRef.current) {
                        portRef.current.postMessage({ type: 'hand_back_control', tabId, instructions });
                        if (instructions && instructions.trim())
                          appendMessage({
                            actor: Actors.USER,
                            content: `📝 **Handing back control with instructions:**\n\n${instructions}`,
                            timestamp: Date.now(),
                          });
                      }
                    } catch {}
                  }}
                />
              </div>
              <div className={`${isDarkMode ? 'text-slate-400' : 'text-gray-500'} px-3 py-2 text-[11px]`}>
                {INLINE_CHAT_DISCLAIMER}
              </div>
              <div className="mt-auto min-h-0 max-h-[42%] overflow-hidden pb-2">
                <AvailableChatSection
                  isDarkMode={isDarkMode}
                  favoritePrompts={favoritePrompts}
                  onExampleSelect={(content, agentType) => {
                    try {
                      if (setInputTextRef.current) setInputTextRef.current(content);
                      if (setSelectedAgentRef.current && agentType) setSelectedAgentRef.current(agentType);
                    } catch (e) {
                      logger.error('Example select failed:', e);
                    }
                  }}
                  onBookmarkSelect={handleBookmarkSelect}
                  onBookmarkAdd={handleBookmarkAdd}
                  onBookmarkUpdate={handleBookmarkUpdate}
                  onBookmarkDelete={handleBookmarkDelete}
                  onBookmarkReorder={handleBookmarkReorder}
                />
              </div>
            </div>
          )}

          {/* When messages exist or forceChatView - show messages at top, input at bottom */}
          {(messages.length > 0 || forceChatView) && (
            <>
              <div
                className={`relative flex-1 min-h-0 overflow-x-hidden overflow-y-auto p-2 messages-scroll ${isDarkMode ? 'bg-slate-900/80' : ''}`}>
                <MessageList
                  messages={messages}
                  isDarkMode={isDarkMode}
                  compactMode={compactMode}
                  jobSummaries={requestSummaries}
                  metadataByMessageId={messageMetadata}
                  inlinePreview={hasFirstPreview ? mirrorPreview : null}
                  inlinePreviewBatch={hasFirstPreview ? mirrorPreviewBatch : []}
                  isPreviewCollapsed={isPreviewCollapsed}
                  activeAggregateMessageId={agentTraceRootId}
                  onTogglePreviewCollapsed={() => setIsPreviewCollapsed(!isPreviewCollapsed)}
                  pendingEstimation={pendingEstimation}
                  availableModelsForEstimation={availableModelsForEstimation}
                  onApproveEstimation={(selectedModel, updatedEstimation) => {
                    try {
                      setSelectedEstimationModel(selectedModel);
                      if (updatedEstimation) setRecalculatedEstimation(updatedEstimation);
                      portRef.current?.postMessage({
                        type: 'approve_estimation',
                        sessionId: currentSessionId,
                        selectedModel,
                        estimation: updatedEstimation,
                      });
                    } catch (e) {
                      logger.error('[ChatScreen] Failed to send approval:', e);
                    }
                  }}
                  onCancelEstimation={() => {
                    try {
                      portRef.current?.postMessage({ type: 'cancel_estimation', sessionId: currentSessionId });
                      setPendingEstimation(null);
                      setSelectedEstimationModel(undefined);
                    } catch (e) {
                      logger.error('[ChatScreen] Failed to send cancellation:', e);
                    }
                  }}
                  onTakeControl={tabId => {
                    try {
                      if (portRef.current) {
                        (window as any).__onTakeControl = (id: number) =>
                          portRef.current?.postMessage({ type: 'take_control', tabId: id });
                        portRef.current.postMessage({ type: 'take_control', tabId });
                      }
                    } catch {}
                  }}
                  onHandBack={(tabId, instructions) => {
                    try {
                      if (portRef.current)
                        portRef.current.postMessage({ type: 'hand_back_control', tabId, instructions });
                    } catch {}
                  }}
                  onOpenPreviewTab={tabId => {
                    try {
                      const target = typeof tabId === 'number' ? tabId : mirrorPreview?.tabId;
                      if (!target) return;
                      (async () => {
                        try {
                          if (!portRef.current) {
                            setupConnection();
                            await new Promise(r => setTimeout(r, 120));
                          }
                          if (portRef.current?.name === 'side-panel-connection')
                            portRef.current.postMessage({ type: 'focus_tab', tabId: target });
                        } catch {}
                      })();
                    } catch {}
                  }}
                  isAgentWorking={
                    isJobActive && (currentTaskAgentType === 'agent' || currentTaskAgentType === 'multiagent')
                  }
                  pinnedMessageIds={pinnedMessageIds}
                  onPinMessage={handlePinMessage}
                  onQuoteMessage={handleQuoteMessage}
                  scrollParent={panelRef.current?.querySelector('.messages-scroll') as HTMLElement | null}
                />
                <div ref={messagesEndRef} />
                {showJumpToLatest && (
                  <div className="pointer-events-none absolute bottom-4 right-4">
                    <button
                      type="button"
                      className={`pointer-events-auto rounded-full border px-3 py-1 text-xs shadow ${isDarkMode ? 'bg-slate-800/80 text-slate-200 border-slate-700 hover:bg-slate-800' : 'bg-white/80 text-gray-700 border-gray-300 hover:bg-white'}`}
                      onClick={() => {
                        const container = panelRef.current?.querySelector('.messages-scroll') as HTMLElement | null;
                        container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                      }}>
                      Jump to latest
                    </button>
                  </div>
                )}
              </div>
              {/* Input at bottom when messages exist */}
              <div
                className={`border-t ${isDarkMode ? 'border-slate-800' : 'border-gray-200'} p-2 shadow-sm backdrop-blur-sm`}>
                <ChatInput
                  isDarkMode={isDarkMode}
                  disabled={!inputEnabled || isHistoricalSession}
                  showStopButton={showStopButton}
                  isPaused={isPaused}
                  isJobActive={isJobActive}
                  isStopping={isStopping}
                  historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                  onSendMessage={handleSendMessage}
                  onStopTask={handleStopTask}
                  onPauseTask={handlePauseTask}
                  onResumeTask={handleResumeTask}
                  onReplay={handleReplay}
                  setContent={setter => {
                    setInputTextRef.current = setter;
                  }}
                  setAgentSelector={setter => {
                    setSelectedAgentRef.current = setter;
                  }}
                  contextTabIds={contextTabIds}
                  onContextTabsChange={setContextTabIds}
                  autoContextEnabled={autoContextEnabled}
                  autoContextTabIds={autoContextTabIds}
                  excludedAutoTabIds={excludedAutoTabIds}
                  onExcludedAutoTabIdsChange={onExcludedAutoTabIdsChange}
                  onAutoContextToggle={onAutoContextToggle}
                  onContextTabsCapture={handleContextTabsCapture}
                  onMicClick={onMicClick}
                  onMicStop={onMicStop}
                  isRecording={isRecordingProp}
                  isProcessingSpeech={isProcessingSpeechProp}
                  recordingDurationMs={recordingDurationMsProp}
                  audioLevel={audioLevelProp}
                  sttConfigured={sttConfiguredProp}
                  onOpenVoiceSettings={onOpenVoiceSettings}
                  sessionStats={sessionStats}
                  formatUsd={formatUsd}
                  currentSessionId={currentSessionId}
                  agentTraceRootIdRef={agentTraceRootIdRef}
                  currentTaskAgentType={currentTaskAgentType}
                  messageMetadata={messageMetadata}
                  portRef={portRef}
                  showEmergencyStop={showEmergencyStop}
                  onEmergencyStop={handleKillSwitch}
                  onHandBackControl={instructions => {
                    const tabId = mirrorPreview?.tabId;
                    try {
                      if (portRef.current) {
                        portRef.current.postMessage({ type: 'hand_back_control', tabId, instructions });
                        if (instructions && instructions.trim())
                          appendMessage({
                            actor: Actors.USER,
                            content: `📝 **Handing back control with instructions:**\n\n${instructions}`,
                            timestamp: Date.now(),
                          });
                      }
                    } catch {}
                  }}
                />
              </div>
            </>
          )}

          {/* Session controls - only shows close tabs button when needed */}
          <SessionControls
            isDarkMode={isDarkMode}
            showCloseTabs={showCloseTabs}
            workerTabGroups={workerTabGroups}
            sessionIdForCleanup={currentSessionId || sessionIdRef.current}
            onClosedTabs={() => {
              setShowCloseTabs(false);
              setWorkerTabGroups([]);
            }}
          />
          {(messages.length > 0 || forceChatView) && (
            <div className={`${isDarkMode ? 'text-slate-400' : 'text-gray-500'} px-3 py-2 text-[11px]`}>
              {INLINE_CHAT_DISCLAIMER}
            </div>
          )}
        </>
      )}

      {/* Historical messages when not configured */}
      {hasConfiguredModels !== true && messages.length > 0 && (
        <div
          className={`relative flex-1 min-h-0 overflow-x-hidden overflow-y-auto p-2 messages-scroll ${isDarkMode ? 'bg-slate-900/80' : ''}`}>
          <MessageList
            messages={messages}
            isDarkMode={isDarkMode}
            compactMode={compactMode}
            jobSummaries={requestSummaries}
            metadataByMessageId={messageMetadata}
            inlinePreview={hasFirstPreview ? mirrorPreview : null}
            inlinePreviewBatch={hasFirstPreview ? mirrorPreviewBatch : []}
            isPreviewCollapsed={isPreviewCollapsed}
            activeAggregateMessageId={agentTraceRootId}
            onTogglePreviewCollapsed={() => setIsPreviewCollapsed(!isPreviewCollapsed)}
            onTakeControl={tabId => {
              try {
                if (portRef.current) {
                  (window as any).__onTakeControl = (id: number) =>
                    portRef.current?.postMessage({ type: 'take_control', tabId: id });
                  portRef.current.postMessage({ type: 'take_control', tabId });
                }
              } catch {}
            }}
            onHandBack={(tabId, instructions) => {
              try {
                if (portRef.current) portRef.current.postMessage({ type: 'hand_back_control', tabId, instructions });
              } catch {}
            }}
            onOpenPreviewTab={tabId => {
              try {
                const target = typeof tabId === 'number' ? tabId : mirrorPreview?.tabId;
                if (!target) return;
                (async () => {
                  try {
                    if (!portRef.current) {
                      setupConnection();
                      await new Promise(r => setTimeout(r, 120));
                    }
                    if (portRef.current?.name === 'side-panel-connection')
                      portRef.current.postMessage({ type: 'focus_tab', tabId: target });
                  } catch {}
                })();
              } catch {}
            }}
            isAgentWorking={isJobActive && (currentTaskAgentType === 'agent' || currentTaskAgentType === 'multiagent')}
            pinnedMessageIds={pinnedMessageIds}
            onPinMessage={handlePinMessage}
            onQuoteMessage={handleQuoteMessage}
            scrollParent={panelRef.current?.querySelector('.messages-scroll') as HTMLElement | null}
          />
          <div ref={messagesEndRef} />
          {showJumpToLatest && (
            <div className="pointer-events-none absolute bottom-4 right-4">
              <button
                type="button"
                className={`pointer-events-auto rounded-full border px-3 py-1 text-xs shadow ${isDarkMode ? 'bg-slate-800/80 text-slate-200 border-slate-700 hover:bg-slate-800' : 'bg-white/80 text-gray-700 border-gray-300 hover:bg-white'}`}
                onClick={() => {
                  const container = panelRef.current?.querySelector('.messages-scroll') as HTMLElement | null;
                  container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                }}>
                Jump to latest
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
