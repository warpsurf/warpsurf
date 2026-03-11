import { useEffect, useState } from 'react';
import { generalSettingsStore, type GeneralSettingsConfig, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';

interface TabsSettingsProps {
  isDarkMode?: boolean;
}

export function TabsSettings({ isDarkMode = false }: TabsSettingsProps) {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const currentSettings = await generalSettingsStore.getSettings();
        setSettings(currentSettings);
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    };

    loadSettings();

    let unsub: (() => void) | undefined;
    try {
      unsub = generalSettingsStore.subscribe(loadSettings);
    } catch {}

    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, []);

  const handleAutoTabContextToggle = async () => {
    const newValue = !settings.enableAutoTabContext;
    setSettings(prev => ({ ...prev, enableAutoTabContext: newValue }));
    await generalSettingsStore.updateSettings({ enableAutoTabContext: newValue });
  };

  const cardClass = `rounded-xl border p-5 text-left ${isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]'}`;

  return (
    <section className="flex flex-col space-y-5">
      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
              Auto Tab Context
            </h2>
            <p className={`text-sm mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {settings.enableAutoTabContext
                ? 'Automatically includes content from all open tabs as context for AI requests.'
                : 'Enable to include all open tabs as context. Can also be toggled from the panel dropdown.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleAutoTabContextToggle}
            className={`toggle-slider ${settings.enableAutoTabContext ? 'toggle-on' : 'toggle-off'}`}
            aria-pressed={settings.enableAutoTabContext}>
            <span className="toggle-knob" />
          </button>
        </div>

        {settings.enableAutoTabContext && (
          <div className={`mt-4 pt-4 border-t ${isDarkMode ? 'border-[#3a3a34]' : 'border-[#e5e4de]'}`}>
            <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <li>All tabs allowed by your firewall settings are included by default.</li>
              <li>Specific tabs can be excluded from the panel dropdown.</li>
              <li>With many tabs open this can be expensive: includes page content, URLs, and titles.</li>
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
