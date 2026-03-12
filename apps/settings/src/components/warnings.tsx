import { useEffect, useState } from 'react';
import { warningsSettingsStore, type WarningsSettings, DEFAULT_WARNINGS_SETTINGS } from '@extension/storage';
import { SaveIndicator, useSaveIndicator } from './primitives';

export const Warnings = ({ isDarkMode = false }: { isDarkMode?: boolean }) => {
  const [settings, setSettings] = useState<WarningsSettings>(DEFAULT_WARNINGS_SETTINGS);
  const saved = useSaveIndicator();

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

  const toggle = async () => {
    const newValue = !settings.disablePerChatWarnings;
    setSettings(prev => ({ ...prev, disablePerChatWarnings: newValue }));
    await warningsSettingsStore.updateWarnings({ disablePerChatWarnings: newValue });
    saved.trigger();
  };

  const cardClass = `rounded-xl border p-5 ${isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]'}`;

  return (
    <section className="space-y-5">
      <div className={cardClass}>
        <h2
          className={`mb-4 flex items-center gap-2 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          Warnings
          <SaveIndicator show={saved.show} isDarkMode={isDarkMode} />
        </h2>

        <div className="flex items-center justify-between">
          <div>
            <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Disable per-chat warnings
            </span>
            <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              Skip warnings for each new chat
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            className={`toggle-slider ${settings.disablePerChatWarnings ? 'toggle-on' : 'toggle-off'}`}
            aria-pressed={settings.disablePerChatWarnings}>
            <span className="toggle-knob" />
          </button>
        </div>
      </div>
    </section>
  );
};
