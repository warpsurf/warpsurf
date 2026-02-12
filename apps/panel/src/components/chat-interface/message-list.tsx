import type { Message } from '@extension/storage';
import { memo, useMemo, useState, useRef, useEffect } from 'react';
import { Actors } from '@extension/storage';
import { Virtuoso } from 'react-virtuoso';
import { formatDay } from '../../utils';
import type { JobSummary, MessageMetadata, InlinePreview, InlinePreviewBatch } from './types';
import MessageBlock from './message-block';
import PreviewPanel from './preview-panel';

export { formatUsd } from '../../utils';

export interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
  compactMode?: boolean;
  jobSummaries?: { [messageId: string]: JobSummary };
  metadataByMessageId?: { [messageId: string]: MessageMetadata };
  onRetryRequest?: (text: string, agent: 'chat' | 'search' | 'agent') => void;
  inlinePreview?: InlinePreview | null;
  inlinePreviewBatch?: InlinePreviewBatch;
  onOpenPreviewTab?: (tabId?: number) => void | Promise<void>;
  onTakeControl?: (tabId?: number) => void | Promise<void>;
  onHandBack?: (tabId?: number, instructions?: string) => void | Promise<void>;
  isAgentWorking?: boolean;
  isPaused?: boolean;
  pendingEstimation?: any;
  availableModelsForEstimation?: Array<{ provider: string; providerName: string; model: string }>;
  onApproveEstimation?: (selectedModel?: string, updatedEstimation?: any) => void;
  onCancelEstimation?: () => void;
  isPreviewCollapsed?: boolean;
  onTogglePreviewCollapsed?: () => void;
  activeAggregateMessageId?: string | null;
  pinnedMessageIds?: Set<string>;
  onPinMessage?: (messageId: string) => void;
  onQuoteMessage?: (text: string) => void;
  scrollParent?: HTMLElement | null;
}

export default memo(function MessageList({
  messages,
  isDarkMode = false,
  compactMode = false,
  jobSummaries = {},
  metadataByMessageId = {},
  onRetryRequest,
  inlinePreview,
  inlinePreviewBatch = [],
  onOpenPreviewTab,
  onTakeControl,
  isAgentWorking = false,
  isPaused = false,
  isPreviewCollapsed = false,
  onTogglePreviewCollapsed,
  activeAggregateMessageId = null,
  pinnedMessageIds,
  scrollParent,
  pendingEstimation,
  availableModelsForEstimation,
  onApproveEstimation,
  onCancelEstimation,
}: MessageListProps) {
  const lastAgentIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].actor !== Actors.USER && messages[i].actor !== Actors.SYSTEM) return i;
    }
    return -1;
  }, [messages]);

  const shouldShowDateDivider = (currentTs: number, prevTs?: number) =>
    !prevTs || new Date(prevTs).toDateString() !== new Date(currentTs).toDateString();

  const [fpsText, setFpsText] = useState('');
  const lastFrameRef = useRef(0);
  useEffect(() => {
    if (!inlinePreview?.screenshot && !inlinePreviewBatch?.length) return;
    const now = Date.now();
    const dt = now - (lastFrameRef.current || 0);
    lastFrameRef.current = now;
    if (dt > 0 && dt < 4000) setFpsText(`${Math.min(60, 1000 / dt).toFixed(1)} fps`);
  }, [inlinePreview?.screenshot, inlinePreviewBatch?.map?.(p => p?.screenshot || '').join('|')]);

  const DateDivider = ({ timestamp }: { timestamp: number }) => (
    <div className="my-2 flex items-center gap-2">
      <div className={`h-px flex-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
      <div className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>{formatDay(timestamp)}</div>
      <div className={`h-px flex-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
    </div>
  );

  return (
    <div className="h-full max-w-full">
      <Virtuoso
        style={{ height: '100%' }}
        data={messages}
        customScrollParent={scrollParent || undefined}
        itemContent={(index, message) => {
          const messageId = `${message.timestamp}-${message.actor}`;
          const rootMeta = activeAggregateMessageId ? metadataByMessageId[activeAggregateMessageId] : undefined;
          const isCurrentRunRoot = activeAggregateMessageId === messageId;
          // Only consider LIVE previews, not final preview from metadata
          const hasLivePreview = !!(inlinePreview || inlinePreviewBatch?.length);
          const isFallbackLastAgent =
            !activeAggregateMessageId &&
            hasLivePreview &&
            (index === lastAgentIndex || (lastAgentIndex === -1 && index === messages.length - 1));
          // Only show preview panel when there's a live preview AND workflow is active
          const showPreviewHere = hasLivePreview && (isCurrentRunRoot || isFallbackLastAgent);
          const metadata = metadataByMessageId[messageId] || (showPreviewHere ? rootMeta : undefined);
          const agentColorHex =
            metadata?.agentColor || (activeAggregateMessageId === messageId ? inlinePreview?.color : undefined);
          const showDivider = shouldShowDateDivider(
            message.timestamp,
            index > 0 ? messages[index - 1].timestamp : undefined,
          );
          const messageBlockProps = {
            message,
            isSameActor: index > 0 && messages[index - 1].actor === message.actor,
            isDarkMode,
            compactMode: showPreviewHere ? false : compactMode,
            jobSummary: jobSummaries[messageId],
            metadata,
            isAgentAggregate: !!metadata?.traceItems,
            onRetryRequest,
            agentColorHex,
            isAgentWorking:
              isAgentWorking &&
              !metadata?.isCompleted &&
              (activeAggregateMessageId ? isCurrentRunRoot : isFallbackLastAgent),
            onTakeControl,
            pinnedMessageIds,
            pendingEstimation,
            availableModelsForEstimation,
            onApproveEstimation,
            onCancelEstimation,
          };

          const isUserMessage = message.actor === Actors.USER;
          const prevIsUser = index > 0 && messages[index - 1].actor === Actors.USER;
          const needsExtraSpace = index > 0 && isUserMessage !== prevIsUser;

          return showPreviewHere ? (
            <div className={needsExtraSpace ? 'mt-2' : 'mt-0.5'}>
              {showDivider && <DateDivider timestamp={message.timestamp} />}
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <MessageBlock {...messageBlockProps} hasPreviewPanel />
                </div>
                <div className="w-1/3 flex-shrink-0">
                  <PreviewPanel
                    inlinePreview={inlinePreview ?? null}
                    inlinePreviewBatch={inlinePreviewBatch || []}
                    agentColorHex={agentColorHex}
                    isPaused={isPaused}
                    isPreviewCollapsed={isPreviewCollapsed}
                    fpsText={fpsText}
                    isDarkMode={isDarkMode}
                    onTogglePreviewCollapsed={onTogglePreviewCollapsed}
                    onOpenPreviewTab={onOpenPreviewTab}
                    onTakeControl={onTakeControl}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className={needsExtraSpace ? 'mt-2' : 'mt-0.5'}>
              {showDivider && <DateDivider timestamp={message.timestamp} />}
              <MessageBlock {...messageBlockProps} />
            </div>
          );
        }}
      />
    </div>
  );
});
