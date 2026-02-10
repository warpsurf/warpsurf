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

  // Load current config and available providers; re-check on storage changes
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
    // Re-check when providers change (e.g., user adds API key in another tab)
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

  // Group models by provider for optgroup display
  const groupedByProvider = (Object.keys(STT_MODELS) as SttProviderKey[]).map(provider => ({
    provider,
    label: providerDisplayName[provider] || provider,
    enabled: availableProviders.has(provider),
    models: STT_MODELS[provider],
  }));

  const cardClass = `rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-100 bg-gray-50'} p-5`;
  const labelClass = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;
  const hintClass = `text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`;
  const inputClass = `w-full rounded-md border text-sm p-2 outline-none ${
    isDarkMode
      ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30'
      : 'border-gray-300 bg-white text-gray-700 focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30'
  }`;

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-1 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Voice Settings
        </h2>
        <p className={`mb-6 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Configure speech-to-text for voice input in the chat interface.
        </p>

        <div className="space-y-5">
          {/* Model selection */}
          <div className={cardClass}>
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
            {/* Show hint for disabled providers */}
            {groupedByProvider.some(g => !g.enabled) && (
              <p className={hintClass}>Greyed-out models require an API key. Add one in the API Keys tab.</p>
            )}
          </div>

          {/* Language hint */}
          <div className={cardClass}>
            <label htmlFor="stt-language" className={labelClass}>
              Language <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>(optional)</span>
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

          {/* Auto-submit toggle */}
          <div className={cardClass}>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Auto-submit after recording
                </span>
                <p className={hintClass}>Automatically send the transcribed text without manual review.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoSubmit}
                onClick={() => setAutoSubmit(v => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                  autoSubmit ? 'bg-violet-500' : isDarkMode ? 'bg-slate-600' : 'bg-gray-300'
                }`}>
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    autoSubmit ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-600">
              {saved ? '✓ Saved' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                isDarkMode
                  ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}>
              Reset to Default
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
