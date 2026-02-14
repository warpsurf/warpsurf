/*
 * Agent Settings Component
 * This component combines General settings with Model selection functionality
 * Organized by chat option with color-coded sections (Triage = black, Agent = yellow, etc.)
 */
import { useEffect, useState, useCallback } from 'react';
import { FaRobot, FaRandom, FaLightbulb } from 'react-icons/fa';
import {
  generalSettingsStore,
  secureProviderClient,
  agentModelStore,
  AgentNameEnum,
  llmProviderModelNames,
  ProviderTypeEnum,
  DEFAULT_GENERAL_SETTINGS,
  type GeneralSettingsConfig,
  type ProviderConfig,
  type ThinkingLevel,
} from '@extension/storage';
import { hasModelPricing, initializeCostCalculator } from '../../../background/src/utils/cost-calculator';
import { ModelSelect } from './model-select';
import { GlobalSettings } from './global-settings';
import { AgentModelsSection } from './agent-models-section';
import { SingleModelSection } from './single-model-section';
import { isThinkingCapableModel, useSaveIndicator } from './primitives';
import {
  getAgentDisplayName,
  getAgentDescription,
  getAgentSectionColor,
  createInitialSelectedModels,
  createInitialModelParameters,
  createInitialThinkingLevel,
  createInitialWebSearchEnabled,
} from './agent-helpers';

interface AgentSettingsProps {
  isDarkMode?: boolean;
}

export const AgentSettings = ({ isDarkMode = false }: AgentSettingsProps) => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [selectedModels, setSelectedModels] = useState<Record<AgentNameEnum, string>>(createInitialSelectedModels);
  const [modelParameters, setModelParameters] =
    useState<Record<AgentNameEnum, { temperature: number | undefined; maxOutputTokens: number }>>(
      createInitialModelParameters,
    );
  const [thinkingLevel, setThinkingLevel] =
    useState<Record<AgentNameEnum, ThinkingLevel | undefined>>(createInitialThinkingLevel);
  const [webSearchEnabled, setWebSearchEnabled] =
    useState<Record<AgentNameEnum, boolean>>(createInitialWebSearchEnabled);

  const [availableModels, setAvailableModels] = useState<
    Array<{ provider: string; providerName: string; model: string }>
  >([]);

  // Ensure we only auto-apply defaults once on first provider add
  const [hasAppliedInitialDefaults, setHasAppliedInitialDefaults] = useState<boolean>(false);

  // State for cost calculator initialization
  const [costCalculatorReady, setCostCalculatorReady] = useState<boolean>(false);
  // Guardrail override: allow showing models without pricing data
  const [showAllModels, setShowAllModels] = useState<boolean>(true);

  // Global model selection (apply same model to all visible agent roles)
  const [globalModelValue, setGlobalModelValue] = useState<string>('');
  const [globalModelParameters, setGlobalModelParameters] = useState<{
    temperature: number | undefined;
    maxOutputTokens: number;
    thinkingLevel: ThinkingLevel;
  }>({
    temperature: undefined,
    maxOutputTokens: 8192,
    thinkingLevel: 'default',
  });
  const globalSaveIndicator = useSaveIndicator();

  // Load general settings and subscribe to changes
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

    // Subscribe to settings changes from other sources (e.g., panel UI)
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

  // Load providers and listen for storage changes
  useEffect(() => {
    const loadProviders = async () => {
      try {
        const allProviders = await secureProviderClient.getAllProviders();
        setProviders(allProviders);
      } catch (error) {
        console.error('Error loading providers:', error);
        setProviders({});
      }
    };

    loadProviders();

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && changes['llm-api-keys']) {
        loadProviders();
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Load existing agent models and parameters, and listen for storage changes
  useEffect(() => {
    const loadAgentModels = async () => {
      try {
        const models: Record<AgentNameEnum, string> = {
          [AgentNameEnum.AgentPlanner]: '',
          [AgentNameEnum.MultiagentPlanner]: '',
          [AgentNameEnum.MultiagentWorker]: '',
          [AgentNameEnum.AgentNavigator]: '',
          [AgentNameEnum.AgentValidator]: '',
          [AgentNameEnum.Auto]: '',
          [AgentNameEnum.Chat]: '',
          [AgentNameEnum.Search]: '',
          [AgentNameEnum.MultiagentRefiner]: '',
          [AgentNameEnum.HistorySummariser]: '',
        } as Record<AgentNameEnum, string>;

        for (const agent of Object.values(AgentNameEnum)) {
          const config = await agentModelStore.getAgentModel(agent);
          if (config) {
            models[agent] = `${config.provider}>${config.modelName}`;
            setModelParameters(prev => ({
              ...prev,
              [agent]: {
                temperature: config.parameters?.temperature as number | undefined,
                maxOutputTokens: (config.parameters?.maxOutputTokens as number) ?? prev[agent].maxOutputTokens,
              },
            }));
            if (config.thinkingLevel) {
              setThinkingLevel(prev => ({ ...prev, [agent]: config.thinkingLevel }));
            }
            if (config.webSearch !== undefined) {
              setWebSearchEnabled(prev => ({ ...prev, [agent]: config.webSearch || false }));
            }
          }
        }
        setSelectedModels(models);

        // Sync global model selector with Auto agent (used as reference)
        const autoConfig = await agentModelStore.getAgentModel(AgentNameEnum.Auto);
        if (autoConfig?.provider && autoConfig?.modelName) {
          setGlobalModelValue(`${autoConfig.provider}>${autoConfig.modelName}`);
          setGlobalModelParameters(prev => ({
            ...prev,
            thinkingLevel: autoConfig.thinkingLevel || 'default',
            temperature: autoConfig.parameters?.temperature as number | undefined,
            maxOutputTokens: (autoConfig.parameters?.maxOutputTokens as number) || 8192,
          }));
        }
      } catch (error) {
        console.error('Error loading agent models:', error);
      }
    };

    loadAgentModels();

    // Listen for storage changes to sync when Standard view updates
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && changes['agent-models']) {
        loadAgentModels();
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Clean up orphaned agent models (referencing deleted providers)
  useEffect(() => {
    if (Object.keys(providers).length === 0) return;

    const cleanupOrphanedModels = async () => {
      const agentModels = await agentModelStore.getAllAgentModels();
      for (const [agentName, config] of Object.entries(agentModels)) {
        if (config && !providers[config.provider]) {
          console.warn(
            `[AgentSettings] Resetting orphaned ${agentName} model (provider ${config.provider} no longer exists)`,
          );
          await agentModelStore.resetAgentModel(agentName as AgentNameEnum);
          setSelectedModels(prev => ({ ...prev, [agentName as AgentNameEnum]: '' }));
        }
      }
    };

    cleanupOrphanedModels();
  }, [providers]);

  // Initialize cost calculator
  useEffect(() => {
    const initializeCostCalc = async () => {
      try {
        await initializeCostCalculator();
        console.log('Cost calculator initialized for pricing validation');
        setCostCalculatorReady(true);
      } catch (error) {
        console.error('Failed to initialize cost calculator:', error);
        // Even if initialization fails, we should still allow model selection
        // (fallback pricing will be used for cost calculation)
        setCostCalculatorReady(true);
      }
    };

    initializeCostCalc();
  }, []);

  // Create a memoized version of getAvailableModels
  const getAvailableModelsCallback = useCallback(async () => {
    const models: Array<{ provider: string; providerName: string; model: string }> = [];

    try {
      // Use providers from state (which gets updated on storage changes)
      for (const [provider, config] of Object.entries(providers)) {
        if (!config?.apiKey) continue; // Skip providers without API keys

        const providerModels =
          config.modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];

        // Filter for pricing only when override is OFF
        const modelsWithPricing =
          costCalculatorReady && !showAllModels
            ? providerModels.filter(model => hasModelPricing(model))
            : providerModels;

        models.push(
          ...modelsWithPricing.map(model => ({
            provider,
            providerName: config.name || provider,
            model,
          })),
        );
      }
    } catch (error) {
      console.error('Error loading providers for model selection:', error);
    }

    return models;
  }, [providers, costCalculatorReady, showAllModels]);

  // Update available models whenever providers change or cost calculator is ready
  useEffect(() => {
    const updateAvailableModels = async () => {
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    };

    updateAvailableModels();
  }, [getAvailableModelsCallback]);

  // One-time default selection based on first added provider
  // CRITICAL: Check storage directly to avoid race condition with async model loading
  useEffect(() => {
    if (hasAppliedInitialDefaults) return;
    const providerEntries = Object.entries(providers);
    if (providerEntries.length === 0) return;

    const checkAndApplyDefaults = async () => {
      // Check storage directly - don't rely on selectedModels state which may not be populated yet
      const storedModels = await agentModelStore.getAllAgentModels();
      if (Object.keys(storedModels).length > 0) {
        setHasAppliedInitialDefaults(true);
        return;
      }

      // Pick the earliest-added provider by createdAt
      let firstProviderId: string | null = null;
      let firstCreatedAt = Number.POSITIVE_INFINITY;
      for (const [pid, cfg] of providerEntries) {
        const created = cfg && (cfg as any).createdAt ? Number((cfg as any).createdAt) : Date.now();
        if (created < firstCreatedAt) {
          firstCreatedAt = created;
          firstProviderId = pid;
        }
      }
      if (!firstProviderId) {
        setHasAppliedInitialDefaults(true);
        return;
      }

      const cfg = providers[firstProviderId];
      const type = cfg?.type as ProviderTypeEnum | undefined;
      let defaultModel: string | undefined;
      switch (type) {
        case ProviderTypeEnum.OpenAI:
          defaultModel = 'gpt-5-mini';
          break;
        case ProviderTypeEnum.Gemini:
          defaultModel = 'gemini-2.5-flash';
          break;
        case ProviderTypeEnum.Anthropic:
          defaultModel = 'claude-sonnet-4-5-20250929';
          break;
        default:
          defaultModel = undefined;
      }

      if (!defaultModel) {
        setHasAppliedInitialDefaults(true);
        return;
      }

      // Verify the provider actually supports the model
      const providerModels =
        cfg?.modelNames || llmProviderModelNames[firstProviderId as keyof typeof llmProviderModelNames] || [];
      if (!providerModels.includes(defaultModel)) {
        setHasAppliedInitialDefaults(true);
        return;
      }

      const value = `${firstProviderId}>${defaultModel}`;
      const targets: AgentNameEnum[] = [
        AgentNameEnum.Auto,
        AgentNameEnum.AgentPlanner,
        AgentNameEnum.AgentNavigator,
        AgentNameEnum.AgentValidator,
        AgentNameEnum.Chat,
        AgentNameEnum.Search,
        AgentNameEnum.MultiagentPlanner,
        AgentNameEnum.MultiagentWorker,
        AgentNameEnum.MultiagentRefiner,
        AgentNameEnum.HistorySummariser,
        AgentNameEnum.Estimator,
      ];

      try {
        for (const agent of targets) {
          await handleModelChange(agent, value);
        }
      } finally {
        setHasAppliedInitialDefaults(true);
      }
    };

    checkAndApplyDefaults();
  }, [providers, hasAppliedInitialDefaults]);

  // Removed recommended model logic

  const updateSetting = async (key: keyof GeneralSettingsConfig, value: any) => {
    try {
      const updatedSettings = { ...settings, [key]: value };
      setSettings(updatedSettings);
      await generalSettingsStore.updateSettings({ [key]: value });

      const latestSettings = await generalSettingsStore.getSettings();

      // Debug: Verify settings were saved correctly for planner/validator toggles
      if (key === 'enablePlanner' || key === 'enableValidator') {
        console.log(`[Settings] Updated ${key}:`, {
          requestedValue: value,
          savedValue: (latestSettings as any)[key],
          match: (latestSettings as any)[key] === value,
        });
      }

      setSettings(latestSettings);
    } catch (error) {
      console.error('Error updating setting:', error);
    }
  };

  const handleModelChange = async (agentName: AgentNameEnum, modelValue: string) => {
    const [provider, model] = modelValue.split('>');

    console.log(`[handleModelChange] Setting ${agentName} model: provider=${provider}, model=${model}`);

    // When changing models, reset to provider defaults (temperature undefined = use provider default)
    const newParameters = {
      temperature: undefined as number | undefined, // Use provider's default temperature
      maxOutputTokens: 8192,
    };

    setModelParameters(prev => ({
      ...prev,
      [agentName]: newParameters,
    }));

    setSelectedModels(prev => ({
      ...prev,
      [agentName]: modelValue,
    }));

    try {
      if (model) {
        if (isThinkingCapableModel(model)) {
          setThinkingLevel(prev => ({
            ...prev,
            [agentName]: prev[agentName] || 'default',
          }));
        } else {
          setThinkingLevel(prev => ({
            ...prev,
            [agentName]: undefined,
          }));
        }

        const shouldEnableWebSearch = agentName === AgentNameEnum.Search ? true : webSearchEnabled[agentName] || false;
        if (agentName === AgentNameEnum.Search && !webSearchEnabled[agentName]) {
          setWebSearchEnabled(prev => ({ ...prev, [agentName]: true }));
        }

        await agentModelStore.setAgentModel(agentName, {
          provider,
          modelName: model,
          parameters: { maxOutputTokens: newParameters.maxOutputTokens },
          thinkingLevel: isThinkingCapableModel(model) ? thinkingLevel[agentName] || 'default' : undefined,
          webSearch: shouldEnableWebSearch,
        });
      } else {
        await agentModelStore.resetAgentModel(agentName);
      }
    } catch (error) {
      console.error('Error saving agent model:', error);
    }
  };

  const handleThinkingLevelChange = async (agentName: AgentNameEnum, value: ThinkingLevel) => {
    setThinkingLevel(prev => ({ ...prev, [agentName]: value }));

    if (selectedModels[agentName]) {
      try {
        const [provider, model] = selectedModels[agentName].split('>');
        if (provider) {
          await agentModelStore.setAgentModel(agentName, {
            provider,
            modelName: model,
            parameters: modelParameters[agentName],
            thinkingLevel: value,
            webSearch: webSearchEnabled[agentName] || false,
          });
        }
      } catch (error) {
        console.error('Error saving thinking level:', error);
      }
    }
  };

  const handleParameterChange = async (
    agentName: AgentNameEnum,
    paramName: 'temperature' | 'maxOutputTokens',
    value: number | undefined,
  ) => {
    const newParameters = {
      ...modelParameters[agentName],
      [paramName]: value,
    };

    setModelParameters(prev => ({
      ...prev,
      [agentName]: newParameters,
    }));

    if (selectedModels[agentName]) {
      try {
        const [provider, model] = selectedModels[agentName].split('>');

        if (provider) {
          // Build parameters object, omitting undefined temperature to use provider default
          const parametersToSave: Record<string, unknown> = {
            maxOutputTokens: newParameters.maxOutputTokens,
          };
          if (newParameters.temperature !== undefined) {
            parametersToSave.temperature = newParameters.temperature;
          }

          await agentModelStore.setAgentModel(agentName, {
            provider,
            modelName: model,
            parameters: parametersToSave,
            thinkingLevel: thinkingLevel[agentName],
            webSearch: webSearchEnabled[agentName] || false,
          });
        }
      } catch (error) {
        console.error('Error saving agent parameters:', error);
      }
    }
  };

  // Handle global model parameter changes
  const handleGlobalParameterChange = (
    param: 'temperature' | 'maxOutputTokens' | 'thinkingLevel',
    value: number | undefined | ThinkingLevel,
  ) => {
    setGlobalModelParameters(prev => ({
      ...prev,
      [param]: value,
    }));
  };

  // Apply a selected global model to all agents
  const applyGlobalModelToAll = async () => {
    try {
      if (!globalModelValue) return;
      const [provider, model] = globalModelValue.split('>');

      // Agents to update (all workflow roles)
      const agentList: AgentNameEnum[] = [
        AgentNameEnum.Auto,
        AgentNameEnum.AgentPlanner,
        AgentNameEnum.AgentNavigator,
        AgentNameEnum.AgentValidator,
        AgentNameEnum.Chat,
        AgentNameEnum.Search,
        AgentNameEnum.MultiagentPlanner,
        AgentNameEnum.MultiagentWorker,
        AgentNameEnum.MultiagentRefiner,
        AgentNameEnum.HistorySummariser,
        AgentNameEnum.Estimator,
      ];

      const isThinkingModel = isThinkingCapableModel(globalModelValue);

      // Build parameters object
      const parametersToSave: Record<string, unknown> = {
        maxOutputTokens: globalModelParameters.maxOutputTokens,
      };
      if (globalModelParameters.temperature !== undefined) {
        parametersToSave.temperature = globalModelParameters.temperature;
      }

      for (const agent of agentList) {
        // Update local state
        setSelectedModels(prev => ({ ...prev, [agent]: globalModelValue }));
        setModelParameters(prev => ({
          ...prev,
          [agent]: {
            temperature: globalModelParameters.temperature,
            maxOutputTokens: globalModelParameters.maxOutputTokens,
          },
        }));
        if (isThinkingModel) {
          setThinkingLevel(prev => ({ ...prev, [agent]: globalModelParameters.thinkingLevel }));
        }

        // Save to storage
        const shouldEnableWebSearch = agent === AgentNameEnum.Search ? true : webSearchEnabled[agent] || false;
        await agentModelStore.setAgentModel(agent, {
          provider,
          modelName: model,
          parameters: parametersToSave,
          thinkingLevel: isThinkingModel ? globalModelParameters.thinkingLevel : undefined,
          webSearch: shouldEnableWebSearch,
        });
      }
      globalSaveIndicator.trigger();
    } catch (error) {
      console.error('Error applying global model to all agents:', error);
    }
  };

  // Wrapper to bind isDarkMode to the imported getAgentSectionColor
  const getSectionColor = (agentName: AgentNameEnum) => getAgentSectionColor(agentName, isDarkMode);

  const renderModelSelect = (agentName: AgentNameEnum) => (
    <ModelSelect
      isDarkMode={isDarkMode}
      agentName={agentName}
      availableModels={availableModels}
      selectedValue={selectedModels[agentName] || ''}
      modelParameters={modelParameters[agentName]}
      thinkingLevelValue={thinkingLevel[agentName]}
      showAllModels={showAllModels}
      getAgentDisplayName={getAgentDisplayName}
      getAgentDescription={getAgentDescription}
      getAgentSectionColor={getSectionColor}
      hasModelPricing={hasModelPricing}
      onChangeModel={handleModelChange}
      onChangeParameter={handleParameterChange}
      onChangeThinkingLevel={handleThinkingLevelChange}
    />
  );

  return (
    <section className="flex flex-col space-y-6">
      {/*Suggestion note for model selection*/}
      <div className="rounded-xl border p-5 text-left shadow-sm backdrop-blur-md">
        <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          We suggest balancing capability with latency/cost, e.g., "flash" or "fast" versions of frontier models.
        </p>
      </div>
      {/* Global Settings (Model Selection + Timeout) */}
      <GlobalSettings
        isDarkMode={isDarkMode}
        availableModels={availableModels}
        globalModelValue={globalModelValue}
        onChangeGlobalModel={setGlobalModelValue}
        applyToAll={applyGlobalModelToAll}
        showAllModels={showAllModels}
        hasModelPricing={hasModelPricing}
        globalModelParameters={globalModelParameters}
        onChangeGlobalParameter={handleGlobalParameterChange}
        responseTimeoutSeconds={settings.responseTimeoutSeconds ?? 120}
        onChangeTimeout={seconds => updateSetting('responseTimeoutSeconds', seconds)}
        showSaveIndicator={globalSaveIndicator.show}
      />

      {/* Auto Tab Context Toggle */}
      <div
        className={`rounded-xl border p-4 shadow-sm backdrop-blur-md ${
          isDarkMode ? 'border-purple-700/40 bg-purple-900/20' : 'border-purple-300/60 bg-purple-50/60'
        }`}>
        <div className="flex items-center justify-between">
          <div className="text-left">
            <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              Auto Tab Context
            </h3>
            <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {settings.enableAutoTabContext
                ? 'Automatically including all open browser tabs as context'
                : 'Enable from the panel\'s "Add tab as context" dropdown'}
            </p>
          </div>
          {settings.enableAutoTabContext ? (
            <button
              type="button"
              onClick={() => updateSetting('enableAutoTabContext', false)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                isDarkMode
                  ? 'bg-red-900/50 text-red-200 hover:bg-red-800/60'
                  : 'bg-red-100 text-red-700 hover:bg-red-200'
              }`}>
              Disable
            </button>
          ) : (
            <span
              className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-slate-700 text-slate-400' : 'bg-gray-100 text-gray-500'}`}>
              Disabled
            </span>
          )}
        </div>
      </div>

      {/* Auto Section */}
      <div
        className={`rounded-xl border ${getSectionColor(AgentNameEnum.Auto)} p-5 text-left shadow-sm backdrop-blur-md`}
        style={{ order: 2 }}>
        <h2 className={`mb-4 text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          <span className="inline-flex items-center gap-2">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${isDarkMode ? 'bg-black/70 text-white' : 'bg-black text-white'}`}>
              <FaRandom className="h-3.5 w-3.5" />
            </span>
            <span>Auto</span>
          </span>
        </h2>
        <div className="space-y-4">{renderModelSelect(AgentNameEnum.Auto)}</div>
      </div>

      {/* Chat Section */}
      <SingleModelSection
        isDarkMode={isDarkMode}
        title="Chat"
        agent={AgentNameEnum.Chat}
        availableModels={availableModels}
        selectedValue={selectedModels[AgentNameEnum.Chat] || ''}
        modelParameters={modelParameters[AgentNameEnum.Chat]}
        thinkingLevelValue={thinkingLevel[AgentNameEnum.Chat]}
        showAllModels={showAllModels}
        getAgentDisplayName={getAgentDisplayName}
        getAgentDescription={getAgentDescription}
        getAgentSectionColor={getSectionColor}
        hasModelPricing={hasModelPricing}
        onChangeModel={handleModelChange}
        onChangeParameter={handleParameterChange}
        onChangeThinkingLevel={handleThinkingLevelChange}
      />

      {/* Search Section */}
      <SingleModelSection
        isDarkMode={isDarkMode}
        title="Search"
        agent={AgentNameEnum.Search}
        availableModels={availableModels}
        selectedValue={selectedModels[AgentNameEnum.Search] || ''}
        modelParameters={modelParameters[AgentNameEnum.Search]}
        thinkingLevelValue={thinkingLevel[AgentNameEnum.Search]}
        showAllModels={showAllModels}
        getAgentDisplayName={getAgentDisplayName}
        getAgentDescription={getAgentDescription}
        getAgentSectionColor={getSectionColor}
        hasModelPricing={hasModelPricing}
        onChangeModel={handleModelChange}
        onChangeParameter={handleParameterChange}
        onChangeThinkingLevel={handleThinkingLevelChange}
      />

      {/* Agent & Multi-Agent Section (Navigator, Planner, Validator) */}
      <div
        className={`rounded-xl border ${getSectionColor(AgentNameEnum.AgentNavigator)} p-5 text-left shadow-sm backdrop-blur-md`}
        style={{ order: 5 }}>
        <h2 className={`mb-4 text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          <span className="inline-flex items-center gap-2">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${isDarkMode ? 'bg-amber-400/70 text-white' : 'bg-amber-300 text-white'}`}>
              <FaRobot className="h-3.5 w-3.5" />
            </span>
            <span>Agent & Multi-Agent</span>
          </span>
        </h2>
        {/* Agent Settings - merged configuration */}
        <div className="mt-6 space-y-4">
          <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Agent Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Max Steps</h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Step limit per task (1-50)
                </p>
              </div>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.maxSteps}
                onChange={e => updateSetting('maxSteps', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Max Actions Per Step
                </h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Action limit per step (1-50)
                </p>
              </div>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.maxActionsPerStep}
                onChange={e => updateSetting('maxActionsPerStep', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Failure Tolerance
                </h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Max consecutive failures (1-10)
                </p>
              </div>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.maxFailures}
                onChange={e => updateSetting('maxFailures', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Validator Failures
                </h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Max validator failures (1-10)
                </p>
              </div>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.maxValidatorFailures}
                onChange={e => updateSetting('maxValidatorFailures', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Retry Delay
                </h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Wait between retries (0-30s)
                </p>
              </div>
              <input
                type="number"
                min={0}
                max={30}
                value={settings.retryDelay}
                onChange={e => updateSetting('retryDelay', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Max Input Tokens
                </h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Context window size (32k-200k)
                </p>
              </div>
              <input
                type="number"
                min={32000}
                max={200000}
                step={1000}
                value={settings.maxInputTokens}
                onChange={e => updateSetting('maxInputTokens', Number.parseInt(e.target.value, 10))}
                className={`w-24 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            {/* Toggle settings */}
            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className="group relative inline-flex items-center gap-1 pb-1">
                    Use Vision
                    <span
                      className={`inline-flex items-center justify-center h-4 w-4 rounded-full text-[10px] ${isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-gray-200 text-gray-700'}`}>
                      ?
                    </span>
                    <span
                      className={`absolute left-0 top-full z-50 mt-0 hidden whitespace-normal rounded px-2 py-1 text-[10px] shadow group-hover:block ${isDarkMode ? 'bg-slate-900 text-slate-100 border border-slate-700' : 'bg-gray-900 text-white border border-gray-800'} pointer-events-auto`}>
                      Enable visual understanding
                    </span>
                  </span>
                </h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Enable visual analysis
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateSetting('useVision', !settings.useVision)}
                className={`toggle-slider ${settings.useVision ? 'toggle-on' : 'toggle-off'}`}
                aria-pressed={settings.useVision}
                aria-label="Use Vision toggle">
                <span className="toggle-knob" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className="group relative inline-flex items-center gap-1 pb-1">
                    Use Vision for Planner
                    <span
                      className={`inline-flex items-center justify-center h-4 w-4 rounded-full text-[10px] ${isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-gray-200 text-gray-700'}`}>
                      ?
                    </span>
                    <span
                      className={`absolute left-0 top-full z-50 mt-0 hidden whitespace-normal rounded px-2 py-1 text-[10px] shadow group-hover:block ${isDarkMode ? 'bg-slate-900 text-slate-100 border border-slate-700' : 'bg-gray-900 text-white border border-gray-800'} pointer-events-auto`}>
                      Allow planner to use screenshots
                    </span>
                  </span>
                </h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Enable vision for planning
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateSetting('useVisionForPlanner', !settings.useVisionForPlanner)}
                className={`toggle-slider ${settings.useVisionForPlanner ? 'toggle-on' : 'toggle-off'}`}
                aria-pressed={settings.useVisionForPlanner}
                aria-label="Use Vision for Planner toggle">
                <span className="toggle-knob" />
              </button>
            </div>
          </div>

          {/* Planner & Validator Settings - Full Width Sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            {/* Single-Agent Workflow Box */}
            <div
              className={`rounded-lg border p-4 ${isDarkMode ? 'border-slate-600 bg-slate-800/50' : 'border-gray-200 bg-gray-50'}`}>
              <h4 className={`text-base font-semibold mb-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                🤖 Single-Agent Workflow
              </h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Planner
                    </span>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      Plans before navigation
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateSetting('enablePlanner', !settings.enablePlanner)}
                    className={`toggle-slider ${settings.enablePlanner ? 'toggle-on' : 'toggle-off'}`}
                    aria-pressed={settings.enablePlanner}
                    aria-label="Enable Planner toggle">
                    <span className="toggle-knob" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Validator
                    </span>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Validates task output</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateSetting('enableValidator', !settings.enableValidator)}
                    className={`toggle-slider ${settings.enableValidator ? 'toggle-on' : 'toggle-off'}`}
                    aria-pressed={settings.enableValidator}
                    aria-label="Enable Validator toggle">
                    <span className="toggle-knob" />
                  </button>
                </div>
              </div>
            </div>

            {/* Multi-Agent Workflow Box */}
            <div
              className={`rounded-lg border p-4 ${isDarkMode ? 'border-slate-600 bg-slate-800/50' : 'border-gray-200 bg-gray-50'}`}>
              <h4 className={`text-base font-semibold mb-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                🤖🤖 Multi-Agent Workflow
              </h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Planner
                    </span>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Each worker plans</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateSetting('enableMultiagentPlanner', !settings.enableMultiagentPlanner)}
                    className={`toggle-slider ${settings.enableMultiagentPlanner ? 'toggle-on' : 'toggle-off'}`}
                    aria-pressed={settings.enableMultiagentPlanner}
                    aria-label="Enable Multi-Agent Planner toggle">
                    <span className="toggle-knob" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Validator
                    </span>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Each worker validates</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateSetting('enableMultiagentValidator', !settings.enableMultiagentValidator)}
                    className={`toggle-slider ${settings.enableMultiagentValidator ? 'toggle-on' : 'toggle-off'}`}
                    aria-pressed={settings.enableMultiagentValidator}
                    aria-label="Enable Multi-Agent Validator toggle">
                    <span className="toggle-knob" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Other Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className="group relative inline-flex items-center gap-1 pb-1">
                    Show Tab Previews
                    <span
                      className={`inline-flex items-center justify-center h-4 w-4 rounded-full text-[10px] ${isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-gray-200 text-gray-700'}`}>
                      ?
                    </span>
                    <span
                      className={`absolute left-0 top-full z-50 mt-0 hidden whitespace-normal rounded px-2 py-1 text-[10px] shadow group-hover:block ${isDarkMode ? 'bg-slate-900 text-slate-100 border border-slate-700' : 'bg-gray-900 text-white border border-gray-800'} pointer-events-auto`}>
                      Show low-FPS tab mirroring in chat UI
                    </span>
                  </span>
                </h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Display tab previews
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateSetting('showTabPreviews' as any, !((settings as any).showTabPreviews ?? true))}
                className={`toggle-slider ${((settings as any).showTabPreviews ?? true) ? 'toggle-on' : 'toggle-off'}`}
                aria-pressed={(settings as any).showTabPreviews ?? true}
                aria-label="Show Tab Previews toggle">
                <span className="toggle-knob" />
              </button>
            </div>
          </div>
        </div>

        {/* Multi-Agent Settings */}
        <div className="mt-6 space-y-4">
          <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Multi-Agent Settings
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Max Worker Agents
                </h4>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Maximum parallel workers (1-10)
                </p>
              </div>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.maxWorkerAgents}
                onChange={e => updateSetting('maxWorkerAgents', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>
          </div>
        </div>

        {/* Agent Models */}
        <div className="mt-6 space-y-4">
          <div className="mb-2 flex items-center gap-3 text-sm">
            <label className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
              <input
                type="checkbox"
                className="mr-2"
                checked={showAllModels}
                onChange={e => setShowAllModels(e.target.checked)}
              />
              Show all models (include ones with cost unknown)
            </label>
            {!showAllModels && (
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>
                Models without Helicone pricing are hidden. Enable to override.
              </span>
            )}
          </div>
          {/* <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Agent Models</h3> */}
          <AgentModelsSection
            isDarkMode={isDarkMode}
            sectionTitle="Agent Models"
            agents={[AgentNameEnum.AgentPlanner, AgentNameEnum.AgentNavigator, AgentNameEnum.AgentValidator]}
            availableModels={availableModels}
            selectedModels={selectedModels}
            modelParameters={modelParameters}
            thinkingLevel={thinkingLevel}
            showAllModels={showAllModels}
            getAgentDisplayName={getAgentDisplayName}
            getAgentDescription={getAgentDescription}
            getAgentSectionColor={getSectionColor}
            hasModelPricing={hasModelPricing}
            onChangeModel={handleModelChange}
            onChangeParameter={handleParameterChange}
            onChangeThinkingLevel={handleThinkingLevelChange}
          />
          <AgentModelsSection
            isDarkMode={isDarkMode}
            sectionTitle="Multi-Agent Models"
            agents={[AgentNameEnum.MultiagentPlanner, AgentNameEnum.MultiagentRefiner, AgentNameEnum.MultiagentWorker]}
            availableModels={availableModels}
            selectedModels={selectedModels}
            modelParameters={modelParameters}
            thinkingLevel={thinkingLevel}
            showAllModels={showAllModels}
            getAgentDisplayName={getAgentDisplayName}
            getAgentDescription={getAgentDescription}
            getAgentSectionColor={getSectionColor}
            hasModelPricing={hasModelPricing}
            onChangeModel={handleModelChange}
            onChangeParameter={handleParameterChange}
            onChangeThinkingLevel={handleThinkingLevelChange}
          />

          {/* Divider */}
          <div className={`my-6 border-t ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}`} />

          {/* History Context Summarization - pale green */}
          <AgentModelsSection
            isDarkMode={isDarkMode}
            sectionTitle="History Context Summarization"
            agents={[AgentNameEnum.HistorySummariser]}
            availableModels={availableModels}
            selectedModels={selectedModels}
            modelParameters={modelParameters}
            thinkingLevel={thinkingLevel}
            showAllModels={showAllModels}
            getAgentDisplayName={getAgentDisplayName}
            getAgentDescription={getAgentDescription}
            getAgentSectionColor={getSectionColor}
            hasModelPricing={hasModelPricing}
            onChangeModel={handleModelChange}
            onChangeParameter={handleParameterChange}
            onChangeThinkingLevel={handleThinkingLevelChange}
            colorOverride={isDarkMode ? 'border-green-700/40 bg-green-900/20' : 'border-green-300/60 bg-green-50/60'}>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Configure how browser history is processed and sent to the AI for summarization.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Time Window (hours)
                </label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={settings.historySummaryWindowHours || 24}
                  onChange={e =>
                    updateSetting(
                      'historySummaryWindowHours',
                      Math.max(1, Math.min(168, Number.parseInt(e.target.value, 10) || 24)),
                    )
                  }
                  className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}
                />
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  How far back to fetch (1-168)
                </p>
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Max Items to Fetch
                </label>
                <input
                  type="number"
                  min={100}
                  max={50000}
                  step={100}
                  value={settings.historySummaryMaxRawItems || 1000}
                  onChange={e =>
                    updateSetting(
                      'historySummaryMaxRawItems',
                      Math.max(100, Math.min(50000, Number.parseInt(e.target.value, 10) || 1000)),
                    )
                  }
                  className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}
                />
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  From browser API (100-50,000)
                </p>
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Max Items to AI
                </label>
                <input
                  type="number"
                  min={50}
                  max={2000}
                  step={50}
                  value={settings.historySummaryMaxProcessedItems || 50}
                  onChange={e =>
                    updateSetting(
                      'historySummaryMaxProcessedItems',
                      Math.max(50, Math.min(2000, Number.parseInt(e.target.value, 10) || 50)),
                    )
                  }
                  className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}
                />
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  After dedup/filter (50-2,000)
                </p>
              </div>
            </div>
          </AgentModelsSection>

          {/* Divider */}
          <div className={`my-6 border-t ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}`} />

          {/* Workflow Estimation Model - pale blue */}
          <AgentModelsSection
            isDarkMode={isDarkMode}
            sectionTitle="Workflow Estimation Model"
            agents={[AgentNameEnum.Estimator]}
            availableModels={availableModels}
            selectedModels={selectedModels}
            modelParameters={modelParameters}
            thinkingLevel={thinkingLevel}
            showAllModels={showAllModels}
            getAgentDisplayName={getAgentDisplayName}
            getAgentDescription={getAgentDescription}
            getAgentSectionColor={getSectionColor}
            hasModelPricing={hasModelPricing}
            onChangeModel={handleModelChange}
            onChangeParameter={handleParameterChange}
            onChangeThinkingLevel={handleThinkingLevelChange}
            colorOverride={isDarkMode ? 'border-blue-700/40 bg-blue-900/20' : 'border-blue-300/60 bg-blue-50/60'}
          />
        </div>
      </div>
    </section>
  );
};
