import { useEffect, useState } from 'react';
import { warningsSettingsStore, type WarningsSettings, DEFAULT_WARNINGS_SETTINGS } from '@extension/storage';

export const PricingDataSettings = ({ isDarkMode = false }: { isDarkMode?: boolean }) => {
  const [settings, setSettings] = useState<WarningsSettings>(DEFAULT_WARNINGS_SETTINGS);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const s = await warningsSettingsStore.getWarnings();
        if (mounted) setSettings(s);
      } catch {}
    };
    load();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = warningsSettingsStore.subscribe(load);
    } catch {}
    return () => {
      mounted = false;
      try {
        unsubscribe && unsubscribe();
      } catch {}
    };
  }, []);

  const update = async (patch: Partial<WarningsSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
    await warningsSettingsStore.updateWarnings(patch);
  };

  const handleLivePricingToggle = async (useLive: boolean) => {
    setIsRefreshing(true);
    await update({ useLivePricingData: useLive, hasRespondedToLivePricingPrompt: true });
    try {
      await chrome.runtime.sendMessage({ type: 'reinitialize_model_registry' });
    } catch {}
    setIsRefreshing(false);
  };

  const handleRefreshPricingData = async () => {
    setIsRefreshing(true);
    try {
      await chrome.runtime.sendMessage({ type: 'refresh_model_registry' });
    } catch {}
    setIsRefreshing(false);
  };

  const cardClass = `rounded-xl border p-5 text-left ${isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]'}`;
  const innerCardClass = `rounded-lg border p-4 ${isDarkMode ? 'border-[#3a3a34] bg-[#252522]' : 'border-[#e5e4de] bg-[#f3f2ee]'}`;
  const btnClass = `rounded-lg px-3 py-1.5 text-sm font-medium ${
    isDarkMode ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]' : 'bg-[#ecebe5] text-gray-800 hover:bg-[#dfddd4]'
  }`;

  return (
    <section className="space-y-5">
      <div className={cardClass}>
        <h2 className={`mb-4 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          Live Pricing & Model Data
        </h2>

        <div className="space-y-4">
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Warpsurf can use live model and pricing data from external APIs (OpenRouter and Helicone). This improves the
            accuracy of the available models list and pricing estimates. You can choose between using live data or
            offline cached data.
          </p>

          <div className={innerCardClass}>
            <div className="flex items-start justify-between">
              <div className="flex-1 text-left">
                <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  Use live pricing data
                </h3>
                <p className={`text-sm mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {settings.useLivePricingData
                    ? 'Currently periodically fetching live model lists and pricing from OpenRouter and Helicone APIs'
                    : 'Currently using cached data bundled with the extension'}
                </p>
                {isRefreshing && (
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    Updating model data...
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 ml-4">
                {settings.useLivePricingData && (
                  <button
                    type="button"
                    onClick={handleRefreshPricingData}
                    disabled={isRefreshing}
                    className={`${btnClass} ${isRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    {isRefreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleLivePricingToggle(!settings.useLivePricingData)}
                  disabled={isRefreshing}
                  className={`toggle-slider ${settings.useLivePricingData ? 'toggle-on' : 'toggle-off'} ${isRefreshing ? 'opacity-50' : ''}`}
                  aria-pressed={settings.useLivePricingData}>
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div
              className={`rounded-lg border p-3 text-left ${
                isDarkMode ? 'border-[#3a4a3a] bg-[#1d251d]' : 'border-[#d5ddd5] bg-[#f5fbf5]'
              }`}>
              <h4 className={`text-sm font-medium ${isDarkMode ? 'text-green-300' : 'text-green-800'}`}>
                Live Data (Recommended)
              </h4>
              <ul className={`text-xs mt-1 space-y-0.5 ${isDarkMode ? 'text-green-400' : 'text-green-700'}`}>
                <li>• Up-to-date model availability</li>
                <li>• More accurate pricing estimates</li>
              </ul>
            </div>
            <div
              className={`rounded-lg border p-3 text-left ${
                isDarkMode ? 'border-[#3a3a34] bg-[#252522]' : 'border-[#e5e4de] bg-[#f3f2ee]'
              }`}>
              <h4 className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Cached Data</h4>
              <ul className={`text-xs mt-1 space-y-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <li>• No external requests</li>
                <li>• Uses data that may become outdated</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className={cardClass}>
        <h2 className={`mb-4 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          About the Data Sources
        </h2>

        <div className="space-y-3">
          <div>
            <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>OpenRouter API</h3>
            <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              Provides model listings and pricing for OpenRouter provider. Visit{' '}
              <a
                href="https://openrouter.ai"
                target="_blank"
                rel="noopener noreferrer"
                className={isDarkMode ? 'text-gray-400 underline' : 'text-gray-600 underline'}>
                openrouter.ai
              </a>
            </p>
          </div>
          <div>
            <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Helicone API</h3>
            <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              Provides model listings and pricing for OpenAI, Anthropic, Google, and xAI. Visit{' '}
              <a
                href="https://helicone.ai"
                target="_blank"
                rel="noopener noreferrer"
                className={isDarkMode ? 'text-gray-400 underline' : 'text-gray-600 underline'}>
                helicone.ai
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
