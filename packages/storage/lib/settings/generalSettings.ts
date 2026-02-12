import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for general settings configuration
export interface GeneralSettingsConfig {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  maxValidatorFailures: number;
  retryDelay: number;
  maxInputTokens: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  planningInterval: number;
  displayHighlights: boolean;
  minWaitPageLoad: number;
  replayHistoricalTasks: boolean;
  maxWorkerAgents: number;
  fullPageWindow: boolean;
  // When true, use full Planner→Navigator→Validator pipeline for browsing; otherwise Navigator-only
  useFullPlanningPipeline: boolean;
  // Fine-grained role toggles for single-agent workflow (default: only navigator)
  enablePlanner?: boolean;
  enableValidator?: boolean;
  // Fine-grained role toggles for multi-agent workflow (default: false)
  enableMultiagentPlanner?: boolean;
  enableMultiagentValidator?: boolean;
  // When true, show tab previews (low-FPS mirroring) in the chat UI; when false, show URL/title only
  showTabPreviews?: boolean;
  // History context settings
  historySummaryWindowHours?: number;
  historySummaryMaxRawItems?: number;
  historySummaryMaxProcessedItems?: number;
  enableHistoryContext?: boolean;
  // Workflow estimation settings
  enableWorkflowEstimation?: boolean;
  // Emergency stop button visibility
  showEmergencyStop?: boolean;
  // Response timeout for LLM calls (Chat, Auto, Search workflows)
  responseTimeoutSeconds?: number;
  // Auto tab context (power user feature)
  enableAutoTabContext?: boolean;
  // Theme mode: 'auto' follows system, 'light' or 'dark' overrides system preference
  themeMode?: 'auto' | 'light' | 'dark';
}

export type GeneralSettingsStorage = BaseStorage<GeneralSettingsConfig> & {
  updateSettings: (settings: Partial<GeneralSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<GeneralSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

// Default settings
export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsConfig = {
  maxSteps: 100,
  maxActionsPerStep: 5,
  maxFailures: 3,
  maxValidatorFailures: 3,
  retryDelay: 10,
  maxInputTokens: 128000,
  useVision: false,
  useVisionForPlanner: false,
  planningInterval: 5,
  displayHighlights: false,
  minWaitPageLoad: 2000,
  replayHistoricalTasks: false,
  maxWorkerAgents: 5, // When enabled, use up to 5 parallel workers
  fullPageWindow: false,
  useFullPlanningPipeline: false,
  enablePlanner: false,
  enableValidator: false,
  enableMultiagentPlanner: false,
  enableMultiagentValidator: false,
  showTabPreviews: true,
  historySummaryWindowHours: 24,
  historySummaryMaxRawItems: 1000,
  historySummaryMaxProcessedItems: 50,
  enableHistoryContext: false,
  enableWorkflowEstimation: false,
  showEmergencyStop: true,
  responseTimeoutSeconds: 60, // 2 minutes default for LLM response timeout
  // Auto tab context (disabled by default, privacy-first)
  enableAutoTabContext: false,
  // Theme mode defaults to auto (follows system preference)
  themeMode: 'auto',
};

const storage = createStorage<GeneralSettingsConfig>('general-settings', DEFAULT_GENERAL_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const generalSettingsStore: GeneralSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<GeneralSettingsConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_GENERAL_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    // Tie highlights to Vision: when Vision is enabled, highlights are on; when disabled, highlights off
    if (typeof settings.useVision === 'boolean') {
      updatedSettings.displayHighlights = settings.useVision;
    }

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      ...settings,
    };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_GENERAL_SETTINGS);
  },
};
