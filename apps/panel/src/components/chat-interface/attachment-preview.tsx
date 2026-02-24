import { FiX, FiFile, FiImage, FiAlertCircle, FiClock } from 'react-icons/fi';
import { formatFileSize } from '@extension/shared/lib/utils/file-processor';
import type { PendingAttachment } from '@extension/shared/lib/utils/file-processor';
import type { Attachment } from '@extension/storage/lib/chat/types';

/** Renders pending attachments in the chat input area */
export function PendingAttachmentStrip({
  attachments,
  onRemove,
  isDarkMode,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  isDarkMode: boolean;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-2 py-1.5">
      {attachments.map(a => (
        <div
          key={a.id}
          className={`relative group flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-all animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ${
            a.status === 'error'
              ? isDarkMode
                ? 'bg-red-900/40 text-red-300 border border-red-700/50'
                : 'bg-red-50 text-red-600 border border-red-200'
              : a.status === 'loading'
                ? isDarkMode
                  ? 'bg-slate-700/60 text-slate-300 border border-slate-600/50'
                  : 'bg-gray-100 text-gray-500 border border-gray-200'
                : a.ephemeral
                  ? isDarkMode
                    ? 'bg-amber-900/30 text-amber-200 border border-amber-700/40'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                  : isDarkMode
                    ? 'bg-slate-700 text-slate-200 border border-slate-600/50'
                    : 'bg-gray-100 text-gray-700 border border-gray-200'
          }`}>
          {a.status === 'loading' ? (
            <span className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin border-current" />
          ) : a.status === 'error' ? (
            <FiAlertCircle className="w-3 h-3 flex-shrink-0" />
          ) : a.type === 'image' && a.thumbnailDataUrl ? (
            <img src={a.thumbnailDataUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
          ) : a.type === 'image' ? (
            <FiImage className="w-3 h-3 flex-shrink-0" />
          ) : (
            <FiFile className="w-3 h-3 flex-shrink-0" />
          )}

          <span className="truncate max-w-[100px]" title={a.filename}>
            {a.filename}
          </span>
          <span className="text-[10px] opacity-60">{formatFileSize(a.size)}</span>

          {a.ephemeral && a.status === 'ready' && (
            <FiClock className="w-2.5 h-2.5 opacity-60" title="Session only — too large to save" />
          )}

          {a.status === 'error' && a.error && (
            <span className="text-[10px] opacity-80 truncate max-w-[80px]" title={a.error}>
              {a.error}
            </span>
          )}

          <button
            type="button"
            onClick={() => onRemove(a.id)}
            className={`ml-0.5 rounded-full p-0.5 opacity-60 hover:opacity-100 transition-opacity ${
              isDarkMode ? 'hover:bg-slate-600' : 'hover:bg-gray-200'
            }`}>
            <FiX className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Renders attachment chips in sent messages (MessageBlock) */
export function AttachmentChip({ attachments, isDarkMode }: { attachments: Attachment[]; isDarkMode: boolean }) {
  if (attachments.length === 0) return null;

  const images = attachments.filter(a => a.type === 'image');
  const docs = attachments.filter(a => a.type === 'document');
  const allExpired = attachments.every(a => a.ephemeral && !a.dataUrl);

  const label = (() => {
    const parts: string[] = [];
    if (images.length) parts.push(`${images.length} image${images.length > 1 ? 's' : ''}`);
    if (docs.length) parts.push(`${docs.length} file${docs.length > 1 ? 's' : ''}`);
    return parts.join(', ');
  })();

  return (
    <span className="relative ml-1 align-middle inline-flex group/attach">
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full cursor-default text-[10px] font-medium ${
          allExpired
            ? isDarkMode
              ? 'bg-slate-700/60 text-slate-400 border border-slate-600/50'
              : 'bg-gray-100 text-gray-400 border border-gray-200'
            : isDarkMode
              ? 'bg-blue-900/60 text-blue-200 border border-blue-700/50'
              : 'bg-blue-100/80 text-blue-600 border border-blue-200/50'
        }`}>
        {allExpired ? <FiClock size={9} /> : <FiFile size={9} />}
        <span>{label}</span>
      </span>

      {/* Tooltip */}
      <span
        className={`absolute left-0 top-full mt-2 rounded-lg text-[11px] z-[1000] shadow-lg min-w-[180px] max-w-[280px] hidden group-hover/attach:block ${
          isDarkMode
            ? 'bg-slate-800 text-slate-200 border border-slate-600/50'
            : 'bg-white text-gray-700 border border-gray-200/70'
        }`}>
        <span className="block px-3 py-2 space-y-1.5">
          <span className={`block text-[10px] font-medium ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
            Attachments
          </span>
          {attachments.map(a => {
            const expired = a.ephemeral && !a.dataUrl;
            return (
              <span key={a.id} className={`flex items-center gap-2 ${expired ? 'opacity-50' : ''}`}>
                {a.type === 'image' && a.thumbnailDataUrl ? (
                  <img src={a.thumbnailDataUrl} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0" />
                ) : a.type === 'image' ? (
                  <FiImage className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <FiFile className="w-4 h-4 flex-shrink-0" />
                )}
                <span className="flex-1 truncate">{a.filename}</span>
                <span className="text-[9px] opacity-60">{formatFileSize(a.size)}</span>
                {expired && <FiClock className="w-3 h-3 opacity-50" title="No longer available" />}
              </span>
            );
          })}
          {allExpired && (
            <span className={`block text-[9px] italic ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
              Files were too large to save and are no longer available
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

/** Inline image previews for user messages */
export function InlineAttachmentGallery({
  attachments,
  isDarkMode,
}: {
  attachments: Attachment[];
  isDarkMode: boolean;
}) {
  const withData = attachments.filter(a => a.type === 'image' && (a.thumbnailDataUrl || a.dataUrl));
  if (withData.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1 mb-0.5">
      {withData.map(a => (
        <img
          key={a.id}
          src={a.thumbnailDataUrl || a.dataUrl}
          alt={a.filename}
          title={a.filename}
          className={`w-12 h-12 rounded-md object-cover border ${isDarkMode ? 'border-slate-600' : 'border-gray-200'}`}
        />
      ))}
    </div>
  );
}
