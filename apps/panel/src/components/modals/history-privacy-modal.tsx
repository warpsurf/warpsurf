import { useEffect } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';

interface HistoryPrivacyModalProps {
  onAccept: () => void;
  onDecline: () => void;
  isDarkMode?: boolean;
  windowHours: number;
  maxRawItems: number;
  maxProcessedItems: number;
}

export default function HistoryPrivacyModal({
  onAccept,
  onDecline,
  isDarkMode = false,
  windowHours,
  maxRawItems,
  maxProcessedItems,
}: HistoryPrivacyModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onDecline(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDecline]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="History Privacy Warning">
      <div className="absolute inset-0 bg-black/60" onClick={onDecline} />
      <div className={`relative z-10 w-[92vw] max-w-lg rounded-lg border p-5 shadow-xl ${isDarkMode ? 'bg-slate-900 border-amber-700/50' : 'bg-white border-amber-300'}`}>
        <div className="space-y-3">
          <div className={`flex items-center gap-2 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
            <FiAlertTriangle className="h-5 w-5" />
            <h3 className="font-bold text-base">Privacy Warning: History Summarization</h3>
          </div>

          <p className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            Enabling this feature will send your browsing history to third-party AI services (OpenAI, Anthropic, etc.) for processing.
          </p>

          <ul className={`text-sm space-y-1 ml-4 list-disc ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            <li>Up to <strong>{maxRawItems.toLocaleString()}</strong> history items from the past <strong>{windowHours} hours</strong> will be fetched</li>
            <li>After filtering, up to <strong>{maxProcessedItems.toLocaleString()}</strong> unique URLs will be sent to the AI</li>
            <li>This includes URLs, page titles, and visit frequency</li>
          </ul>

          <p className={`text-xs p-2 rounded ${isDarkMode ? 'bg-amber-900/30 text-amber-300 border border-amber-700/50' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
            This data will be transmitted to external servers. The AI provider may log or retain this data according to their privacy policy.
          </p>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onDecline}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${isDarkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              Decline
            </button>
            <button
              type="button"
              onClick={onAccept}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${isDarkMode ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-amber-600 text-white hover:bg-amber-500'}`}
              autoFocus
            >
              Accept &amp; Enable
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
