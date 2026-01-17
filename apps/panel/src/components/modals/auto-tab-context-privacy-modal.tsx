import { useEffect } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';

interface AutoTabContextPrivacyModalProps {
  onAccept: () => void;
  onDecline: () => void;
  isDarkMode?: boolean;
}

export default function AutoTabContextPrivacyModal({
  onAccept,
  onDecline,
  isDarkMode = false,
}: AutoTabContextPrivacyModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDecline();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDecline]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Auto Tab Context Privacy Warning">
      <div className="absolute inset-0 bg-black/60" onClick={onDecline} />
      <div
        className={`relative z-10 w-[92vw] max-w-lg rounded-lg border p-5 shadow-xl ${isDarkMode ? 'bg-slate-900 border-purple-700/50' : 'bg-white border-purple-300'}`}>
        <div className="space-y-3">
          <div className={`flex items-center gap-2 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`}>
            <FiAlertTriangle className="h-5 w-5" />
            <h3 className="font-bold text-base">Privacy Warning: Auto Tab Context</h3>
          </div>

          <p className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            Enabling this feature will automatically extract and send content from open tabs in your current browser
            window to third-party AI services.
          </p>

          <ul className={`text-sm space-y-1 ml-4 list-disc ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            <li>All valid tabs in your window may be included</li>
            <li>Content is limited based on your model's context window</li>
            <li>Includes page content, URLs, and titles</li>
          </ul>

          <p
            className={`text-xs p-2 rounded ${isDarkMode ? 'bg-purple-900/30 text-purple-300 border border-purple-700/50' : 'bg-purple-50 text-purple-700 border border-purple-200'}`}>
            This content will be transmitted to external AI servers with every request. Tabs blocked by your firewall
            settings will be excluded.
          </p>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onDecline}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${isDarkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'}`}>
              Decline
            </button>
            <button
              type="button"
              onClick={onAccept}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${isDarkMode ? 'bg-purple-600 text-white hover:bg-purple-500' : 'bg-purple-600 text-white hover:bg-purple-500'}`}
              autoFocus>
              Accept &amp; Enable
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
