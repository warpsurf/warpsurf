import type { Message } from '@extension/storage';
import type { Attachment } from '@extension/storage/lib/chat/types';
import { memo, useMemo } from 'react';
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
  /** Resolved attachments keyed by attachment ID */
  sessionAttachments?: Record<string, Attachment>;
  /** Current plan items for the active agent run */
  planItems?: Array<{ text: string; status: string }>;
  /** Multi-agent workflow graph for the Plan tab */
  workflowGraph?: any;
  /** Lane info for the workflow graph */
  workflowLaneInfo?: Record<number, { label: string; color?: string }>;
  /** Callback to open full-screen workflow graph */
  onOpenWorkflowFullScreen?: () => void;
}

function hasPreviewContent(preview: InlinePreview | null | undefined): boolean {
  return !!(preview?.screenshot || preview?.url);
}

function hasBatchContent(batch: InlinePreviewBatch | undefined): boolean {
  return !!batch?.some(p => p.screenshot || p.url);
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
  sessionAttachments = {},
  planItems,
  workflowGraph,
  workflowLaneInfo,
  onOpenWorkflowFullScreen,
}: MessageListProps) {
  const lastAgentIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].actor !== Actors.USER && messages[i].actor !== Actors.SYSTEM) return i;
    }
    return -1;
  }, [messages]);

  const shouldShowDateDivider = (currentTs: number, prevTs?: number) =>
    !prevTs || new Date(prevTs).toDateString() !== new Date(currentTs).toDateString();

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
          const hasLivePreview = hasPreviewContent(inlinePreview) || hasBatchContent(inlinePreviewBatch);
          const isFallbackLastAgent =
            !activeAggregateMessageId &&
            hasLivePreview &&
            (index === lastAgentIndex || (lastAgentIndex === -1 && index === messages.length - 1));
          const showPreviewHere = hasLivePreview && (isCurrentRunRoot || isFallbackLastAgent);
          const metadata = metadataByMessageId[messageId] || (showPreviewHere ? rootMeta : undefined);

          // For completed sessions, show persisted final previews from metadata
          // only when the preview has actual content (screenshot or URL).
          const effectiveMeta = metadata || rootMeta;
          const hasFinalPreview =
            hasPreviewContent(effectiveMeta?.finalPreview) || hasBatchContent(effectiveMeta?.finalPreviewBatch);
          const showFinalPreviewHere =
            !showPreviewHere &&
            hasFinalPreview &&
            effectiveMeta?.isCompleted &&
            (isCurrentRunRoot || index === lastAgentIndex);

          const agentColorHex =
            metadata?.agentColor || (activeAggregateMessageId === messageId ? inlinePreview?.color : undefined);
          const showDivider = shouldShowDateDivider(
            message.timestamp,
            index > 0 ? messages[index - 1].timestamp : undefined,
          );
          const attachmentIds = metadata?.attachmentIds || [];
          const resolvedAttachments = attachmentIds.map((id: string) => sessionAttachments[id]).filter(Boolean);

          const showAnyPreview = showPreviewHere || showFinalPreviewHere;
          const messageBlockProps = {
            message,
            isSameActor: index > 0 && messages[index - 1].actor === message.actor,
            isDarkMode,
            compactMode: showAnyPreview ? false : compactMode,
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
            messageAttachments: resolvedAttachments,
            planItems: isCurrentRunRoot || isFallbackLastAgent ? planItems : undefined,
            workflowGraph: isCurrentRunRoot || isFallbackLastAgent ? workflowGraph : undefined,
            workflowLaneInfo: isCurrentRunRoot || isFallbackLastAgent ? workflowLaneInfo : undefined,
            onOpenWorkflowFullScreen: isCurrentRunRoot || isFallbackLastAgent ? onOpenWorkflowFullScreen : undefined,
          };

          const isUserMessage = message.actor === Actors.USER;
          const prevIsUser = index > 0 && messages[index - 1].actor === Actors.USER;
          const needsExtraSpace = index > 0 && isUserMessage !== prevIsUser;

          if (showPreviewHere) {
            return (
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
                      isDarkMode={isDarkMode}
                      onTogglePreviewCollapsed={onTogglePreviewCollapsed}
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
            const finalBatch = finalMeta?.finalPreviewBatch || [];
            const finalSingle = finalMeta?.finalPreview || null;
            return (
              <div className={needsExtraSpace ? 'mt-2' : 'mt-0.5'}>
                {showDivider && <DateDivider timestamp={message.timestamp} />}
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <MessageBlock {...messageBlockProps} hasPreviewPanel />
                  </div>
                  <div className="w-1/3 flex-shrink-0">
                    <PreviewPanel
                      inlinePreview={finalSingle}
                      inlinePreviewBatch={finalBatch}
                      agentColorHex={agentColorHex}
                      isPaused={false}
                      isPreviewCollapsed={isPreviewCollapsed}
                      isDarkMode={isDarkMode}
                      onTogglePreviewCollapsed={onTogglePreviewCollapsed}
                      readOnly
                    />
                  </div>
                </div>
              </div>
            );
          }

          return (
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
