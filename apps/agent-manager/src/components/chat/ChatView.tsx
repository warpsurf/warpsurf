import { lazy, Suspense, useRef, useEffect } from 'react';
import type { Message, RequestSummary, MessageMetadataValue } from '@extension/storage';
import { Actors } from '@extension/storage';
import { FiArrowLeft, FiExternalLink } from 'react-icons/fi';
import { formatDay } from '@panel/utils';
const MessageBlock = lazy(() => import('@panel/components/chat-interface/message-block'));
import ChatInput from '@panel/components/chat-interface/chat-input';
import type {
  MessageMetadata,
  InlinePreview,
  InlinePreviewBatch,
  ContextTabInfo,
} from '@panel/components/chat-interface/types';

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
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

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
              {messages.map((message, index) => {
                const messageId = `${message.timestamp}-${message.actor}`;
                const metadata = (metadataByMessageId as Record<string, MessageMetadata>)[messageId];
                const isUserMessage = message.actor === Actors.USER;
                const prevIsUser = index > 0 && messages[index - 1].actor === Actors.USER;
                const needsExtraSpace = index > 0 && isUserMessage !== prevIsUser;
                const prevTs = index > 0 ? messages[index - 1].timestamp : undefined;
                const showDivider =
                  !prevTs || new Date(prevTs).toDateString() !== new Date(message.timestamp).toDateString();

                return (
                  <div key={messageId} className={needsExtraSpace ? 'mt-2' : 'mt-0.5'}>
                    {showDivider && (
                      <div className="my-2 flex items-center gap-2">
                        <div className={`h-px flex-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
                        <div className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                          {formatDay(message.timestamp)}
                        </div>
                        <div className={`h-px flex-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
                      </div>
                    )}
                    <MessageBlock
                      message={message}
                      isSameActor={index > 0 && messages[index - 1].actor === message.actor}
                      isDarkMode={isDarkMode}
                      jobSummary={jobSummaries[messageId]}
                      metadata={metadata}
                      isAgentAggregate={!!metadata?.traceItems}
                      isAgentWorking={
                        isRunning &&
                        !metadata?.isCompleted &&
                        index === messages.length - 1 &&
                        message.actor !== Actors.USER
                      }
                    />
                  </div>
                );
              })}
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
