import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface SpeechToTextModelConfig {
  provider: string;
  modelName: string;
  language?: string;
  autoSubmit?: boolean;
}

interface SpeechToTextRecord {
  config?: SpeechToTextModelConfig;
}

export type SpeechToTextStorage = BaseStorage<SpeechToTextRecord> & {
  getConfig: () => Promise<SpeechToTextModelConfig | undefined>;
  setConfig: (config: SpeechToTextModelConfig) => Promise<void>;
  resetConfig: () => Promise<void>;
};

const storage = createStorage<SpeechToTextRecord>(
  'speech-to-text-model',
  { config: undefined },
  { storageEnum: StorageEnum.Local, liveUpdate: true },
);

export const speechToTextModelStore: SpeechToTextStorage = {
  ...storage,
  getConfig: async () => {
    const data = await storage.get();
    return data.config;
  },
  setConfig: async (config: SpeechToTextModelConfig) => {
    if (!config.provider || !config.modelName) {
      throw new Error('Provider and model name must be specified');
    }
    await storage.set({ config });
  },
  resetConfig: async () => {
    await storage.set({ config: undefined });
  },
};

/** Hardcoded list of STT-capable models grouped by provider */
export const STT_MODELS = {
  openai: [
    { id: 'gpt-4o-transcribe', label: 'OpenAI – GPT-4o Transcribe' },
    { id: 'gpt-4o-mini-transcribe', label: 'OpenAI – GPT-4o Mini Transcribe' },
    { id: 'whisper-1', label: 'OpenAI – Whisper v1' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Google – Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Google – Gemini 2.5 Pro' },
  ],
} as const;
