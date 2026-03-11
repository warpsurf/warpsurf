import { useEffect, useState } from 'react';
import {
  speechToTextModelStore,
  secureProviderClient,
  STT_MODELS,
  type SpeechToTextModelConfig,
} from '@extension/storage';

interface VoiceSettingsProps {
  isDarkMode?: boolean;
}

type SttProviderKey = keyof typeof STT_MODELS;

export const VoiceSettings = ({ isDarkMode = false }: VoiceSettingsProps) => {
  const [selectedModel, setSelectedModel] = useState('');
  const [language, setLanguage] = useState('');
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [config, providers] = await Promise.all([
          speechToTextModelStore.getConfig(),
          secureProviderClient.getAllProviders(),
        ]);
        if (!mounted) return;
        if (config?.provider && config?.modelName) {
          setSelectedModel(`${config.provider}>${config.modelName}`);
        }
        setLanguage(config?.language || '');
        setAutoSubmit(!!config?.autoSubmit);
        setAvailableProviders(new Set(Object.keys(providers)));
      } catch {}
    };
    load();
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes['llm-api-keys']) load();
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleSave = async () => {
    try {
      if (!selectedModel) {
        await speechToTextModelStore.resetConfig();
      } else {
        const [provider, modelName] = selectedModel.split('>');
        const config: SpeechToTextModelConfig = {
          provider,
          modelName,
          autoSubmit,
          ...(language.trim() && { language: language.trim() }),
        };
        await speechToTextModelStore.setConfig(config);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save voice settings:', e);
    }
  };

  const handleReset = async () => {
    try {
      await speechToTextModelStore.resetConfig();
      setSelectedModel('');
      setLanguage('');
      setAutoSubmit(false);
    } catch {}
  };

  const providerDisplayName: Record<string, string> = {
    openai: 'OpenAI',
    gemini: 'Gemini (Google)',
  };

  const groupedByProvider = (Object.keys(STT_MODELS) as SttProviderKey[]).map(provider => ({
    provider,
    label: providerDisplayName[provider] || provider,
    enabled: availableProviders.has(provider),
    models: STT_MODELS[provider],
  }));

  const cardClass = `rounded-xl border p-5 ${isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]'}`;
  const innerCardClass = `rounded-lg border p-4 ${isDarkMode ? 'border-[#3a3a34] bg-[#252522]' : 'border-[#e5e4de] bg-[#f3f2ee]'}`;
  const labelClass = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;
  const hintClass = `text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`;
  const inputClass = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isDarkMode ? 'border-[#3a3a34] bg-[#1d1d1a] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'
  }`;
  const btnClass = `rounded-lg px-4 py-2 text-sm font-medium ${
    isDarkMode ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]' : 'bg-[#ecebe5] text-gray-800 hover:bg-[#dfddd4]'
  }`;

  return (
    <section className="space-y-5">
      <div className={cardClass}>
        <h2 className={`mb-1 text-base font-semibold text-left ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          Voice Settings
        </h2>
        <p className={`mb-5 text-sm text-left ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Configure speech-to-text for voice input in the chat interface.
        </p>

        <div className="space-y-4">
          <div className={innerCardClass}>
            <label htmlFor="stt-model" className={labelClass}>
              Speech-to-Text Model
            </label>
            <select
              id="stt-model"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className={inputClass}>
              <option value="">None (voice input disabled)</option>
              {groupedByProvider.map(group => (
                <optgroup key={group.provider} label={group.label}>
                  {group.models.map(m => (
                    <option key={m.id} value={`${group.provider}>${m.id}`} disabled={!group.enabled}>
                      {m.label}
                      {!group.enabled ? ' (API key required)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {groupedByProvider.some(g => !g.enabled) && (
              <p className={hintClass}>Greyed-out models require an API key. Add one in the API Keys tab.</p>
            )}
          </div>

          <div className={innerCardClass}>
            <label htmlFor="stt-language" className={labelClass}>
              Language <span className={isDarkMode ? 'text-gray-500' : 'text-gray-500'}>(optional)</span>
            </label>
            <input
              id="stt-language"
              type="text"
              value={language}
              onChange={e => setLanguage(e.target.value)}
              placeholder="en"
              maxLength={10}
              className={`${inputClass} max-w-[120px]`}
            />
            <p className={hintClass}>ISO 639-1 language code hint for improved accuracy (e.g., en, fr, de, ja).</p>
          </div>

          <div className={innerCardClass}>
            <div className="flex items-center justify-between">
              <div className="text-left">
                <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Auto-submit after recording
                </span>
                <p className={hintClass}>Automatically send the transcribed text without manual review.</p>
              </div>
              <button
                type="button"
                onClick={() => setAutoSubmit(v => !v)}
                className={`toggle-slider ${autoSubmit ? 'toggle-on' : 'toggle-off'}`}
                aria-pressed={autoSubmit}>
                <span className="toggle-knob" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button type="button" onClick={handleSave} className={btnClass}>
              {saved ? 'Saved' : 'Save'}
            </button>
            <button type="button" onClick={handleReset} className={btnClass}>
              Reset to Default
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
