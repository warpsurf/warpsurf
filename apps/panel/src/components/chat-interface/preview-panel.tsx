import type { InlinePreview, InlinePreviewBatch } from './types';

interface PreviewPanelProps {
  inlinePreview: InlinePreview | null;
  inlinePreviewBatch: InlinePreviewBatch;
  agentColorHex?: string;
  isPaused: boolean;
  isPreviewCollapsed: boolean;
  isDarkMode: boolean;
  onTogglePreviewCollapsed?: () => void;
  onOpenPreviewTab?: (tabId?: number) => void | Promise<void>;
  onTakeControl?: (tabId?: number) => void | Promise<void>;
  /** When true, renders as a static snapshot without interactive controls */
  readOnly?: boolean;
}

function getAgentLabel(preview: InlinePreviewBatch[number], index: number): string {
  if (preview.agentName?.trim()) return preview.agentName;
  if (preview.agentOrdinal != null) return `Crew ${preview.agentOrdinal}`;
  return `Crew ${String(preview.agentId || '').replace(/\D/g, '') || index + 1}`;
}

export default function PreviewPanel({
  inlinePreview,
  inlinePreviewBatch,
  agentColorHex,
  isPaused,
  isPreviewCollapsed,
  isDarkMode,
  onTogglePreviewCollapsed,
  onOpenPreviewTab,
  onTakeControl,
  readOnly = false,
}: PreviewPanelProps) {
  const hasBatch = inlinePreviewBatch?.length > 1;
  const effectivePreview = inlinePreview ?? (inlinePreviewBatch?.length === 1 ? inlinePreviewBatch[0] : null);

  // Don't render anything for completed sessions with no meaningful preview data
  if (readOnly) {
    const hasAnyContent = hasBatch
      ? inlinePreviewBatch.some(p => p.screenshot || p.url)
      : !!(effectivePreview?.screenshot || effectivePreview?.url);
    if (!hasAnyContent) return null;
  }

  const openBtnBase = `rounded px-2 py-0.5 transition-all`;
  const openBtnEnabled = isDarkMode
    ? 'bg-violet-700 text-white hover:bg-violet-600'
    : 'bg-violet-500 text-white hover:bg-violet-600';
  const openBtnDisabled = isDarkMode
    ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
    : 'bg-gray-300 text-gray-500 cursor-not-allowed';
  const controlBtn = `rounded px-2 py-0.5 ${isDarkMode ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-amber-500 text-white hover:bg-amber-600'}`;

  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden ${isDarkMode ? 'border-slate-700 bg-slate-900/70' : 'border-gray-200 bg-white/90'}`}
      style={agentColorHex ? { borderColor: agentColorHex } : undefined}>
      <div
        className={`px-2 pt-2 pb-1 flex items-center justify-between text-xs ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="truncate" title={effectivePreview?.url || effectivePreview?.title || ''}>
            {effectivePreview?.url || effectivePreview?.title || (readOnly ? 'Final preview' : 'Preview')}
          </div>
          {isPaused && !readOnly && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${isDarkMode ? 'bg-amber-600' : 'bg-amber-500'} text-white`}>
              Awaiting your action
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`rounded px-1 py-0.5 ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}
            onClick={() => onTogglePreviewCollapsed?.()}>
            {isPreviewCollapsed ? 'Expand' : 'Collapse'}
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => effectivePreview?.tabId && onOpenPreviewTab?.(effectivePreview.tabId)}
                disabled={!effectivePreview?.tabId}
                className={`${openBtnBase} ${effectivePreview?.tabId ? openBtnEnabled : openBtnDisabled}`}
                style={effectivePreview?.tabId && agentColorHex ? { backgroundColor: agentColorHex } : undefined}>
                Open
              </button>
              {effectivePreview?.tabId && (
                <button type="button" onClick={() => onTakeControl?.(effectivePreview.tabId)} className={controlBtn}>
                  Take control
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {!readOnly && (
        <div className={`px-2 pb-1 text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
          {isPaused
            ? 'Paused — use "Hand back control" below to resume.'
            : 'Tip: "Take control" pauses the agent; use "Hand back control" below to resume.'}
        </div>
      )}
      {!isPreviewCollapsed &&
        (hasBatch ? (
          <div className={`grid grid-cols-2 gap-2 ${readOnly ? 'p-2' : 'mt-2'}`}>
            {inlinePreviewBatch.map((preview, idx) => (
              <div
                key={preview.agentId || preview.tabId || idx}
                className={`rounded-lg border p-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/60' : 'border-gray-200 bg-white/90'}`}
                style={preview.color ? { borderColor: preview.color } : undefined}>
                <div className={`mb-1 truncate text-[10px] ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {getAgentLabel(preview, idx)}
                </div>
                {preview.screenshot ? (
                  <img src={preview.screenshot} alt="" className="h-20 w-full rounded object-cover" />
                ) : (
                  <div
                    className={`flex h-16 items-center justify-center rounded text-[11px] ${isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-500'}`}>
                    {preview.title || preview.url || 'No preview'}
                  </div>
                )}
                {!readOnly && (
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!preview.tabId}
                      className={`rounded px-1.5 py-0.5 text-[10px] ${isDarkMode ? 'bg-violet-700 text-white hover:bg-violet-600' : 'bg-violet-500 text-white hover:bg-violet-600'}`}
                      onClick={() => onOpenPreviewTab?.(preview.tabId)}>
                      Open
                    </button>
                    {preview.tabId && (
                      <button
                        type="button"
                        className={`rounded px-1.5 py-0.5 text-[10px] ${isDarkMode ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
                        onClick={() => onTakeControl?.(preview.tabId)}>
                        Take control
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : effectivePreview?.screenshot ? (
          <img src={effectivePreview.screenshot} alt="" className="w-full max-h-80 object-cover" />
        ) : (
          <div
            className={`flex flex-col items-center justify-center rounded min-h-[80px] px-3 py-4 ${isDarkMode ? 'bg-slate-800/30 text-slate-400' : 'bg-gray-50 text-gray-600'}`}>
            <div className="truncate text-sm max-w-full">
              {effectivePreview?.title ||
                effectivePreview?.url ||
                (readOnly ? 'No preview available' : 'Loading preview...')}
            </div>
            {effectivePreview?.tabId && !readOnly && (
              <div className="mt-1 text-[10px] opacity-60">Tab {effectivePreview.tabId}</div>
            )}
          </div>
        ))}
    </div>
  );
}
