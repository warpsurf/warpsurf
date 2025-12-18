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

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Live Pricing & Model Data
        </h2>

        <div className="space-y-4">
          <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            Warpsurf can use live model and pricing data from external APIs (OpenRouter and Helicone). This improves the accuracy of the available models list and pricing estimates. You can choose between using live data or offline cached data.
          </p>

          <div
            className={`rounded-md p-4 ${isDarkMode ? 'bg-slate-700/50 border border-slate-600' : 'bg-blue-50 border border-blue-200'}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  Use live pricing data
                </h3>
                <p className={`text-sm mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {settings.useLivePricingData
                    ? 'Currently periodically fetching live model lists and pricing from OpenRouter and Helicone APIs'
                    : 'Currently using cached data bundled with the extension'}
                </p>
                {isRefreshing && (
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
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
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isRefreshing
                        ? 'opacity-50 cursor-not-allowed'
                        : isDarkMode
                          ? 'bg-blue-600 text-white hover:bg-blue-500'
                          : 'bg-blue-600 text-white hover:bg-blue-500'
                    }`}>
                    {isRefreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                )}
                <div className="relative inline-flex cursor-pointer items-center">
                  <input
                    id="useLivePricingData"
                    type="checkbox"
                    checked={settings.useLivePricingData}
                    disabled={isRefreshing}
                    onChange={e => handleLivePricingToggle(e.target.checked)}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor="useLivePricingData"
                    className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 ${isRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <span className="sr-only">Use live pricing data</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div
              className={`rounded-md p-3 ${isDarkMode ? 'bg-green-900/20 border border-green-800' : 'bg-green-50 border border-green-200'}`}>
              <h4 className={`text-sm font-medium ${isDarkMode ? 'text-green-300' : 'text-green-800'}`}>
                Live Data (Recommended)
              </h4>
              <ul className={`text-xs mt-1 space-y-0.5 ${isDarkMode ? 'text-green-400' : 'text-green-700'}`}>
                <li>• Up-to-date model availability</li>
                <li>• More accurate pricing estimates</li>
              </ul>
            </div>
            <div
              className={`rounded-md p-3 ${isDarkMode ? 'bg-slate-700/50 border border-slate-600' : 'bg-gray-50 border border-gray-200'}`}>
              <h4 className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Cached Data
              </h4>
              <ul className={`text-xs mt-1 space-y-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <li>• No external requests</li>
                <li>• Uses data that may become outdated</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          About the Data Sources
        </h2>

        <div className="space-y-3">
          <div>
            <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>OpenRouter API</h3>
            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Provides model listings and pricing for OpenRouter provider. Visit{' '}
              <a
                href="https://openrouter.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline">
                openrouter.ai
              </a>
            </p>
          </div>
          <div>
            <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Helicone API</h3>
            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Provides model listings and pricing for OpenAI, Anthropic, Google, and xAI. Visit{' '}
              <a
                href="https://helicone.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline">
                helicone.ai
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
