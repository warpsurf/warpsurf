import { useEffect, useState } from 'react';
import { warningsSettingsStore, type WarningsSettings, DEFAULT_WARNINGS_SETTINGS } from '@extension/storage';

export const Warnings = ({ isDarkMode = false }: { isDarkMode?: boolean }) => {
  const [settings, setSettings] = useState<WarningsSettings>(DEFAULT_WARNINGS_SETTINGS);

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

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Warnings
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Disable warnings
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Disable warnings for each new chat
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="disablePerChatWarnings"
                type="checkbox"
                checked={settings.disablePerChatWarnings}
                onChange={e => update({ disablePerChatWarnings: e.target.checked })}
                className="peer sr-only"
              />
              <label
                htmlFor="disablePerChatWarnings"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">Disable warnings</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};


