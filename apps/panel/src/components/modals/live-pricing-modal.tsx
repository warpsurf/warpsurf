import { useEffect } from 'react';
import {
  LIVE_PRICING_DISCLAIMER_TITLE,
  LIVE_PRICING_DISCLAIMER_MESSAGE,
  LIVE_PRICING_OPTION_LIVE,
  LIVE_PRICING_OPTION_LIVE_DESC,
  LIVE_PRICING_OPTION_CACHED,
  LIVE_PRICING_OPTION_CACHED_DESC,
} from '@extension/shared';

interface LivePricingModalProps {
  isDarkMode?: boolean;
  onChooseLive: () => void;
  onChooseCached: () => void;
}

export default function LivePricingModal({ isDarkMode = false, onChooseLive, onChooseCached }: LivePricingModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1') { e.preventDefault(); onChooseLive(); }
      if (e.key === '2') { e.preventDefault(); onChooseCached(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onChooseLive, onChooseCached]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={LIVE_PRICING_DISCLAIMER_TITLE}>
      <div className="absolute inset-0 bg-black/60" />
      <div className={`relative z-10 w-[92vw] max-w-md rounded-lg border p-5 shadow-xl ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'}`}>
        <div className="space-y-4">
          <img src="/warpsurflogo_tagline.png" alt="warpsurf Logo" className="mx-auto mb-2 h-10 w-auto" />
          
          <h2 className={`text-center text-lg font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
            {LIVE_PRICING_DISCLAIMER_TITLE}
          </h2>
          
          <p className={`text-sm whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {LIVE_PRICING_DISCLAIMER_MESSAGE}
          </p>
          
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={onChooseLive}
              className={`w-full rounded-md p-3 text-left transition-colors ${
                isDarkMode 
                  ? 'bg-blue-900/50 border border-blue-700 hover:bg-blue-800/60' 
                  : 'bg-blue-50 border border-blue-200 hover:bg-blue-100'
              }`}
            >
              <div className={`font-medium ${isDarkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                {LIVE_PRICING_OPTION_LIVE}
              </div>
              <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-blue-300/80' : 'text-blue-700/80'}`}>
                {LIVE_PRICING_OPTION_LIVE_DESC}
              </div>
            </button>
            
            <button
              type="button"
              onClick={onChooseCached}
              className={`w-full rounded-md p-3 text-left transition-colors ${
                isDarkMode 
                  ? 'bg-slate-800 border border-slate-600 hover:bg-slate-700' 
                  : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <div className={`font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                {LIVE_PRICING_OPTION_CACHED}
              </div>
              <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {LIVE_PRICING_OPTION_CACHED_DESC}
              </div>
            </button>
          </div>
          
          <p className={`text-xs text-center ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            You can change this later in Settings → Pricing & Model Data
          </p>
        </div>
      </div>
    </div>
  );
}

