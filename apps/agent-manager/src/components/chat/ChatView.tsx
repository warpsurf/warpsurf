import { lazy, Suspense, useRef, useEffect, useState } from 'react';
import type { Message, RequestSummary, MessageMetadataValue } from '@extension/storage';
import { Actors } from '@extension/storage';
import { FiArrowLeft, FiExternalLink } from 'react-icons/fi';
import { formatDay } from '@panel/utils';
const MessageBlock = lazy(() => import('@panel/components/chat-interface/message-block'));
import PreviewPanel from '@panel/components/chat-interface/preview-panel';
import ChatInput from '@panel/components/chat-interface/chat-input';
import type {
  MessageMetadata,
  InlinePreview,
  InlinePreviewBatch,
  ContextTabInfo,
} from '@panel/components/chat-interface/types';

const hasPreviewContent = (p: any): boolean => !!(p?.screenshot || p?.url);
const hasBatchContent = (batch: any): boolean =>
  Array.isArray(batch) && batch.length > 0 && batch.some(hasPreviewContent);

interface ChatViewProps {
  sessionTitle: string;
  messages: Message[];
  isDarkMode: boolean;
  isRunning: boolean;
  jobSummaries: Record<string, RequestSummary>;
  metadataByMessageId: Record<string, MessageMetadataValue>;
  inlinePreview: InlinePreview | null;
  inlinePreviewBatch: InlinePreviewBatch;
  activeAggregateMessageId?: string | null;
  onSendMessage: (
    text: string,
    agentType?: string,
    contextTabIds?: number[],
    contextMenuAction?: string,
    skipAutoContext?: boolean,
    attachments?: any[],
  ) => void;
  onClose: () => void;
  onOpenInSidePanel: () => void;
  disabled?: boolean;
  // Task control
  showStopButton?: boolean;
  onStopTask?: () => void;
  isPaused?: boolean;
  onPauseTask?: () => void;
  onResumeTask?: () => void;
  onHandBackControl?: (instructions?: string) => void;
  isStopping?: boolean;
  showEmergencyStop?: boolean;
  onEmergencyStop?: () => void;
  isAgentModeActive?: boolean;
  onInjectLiveMessage?: (text: string) => void;
  // Close tabs
  showCloseTabs?: boolean;
  workerTabGroups?: { taskId: string; groupId?: number }[];
  sessionIdForCleanup?: string | null;
  onClosedTabs?: () => void;
  // Session stats
  sessionStats?: any;
  formatUsd?: (cost: number) => string;
  // Debug/metadata
  currentSessionId?: string | null;
  agentTraceRootIdRef?: React.RefObject<string | null>;
  currentTaskAgentType?: string | null;
  messageMetadata?: any;
  portRef?: React.RefObject<chrome.runtime.Port | null>;
  // Context
  autoContextEnabled?: boolean;
  autoContextTabIds?: number[];
  onAutoContextToggle?: (enabled: boolean) => Promise<void>;
  onContextTabsCapture?: (timestamp: number, contextTabs: ContextTabInfo[]) => void;
  // Speech-to-text
  onMicClick?: () => void;
  onMicStop?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  recordingDurationMs?: number;
  audioLevel?: number;
  sttConfigured?: boolean;
  onOpenVoiceSettings?: () => void;
  // Plan
  planItems?: Array<{ text: string; status: string }>;
  workflowGraph?: any;
  workflowLaneInfo?: Record<number, { label: string; color?: string }>;
  onOpenWorkflowFullScreen?: () => void;
  // Preview
  onOpenPreviewTab?: (tabId?: number) => void | Promise<void>;
  onTakeControl?: (tabId?: number) => void | Promise<void>;
}

export default function ChatView({
  sessionTitle,
  messages,
  isDarkMode,
  isRunning,
  jobSummaries,
  metadataByMessageId,
  inlinePreview,
  inlinePreviewBatch,
  activeAggregateMessageId,
  onSendMessage,
  onClose,
  onOpenInSidePanel,
  disabled,
  showStopButton = false,
  onStopTask,
  isPaused,
  onPauseTask,
  onResumeTask,
  onHandBackControl,
  isStopping,
  showEmergencyStop,
  onEmergencyStop,
  isAgentModeActive,
  onInjectLiveMessage,
  showCloseTabs,
  workerTabGroups,
  sessionIdForCleanup,
  onClosedTabs,
  sessionStats,
  formatUsd,
  currentSessionId,
  agentTraceRootIdRef,
  currentTaskAgentType,
  messageMetadata,
  portRef,
  autoContextEnabled,
  autoContextTabIds,
  onAutoContextToggle,
  onContextTabsCapture,
  onMicClick,
  onMicStop,
  isRecording,
  isProcessingSpeech,
  recordingDurationMs,
  audioLevel,
  sttConfigured,
  onOpenVoiceSettings,
  planItems,
  workflowGraph,
  workflowLaneInfo,
  onOpenWorkflowFullScreen,
  onOpenPreviewTab,
  onTakeControl,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b flex-shrink-0 ${
          isDarkMode ? 'border-[#2f2f29] bg-[#181816]' : 'border-[#deded7] bg-[#fbfbf9]'
        }`}>
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
              isDarkMode ? 'hover:bg-[#262622] text-slate-400' : 'hover:bg-[#efeee8] text-gray-500'
            }`}
            title="Back to gallery">
            <FiArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <h2 className={`text-sm font-medium truncate ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
              {sessionTitle || 'Chat'}
            </h2>
            {isRunning && <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />}
          </div>
        </div>

        <button
          onClick={onOpenInSidePanel}
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors flex-shrink-0 ${
            isDarkMode
              ? 'hover:bg-[#262622] text-slate-400 hover:text-slate-200'
              : 'hover:bg-[#efeee8] text-gray-500 hover:text-gray-700'
          }`}
          title="Open in side panel">
          <FiExternalLink className="h-3.5 w-3.5" />
          Side panel
        </button>
      </div>

      {/* Messages — rendered directly without Virtuoso */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto messages-scroll" data-msg-count={messages.length}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className={`${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
              <p className="text-sm">No messages yet</p>
            </div>
          </div>
        ) : (
          <div className="max-w-full px-2 py-2">
            <Suspense fallback={null}>
              {(() => {
                const lastAgentIndex = (() => {
                  for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i].actor !== Actors.USER && messages[i].actor !== Actors.SYSTEM) return i;
                  }
                  return -1;
                })();
                const rootMeta = activeAggregateMessageId
                  ? (metadataByMessageId as Record<string, MessageMetadata>)[activeAggregateMessageId]
                  : undefined;
                const hasLivePreview = hasPreviewContent(inlinePreview) || hasBatchContent(inlinePreviewBatch);
                const togglePreviewCollapsed = () => setIsPreviewCollapsed(prev => !prev);

                return messages.map((message, index) => {
                  const messageId = `${message.timestamp}-${message.actor}`;
                  const metadata = (metadataByMessageId as Record<string, MessageMetadata>)[messageId];
                  const isUserMessage = message.actor === Actors.USER;
                  const prevIsUser = index > 0 && messages[index - 1].actor === Actors.USER;
                  const needsExtraSpace = index > 0 && isUserMessage !== prevIsUser;
                  const prevTs = index > 0 ? messages[index - 1].timestamp : undefined;
                  const showDivider =
                    !prevTs || new Date(prevTs).toDateString() !== new Date(message.timestamp).toDateString();

                  const isCurrentRunRoot = activeAggregateMessageId === messageId;
                  const isFallbackLastAgent =
                    !activeAggregateMessageId &&
                    hasLivePreview &&
                    (index === lastAgentIndex || (lastAgentIndex === -1 && index === messages.length - 1));
                  const showPreviewHere = hasLivePreview && (isCurrentRunRoot || isFallbackLastAgent);

                  const effectiveMeta = metadata || rootMeta;
                  const hasFinalPreview =
                    hasPreviewContent(effectiveMeta?.finalPreview) || hasBatchContent(effectiveMeta?.finalPreviewBatch);
                  const showFinalPreviewHere =
                    !showPreviewHere &&
                    hasFinalPreview &&
                    effectiveMeta?.isCompleted &&
                    (isCurrentRunRoot || index === lastAgentIndex);

                  const shouldReceivePlan =
                    isCurrentRunRoot || isFallbackLastAgent || (!activeAggregateMessageId && index === lastAgentIndex);

                  const agentColorHex = metadata?.agentColor || (isCurrentRunRoot ? inlinePreview?.color : undefined);

                  const dateDivider = showDivider ? (
                    <div className="my-2 flex items-center gap-2">
                      <div className={`h-px flex-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
                      <div className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        {formatDay(message.timestamp)}
                      </div>
                      <div className={`h-px flex-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
                    </div>
                  ) : null;

                  const messageBlockEl = (
                    <MessageBlock
                      message={message}
                      isSameActor={index > 0 && messages[index - 1].actor === message.actor}
                      isDarkMode={isDarkMode}
                      jobSummary={jobSummaries[messageId]}
                      metadata={metadata || (showPreviewHere ? rootMeta : undefined)}
                      isAgentAggregate={!!(metadata?.traceItems || (showPreviewHere && rootMeta?.traceItems))}
                      isAgentWorking={
                        isRunning &&
                        !metadata?.isCompleted &&
                        (message.content === 'Showing progress...' ||
                          (activeAggregateMessageId
                            ? isCurrentRunRoot
                            : isFallbackLastAgent || index === lastAgentIndex))
                      }
                      hasPreviewPanel={showPreviewHere || showFinalPreviewHere}
                      planItems={shouldReceivePlan ? planItems || undefined : undefined}
                      workflowGraph={shouldReceivePlan ? workflowGraph : undefined}
                      workflowLaneInfo={shouldReceivePlan ? workflowLaneInfo : undefined}
                      onOpenWorkflowFullScreen={shouldReceivePlan ? onOpenWorkflowFullScreen : undefined}
                    />
                  );

                  if (showPreviewHere) {
                    return (
                      <div key={messageId} className={needsExtraSpace ? 'mt-2' : 'mt-0.5'}>
                        {dateDivider}
                        <div className="flex gap-2">
                          <div className="flex-1 min-w-0">{messageBlockEl}</div>
                          <div className="w-1/3 flex-shrink-0">
                            <PreviewPanel
                              inlinePreview={inlinePreview ?? null}
                              inlinePreviewBatch={inlinePreviewBatch || []}
                              agentColorHex={agentColorHex}
                              isPaused={!!isPaused}
                              isPreviewCollapsed={isPreviewCollapsed}
                              isDarkMode={isDarkMode}
                              onTogglePreviewCollapsed={togglePreviewCollapsed}
                              onOpenPreviewTab={onOpenPreviewTab}
                              onTakeControl={onTakeControl}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (showFinalPreviewHere) {
                    const finalMeta = metadata || rootMeta;
                    return (
                      <div key={messageId} className={needsExtraSpace ? 'mt-2' : 'mt-0.5'}>
                        {dateDivider}
                        <div className="flex gap-2">
                          <div className="flex-1 min-w-0">{messageBlockEl}</div>
                          <div className="w-1/3 flex-shrink-0">
                            <PreviewPanel
                              inlinePreview={finalMeta?.finalPreview || null}
                              inlinePreviewBatch={finalMeta?.finalPreviewBatch || []}
                              agentColorHex={agentColorHex}
                              isPaused={false}
                              isPreviewCollapsed={isPreviewCollapsed}
                              isDarkMode={isDarkMode}
                              onTogglePreviewCollapsed={togglePreviewCollapsed}
                              onOpenPreviewTab={onOpenPreviewTab}
                              readOnly
                            />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={messageId} className={needsExtraSpace ? 'mt-2' : 'mt-0.5'}>
                      {dateDivider}
                      {messageBlockEl}
                    </div>
                  );
                });
              })()}
            </Suspense>
          </div>
        )}
      </div>

      {/* Input — uses the same ChatInput as the side panel */}
      <div className={`border-t px-4 py-3 flex-shrink-0 ${isDarkMode ? 'border-[#2f2f29]' : 'border-[#deded7]'}`}>
        <div className="max-w-3xl mx-auto">
          <ChatInput
            isDarkMode={isDarkMode}
            disabled={!!disabled}
            showStopButton={showStopButton}
            onStopTask={onStopTask || (() => {})}
            onSendMessage={onSendMessage}
            isPaused={isPaused}
            isJobActive={isRunning}
            isAgentModeActive={isAgentModeActive}
            onInjectLiveMessage={onInjectLiveMessage}
            isStopping={isStopping}
            onPauseTask={onPauseTask}
            onResumeTask={onResumeTask}
            onHandBackControl={onHandBackControl}
            showEmergencyStop={showEmergencyStop}
            onEmergencyStop={onEmergencyStop}
            showCloseTabs={showCloseTabs}
            workerTabGroups={workerTabGroups}
            sessionIdForCleanup={sessionIdForCleanup}
            onClosedTabs={onClosedTabs}
            sessionStats={sessionStats}
            formatUsd={formatUsd}
            currentSessionId={currentSessionId}
            agentTraceRootIdRef={agentTraceRootIdRef}
            currentTaskAgentType={currentTaskAgentType}
            messageMetadata={messageMetadata}
            portRef={portRef}
            autoContextEnabled={autoContextEnabled}
            autoContextTabIds={autoContextTabIds}
            onAutoContextToggle={onAutoContextToggle}
            onContextTabsCapture={onContextTabsCapture}
            onMicClick={onMicClick}
            onMicStop={onMicStop}
            isRecording={isRecording}
            isProcessingSpeech={isProcessingSpeech}
            recordingDurationMs={recordingDurationMs}
            audioLevel={audioLevel}
            sttConfigured={sttConfigured}
            onOpenVoiceSettings={onOpenVoiceSettings}
          />
        </div>
      </div>
    </div>
  );
}
