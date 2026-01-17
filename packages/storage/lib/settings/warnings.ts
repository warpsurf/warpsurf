import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface WarningsSettings {
  hasAcceptedFirstRun: boolean;
  disablePerChatWarnings: boolean;
  hasAcceptedHistoryPrivacyWarning: boolean;
  /** Whether user has responded to the live pricing data prompt */
  hasRespondedToLivePricingPrompt: boolean;
  /** When true, fetch live data from APIs; when false, use bundled cache */
  useLivePricingData: boolean;
  /** Whether user has accepted the auto tab context privacy warning */
  hasAcceptedAutoTabContextPrivacyWarning: boolean;
}

export type WarningsSettingsStorage = BaseStorage<WarningsSettings> & {
  updateWarnings: (settings: Partial<WarningsSettings>) => Promise<void>;
  getWarnings: () => Promise<WarningsSettings>;
  resetToDefaults: () => Promise<void>;
};

export const DEFAULT_WARNINGS_SETTINGS: WarningsSettings = {
  hasAcceptedFirstRun: false,
  disablePerChatWarnings: false,
  hasAcceptedHistoryPrivacyWarning: false,
  hasRespondedToLivePricingPrompt: false,
  useLivePricingData: false, // Default to cached (privacy-first)
  hasAcceptedAutoTabContextPrivacyWarning: false,
};

const storage = createStorage<WarningsSettings>('warnings-settings', DEFAULT_WARNINGS_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const warningsSettingsStore: WarningsSettingsStorage = {
  ...storage,
  async updateWarnings(settings: Partial<WarningsSettings>) {
    const currentSettings = (await storage.get()) || DEFAULT_WARNINGS_SETTINGS;
    const updatedSettings: WarningsSettings = {
      ...currentSettings,
      ...settings,
    };
    await storage.set(updatedSettings);
  },
  async getWarnings() {
    const settings = await storage.get();
    return {
      ...DEFAULT_WARNINGS_SETTINGS,
      ...settings,
    };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_WARNINGS_SETTINGS);
  },
};
