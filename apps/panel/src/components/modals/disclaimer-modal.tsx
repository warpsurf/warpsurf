import { useEffect } from 'react';

export default function DisclaimerModal({ message, extraNote, onAccept, isDarkMode = false }: { message: string; extraNote?: string; onAccept: () => void; isDarkMode?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAccept(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onAccept]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Disclaimer">
      <div className="absolute inset-0 bg-black/60" />
      <div className={`relative z-10 w-[92vw] max-w-lg rounded-lg border p-5 shadow-xl ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'}`}>
        <div className="space-y-3">
          <img src="/warpsurflogo_tagline.png" alt="warpsurf Logo" className="mx-auto mb-2 h-12 w-auto" />
          <p className={`text-sm text-justify ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{message}</p>
          {extraNote && (
            <p className={`text-xs text-justify whitespace-pre-line ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{extraNote}</p>
          )}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={onAccept}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${isDarkMode ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
              autoFocus
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


