import { useEffect, useState, useCallback, useRef } from 'react';
import { FiCpu, FiZap } from 'react-icons/fi';
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
import { isThinkingCapableModel, SectionApplyButton } from './primitives';
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
  // Per-card dirty tracking and confirmation via chrome.storage.onChanged
  const [dirtyCards, setDirtyCards] = useState<Set<string>>(new Set());
  const [confirmedCard, setConfirmedCard] = useState<string | null>(null);
  const pendingCardRef = useRef<string | null>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markDirty = (card: string) => setDirtyCards(prev => new Set(prev).add(card));
  const clearDirty = (card: string) =>
    setDirtyCards(prev => {
      const next = new Set(prev);
      next.delete(card);
      return next;
    });

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ((changes['agent-models'] || changes['general-settings']) && pendingCardRef.current) {
        const card = pendingCardRef.current;
        pendingCardRef.current = null;
        if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
        setConfirmedCard(card);
        confirmTimeoutRef.current = setTimeout(() => setConfirmedCard(null), 2000);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

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
          const shouldEnableWebSearch = agent === AgentNameEnum.Search;
          await agentModelStore.setAgentModel(agent, {
            provider: firstProviderId!,
            modelName: defaultModel,
            parameters: { maxOutputTokens: 8192 },
            thinkingLevel: 'default',
            webSearch: shouldEnableWebSearch,
          });
        }
      } finally {
        setHasAppliedInitialDefaults(true);
      }
    };

    checkAndApplyDefaults();
  }, [providers, hasAppliedInitialDefaults]);

  // Removed recommended model logic

  // Agent-card general settings keys (for applyCard)
  const AGENT_CARD_GENERAL_KEYS: (keyof GeneralSettingsConfig)[] = [
    'maxSteps',
    'maxActionsPerStep',
    'maxFailures',
    'maxValidatorFailures',
    'retryDelay',
    'maxInputTokens',
    'maxWorkerAgents',
    'useVision',
    'useVisionForPlanner',
    'displayHighlights',
    'enableCoordinateClick',
    'showTabPreviews',
    'enablePlanner',
    'enableValidator',
    'enableMultiagentPlanner',
    'enableMultiagentValidator',
  ];
  const HISTORY_CARD_GENERAL_KEYS: (keyof GeneralSettingsConfig)[] = [
    'historySummaryWindowHours',
    'historySummaryMaxRawItems',
    'historySummaryMaxProcessedItems',
  ];

  const AGENT_CARD_MAP: Record<string, string> = {
    [AgentNameEnum.Auto]: 'auto',
    [AgentNameEnum.Chat]: 'chat',
    [AgentNameEnum.Search]: 'search',
    [AgentNameEnum.AgentPlanner]: 'agent',
    [AgentNameEnum.AgentNavigator]: 'agent',
    [AgentNameEnum.AgentValidator]: 'agent',
    [AgentNameEnum.MultiagentPlanner]: 'agent',
    [AgentNameEnum.MultiagentWorker]: 'agent',
    [AgentNameEnum.MultiagentRefiner]: 'agent',
    [AgentNameEnum.HistorySummariser]: 'history',
    [AgentNameEnum.Estimator]: 'estimator',
  };

  const CARD_AGENTS: Record<string, AgentNameEnum[]> = {
    auto: [AgentNameEnum.Auto],
    chat: [AgentNameEnum.Chat],
    search: [AgentNameEnum.Search],
    agent: [
      AgentNameEnum.AgentPlanner,
      AgentNameEnum.AgentNavigator,
      AgentNameEnum.AgentValidator,
      AgentNameEnum.MultiagentPlanner,
      AgentNameEnum.MultiagentWorker,
      AgentNameEnum.MultiagentRefiner,
    ],
    history: [AgentNameEnum.HistorySummariser],
    estimator: [AgentNameEnum.Estimator],
  };

  const updateLocalSetting = (key: keyof GeneralSettingsConfig, value: any, card: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    markDirty(card);
  };

  const handleMultiAgentModelChange = async (_agentName: AgentNameEnum, modelValue: string) => {
    const multiAgentRoles = [
      AgentNameEnum.MultiagentPlanner,
      AgentNameEnum.MultiagentWorker,
      AgentNameEnum.MultiagentRefiner,
    ];
    for (const role of multiAgentRoles) {
      await handleModelChange(role, modelValue);
    }
  };

  const handleModelChange = (agentName: AgentNameEnum, modelValue: string) => {
    const [, model] = modelValue.split('>');

    setModelParameters(prev => ({
      ...prev,
      [agentName]: { temperature: undefined as number | undefined, maxOutputTokens: 8192 },
    }));
    setSelectedModels(prev => ({ ...prev, [agentName]: modelValue }));

    if (model) {
      setThinkingLevel(prev => ({
        ...prev,
        [agentName]: isThinkingCapableModel(model) ? prev[agentName] || 'default' : undefined,
      }));
      if (agentName === AgentNameEnum.Search) {
        setWebSearchEnabled(prev => ({ ...prev, [agentName]: true }));
      }
    }

    markDirty(AGENT_CARD_MAP[agentName] || 'agent');
  };

  const handleThinkingLevelChange = (agentName: AgentNameEnum, value: ThinkingLevel) => {
    setThinkingLevel(prev => ({ ...prev, [agentName]: value }));
    markDirty(AGENT_CARD_MAP[agentName] || 'agent');
  };

  const handleParameterChange = (
    agentName: AgentNameEnum,
    paramName: 'temperature' | 'maxOutputTokens',
    value: number | undefined,
  ) => {
    setModelParameters(prev => ({
      ...prev,
      [agentName]: { ...prev[agentName], [paramName]: value },
    }));
    markDirty(AGENT_CARD_MAP[agentName] || 'agent');
  };

  const handleGlobalParameterChange = (
    param: 'temperature' | 'maxOutputTokens' | 'thinkingLevel',
    value: number | undefined | ThinkingLevel,
  ) => {
    setGlobalModelParameters(prev => ({ ...prev, [param]: value }));
    markDirty('global');
  };

  const saveAgentModel = async (agent: AgentNameEnum) => {
    const modelValue = selectedModels[agent];
    if (!modelValue) {
      await agentModelStore.resetAgentModel(agent);
      return;
    }
    const [provider, model] = modelValue.split('>');
    if (!provider || !model) return;
    const params = modelParameters[agent];
    const parametersToSave: Record<string, unknown> = { maxOutputTokens: params.maxOutputTokens };
    if (params.temperature !== undefined) parametersToSave.temperature = params.temperature;
    await agentModelStore.setAgentModel(agent, {
      provider,
      modelName: model,
      parameters: parametersToSave,
      thinkingLevel: thinkingLevel[agent],
      webSearch: agent === AgentNameEnum.Search ? true : webSearchEnabled[agent] || false,
    });
  };

  const applyCard = async (card: string) => {
    pendingCardRef.current = card;
    setConfirmedCard(null);

    // Write general settings belonging to this card
    const generalKeys =
      card === 'agent' ? AGENT_CARD_GENERAL_KEYS : card === 'history' ? HISTORY_CARD_GENERAL_KEYS : null;
    if (generalKeys) {
      const patch: Partial<GeneralSettingsConfig> = {};
      for (const key of generalKeys) (patch as any)[key] = settings[key];
      await generalSettingsStore.updateSettings(patch);
    }

    // Write model settings for agents in this card
    const agents = CARD_AGENTS[card] || [];
    for (const agent of agents) await saveAgentModel(agent);

    clearDirty(card);
  };

  const applyGlobalModelToAll = async () => {
    try {
      if (!globalModelValue) return;
      pendingCardRef.current = 'global';
      setConfirmedCard(null);

      const [provider, model] = globalModelValue.split('>');
      const isThinkingModel = isThinkingCapableModel(globalModelValue);
      const parametersToSave: Record<string, unknown> = {
        maxOutputTokens: globalModelParameters.maxOutputTokens,
      };
      if (globalModelParameters.temperature !== undefined) {
        parametersToSave.temperature = globalModelParameters.temperature;
      }

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

      for (const agent of agentList) {
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
        await agentModelStore.setAgentModel(agent, {
          provider,
          modelName: model,
          parameters: parametersToSave,
          thinkingLevel: isThinkingModel ? globalModelParameters.thinkingLevel : undefined,
          webSearch: agent === AgentNameEnum.Search ? true : webSearchEnabled[agent] || false,
        });
      }

      // Also save response timeout
      await generalSettingsStore.updateSettings({ responseTimeoutSeconds: settings.responseTimeoutSeconds });

      // Clear all card dirty states since global apply affects everything
      setDirtyCards(new Set());
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

  const cardClass = `rounded-xl border p-5 ${isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]'}`;

  return (
    <section className="flex flex-col space-y-5">
      <div className={cardClass}>
        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Balance capability with latency/cost — "flash" or "fast" model variants are recommended.
        </p>
      </div>
      {/* Global Settings (Model Selection + Timeout) */}
      <GlobalSettings
        isDarkMode={isDarkMode}
        availableModels={availableModels}
        globalModelValue={globalModelValue}
        onChangeGlobalModel={v => {
          setGlobalModelValue(v);
          markDirty('global');
        }}
        applyToAll={applyGlobalModelToAll}
        showAllModels={showAllModels}
        hasModelPricing={hasModelPricing}
        globalModelParameters={globalModelParameters}
        onChangeGlobalParameter={handleGlobalParameterChange}
        responseTimeoutSeconds={settings.responseTimeoutSeconds ?? 120}
        onChangeTimeout={seconds => updateLocalSetting('responseTimeoutSeconds', seconds, 'global')}
        isDirty={dirtyCards.has('global')}
        confirmed={confirmedCard === 'global'}
      />

      {/* Auto Section */}
      <div className={`rounded-xl border p-5 ${getSectionColor(AgentNameEnum.Auto)}`} style={{ order: 2 }}>
        <h2
          className={`mb-4 flex items-center gap-2 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          <FiZap className="h-4 w-4" /> Auto
        </h2>
        <div className="space-y-4">
          <ModelSelect
            isDarkMode={isDarkMode}
            agentName={AgentNameEnum.Auto}
            availableModels={availableModels}
            selectedValue={selectedModels[AgentNameEnum.Auto] || ''}
            modelParameters={modelParameters[AgentNameEnum.Auto]}
            thinkingLevelValue={thinkingLevel[AgentNameEnum.Auto]}
            showAllModels={showAllModels}
            getAgentDisplayName={getAgentDisplayName}
            getAgentDescription={getAgentDescription}
            getAgentSectionColor={getSectionColor}
            hasModelPricing={hasModelPricing}
            onChangeModel={handleModelChange}
            onChangeParameter={handleParameterChange}
            onChangeThinkingLevel={handleThinkingLevelChange}
            hideHeader
          />
          <SectionApplyButton
            isDarkMode={isDarkMode}
            isDirty={dirtyCards.has('auto')}
            confirmed={confirmedCard === 'auto'}
            onApply={() => applyCard('auto')}
          />
        </div>
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
        onChangeThinkingLevel={handleThinkingLevelChange}>
        <SectionApplyButton
          isDarkMode={isDarkMode}
          isDirty={dirtyCards.has('chat')}
          confirmed={confirmedCard === 'chat'}
          onApply={() => applyCard('chat')}
        />
      </SingleModelSection>

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
        onChangeThinkingLevel={handleThinkingLevelChange}>
        <SectionApplyButton
          isDarkMode={isDarkMode}
          isDirty={dirtyCards.has('search')}
          confirmed={confirmedCard === 'search'}
          onApply={() => applyCard('search')}
        />
      </SingleModelSection>

      {/* Agent & Multi-Agent Section */}
      <div className={`rounded-xl border p-5 ${getSectionColor(AgentNameEnum.AgentNavigator)}`} style={{ order: 5 }}>
        <h2
          className={`mb-4 flex items-center gap-2 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          <FiCpu className="h-4 w-4" /> Agent & Multi-Agent
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Max Steps</span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>1-50</p>
              </div>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.maxSteps}
                onChange={e => updateLocalSetting('maxSteps', Number.parseInt(e.target.value, 10), 'agent')}
                className={`w-20 rounded-lg border px-3 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Actions/Step</span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>1-50</p>
              </div>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.maxActionsPerStep}
                onChange={e => updateLocalSetting('maxActionsPerStep', Number.parseInt(e.target.value, 10), 'agent')}
                className={`w-20 rounded-lg border px-3 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Failure Tolerance</span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>1-10</p>
              </div>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.maxFailures}
                onChange={e => updateLocalSetting('maxFailures', Number.parseInt(e.target.value, 10), 'agent')}
                className={`w-20 rounded-lg border px-3 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Validator Failures</span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>1-10</p>
              </div>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.maxValidatorFailures}
                onChange={e => updateLocalSetting('maxValidatorFailures', Number.parseInt(e.target.value, 10), 'agent')}
                className={`w-20 rounded-lg border px-3 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Retry Delay</span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>0-30s</p>
              </div>
              <input
                type="number"
                min={0}
                max={30}
                value={settings.retryDelay}
                onChange={e => updateLocalSetting('retryDelay', Number.parseInt(e.target.value, 10), 'agent')}
                className={`w-20 rounded-lg border px-3 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Max Input Tokens</span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>32k-200k</p>
              </div>
              <input
                type="number"
                min={32000}
                max={200000}
                step={1000}
                value={settings.maxInputTokens}
                onChange={e => updateLocalSetting('maxInputTokens', Number.parseInt(e.target.value, 10), 'agent')}
                className={`w-24 rounded-lg border px-3 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Max Workers</span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>Multi-agent (1-10)</p>
              </div>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.maxWorkerAgents}
                onChange={e => updateLocalSetting('maxWorkerAgents', Number.parseInt(e.target.value, 10), 'agent')}
                className={`w-20 rounded-lg border px-3 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className="group relative inline-flex items-center gap-1">
                    Vision Mode
                    <span
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${isDarkMode ? 'bg-[#3a3a34] text-gray-400' : 'bg-[#e5e4de] text-gray-600'}`}>
                      ?
                    </span>
                    <span
                      className={`pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-48 whitespace-normal rounded-lg px-2 py-1 text-[10px] group-hover:block ${isDarkMode ? 'bg-[#252522] text-gray-300 border border-[#3a3a34]' : 'bg-white text-gray-700 border border-[#dddcd5]'}`}>
                      Off: no screenshots. Auto: agent requests screenshots on demand. Always: every step includes a
                      screenshot.
                    </span>
                  </span>
                </span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  {settings.useVision === 'auto'
                    ? 'On-demand screenshots'
                    : settings.useVision
                      ? 'Screenshot every step'
                      : 'No screenshots'}
                </p>
              </div>
              <select
                value={String(settings.useVision)}
                onChange={e => {
                  const v = e.target.value;
                  updateLocalSetting('useVision', v === 'true' ? true : v === 'auto' ? 'auto' : false, 'agent');
                }}
                className={`rounded-lg border px-3 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}>
                <option value="false">Off</option>
                <option value="auto">Auto</option>
                <option value="true">Always</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className="group relative inline-flex items-center gap-1">
                    Display Highlights
                    <span
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${isDarkMode ? 'bg-[#3a3a34] text-gray-400' : 'bg-[#e5e4de] text-gray-600'}`}>
                      ?
                    </span>
                    <span
                      className={`pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-48 whitespace-normal rounded-lg px-2 py-1 text-[10px] group-hover:block ${isDarkMode ? 'bg-[#252522] text-gray-300 border border-[#3a3a34]' : 'bg-white text-gray-700 border border-[#dddcd5]'}`}>
                      Auto: highlights only appear on-demand with screenshots. Always On: highlights shown every step.
                    </span>
                  </span>
                </span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  {settings.displayHighlights === 'auto' ? 'On-demand with screenshots' : 'Shown every step'}
                </p>
              </div>
              <select
                value={String(settings.displayHighlights ?? 'auto')}
                onChange={e =>
                  updateLocalSetting('displayHighlights', e.target.value === 'true' ? true : 'auto', 'agent')
                }
                className={`rounded-lg border px-3 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}>
                <option value="auto">Auto</option>
                <option value="true">Always</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className="group relative inline-flex items-center gap-1">
                    Coordinate Clicking
                    <span
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${isDarkMode ? 'bg-[#3a3a34] text-gray-400' : 'bg-[#e5e4de] text-gray-600'}`}>
                      ?
                    </span>
                    <span
                      className={`pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-48 whitespace-normal rounded-lg px-2 py-1 text-[10px] group-hover:block ${isDarkMode ? 'bg-[#252522] text-gray-300 border border-[#3a3a34]' : 'bg-white text-gray-700 border border-[#dddcd5]'}`}>
                      Allow the agent to click at exact pixel coordinates from screenshots.
                    </span>
                  </span>
                </span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>Click by pixel position</p>
              </div>
              <button
                type="button"
                onClick={() => updateLocalSetting('enableCoordinateClick', !settings.enableCoordinateClick, 'agent')}
                className={`toggle-slider ${settings.enableCoordinateClick ? 'toggle-on' : 'toggle-off'}`}
                aria-pressed={!!settings.enableCoordinateClick}>
                <span className="toggle-knob" />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className="group relative inline-flex items-center gap-1">
                    Planner Vision
                    <span
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${isDarkMode ? 'bg-[#3a3a34] text-gray-400' : 'bg-[#e5e4de] text-gray-600'}`}>
                      ?
                    </span>
                    <span
                      className={`pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-48 whitespace-normal rounded-lg px-2 py-1 text-[10px] group-hover:block ${isDarkMode ? 'bg-[#252522] text-gray-300 border border-[#3a3a34]' : 'bg-white text-gray-700 border border-[#dddcd5]'}`}>
                      Allow planner to use screenshots for better planning decisions.
                    </span>
                  </span>
                </span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>Screenshots for planner</p>
              </div>
              <button
                type="button"
                onClick={() => updateLocalSetting('useVisionForPlanner', !settings.useVisionForPlanner, 'agent')}
                className={`toggle-slider ${settings.useVisionForPlanner ? 'toggle-on' : 'toggle-off'}`}
                aria-pressed={settings.useVisionForPlanner}>
                <span className="toggle-knob" />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Tab Previews</span>
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>In-chat mirroring</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateLocalSetting('showTabPreviews' as any, !((settings as any).showTabPreviews ?? true), 'agent')
                }
                className={`toggle-slider ${((settings as any).showTabPreviews ?? true) ? 'toggle-on' : 'toggle-off'}`}
                aria-pressed={(settings as any).showTabPreviews ?? true}>
                <span className="toggle-knob" />
              </button>
            </div>
          </div>
          <div className={`mt-4 border-t pt-4 ${isDarkMode ? 'border-[#2f2f29]' : 'border-[#dddcd5]'}`}>
            <h4 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Components</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between">
                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Planner</span>
                <button
                  type="button"
                  onClick={() => updateLocalSetting('enablePlanner', !settings.enablePlanner, 'agent')}
                  className={`toggle-slider ${settings.enablePlanner ? 'toggle-on' : 'toggle-off'}`}
                  aria-pressed={settings.enablePlanner}>
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Validator</span>
                <button
                  type="button"
                  onClick={() => updateLocalSetting('enableValidator', !settings.enableValidator, 'agent')}
                  className={`toggle-slider ${settings.enableValidator ? 'toggle-on' : 'toggle-off'}`}
                  aria-pressed={settings.enableValidator}>
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Multi-Agent Planner</span>
                <button
                  type="button"
                  onClick={() =>
                    updateLocalSetting('enableMultiagentPlanner', !settings.enableMultiagentPlanner, 'agent')
                  }
                  className={`toggle-slider ${settings.enableMultiagentPlanner ? 'toggle-on' : 'toggle-off'}`}
                  aria-pressed={settings.enableMultiagentPlanner}>
                  <span className="toggle-knob" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Multi-Agent Validator
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateLocalSetting('enableMultiagentValidator', !settings.enableMultiagentValidator, 'agent')
                  }
                  className={`toggle-slider ${settings.enableMultiagentValidator ? 'toggle-on' : 'toggle-off'}`}
                  aria-pressed={settings.enableMultiagentValidator}>
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>
          </div>
          <div className={`mt-4 border-t pt-4 space-y-4 ${isDarkMode ? 'border-[#2f2f29]' : 'border-[#dddcd5]'}`}>
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
            <div className={`pt-4 border-t ${isDarkMode ? 'border-[#2f2f29]' : 'border-[#dddcd5]'}`}>
              <h4 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Multi-Agent Model
              </h4>
              <p className={`text-xs mb-3 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                Single model used for all multi-agent roles (planner, worker, refiner)
              </p>
              <ModelSelect
                isDarkMode={isDarkMode}
                agentName={AgentNameEnum.MultiagentWorker}
                availableModels={availableModels}
                selectedValue={selectedModels[AgentNameEnum.MultiagentWorker] || ''}
                modelParameters={modelParameters[AgentNameEnum.MultiagentWorker]}
                thinkingLevelValue={thinkingLevel[AgentNameEnum.MultiagentWorker]}
                showAllModels={showAllModels}
                getAgentDisplayName={() => ''}
                getAgentDescription={() => ''}
                getAgentSectionColor={getSectionColor}
                hasModelPricing={hasModelPricing}
                onChangeModel={handleMultiAgentModelChange}
                onChangeParameter={(agent, param, value) => {
                  handleParameterChange(AgentNameEnum.MultiagentPlanner, param, value);
                  handleParameterChange(AgentNameEnum.MultiagentWorker, param, value);
                  handleParameterChange(AgentNameEnum.MultiagentRefiner, param, value);
                }}
                onChangeThinkingLevel={(agent, value) => {
                  handleThinkingLevelChange(AgentNameEnum.MultiagentPlanner, value);
                  handleThinkingLevelChange(AgentNameEnum.MultiagentWorker, value);
                  handleThinkingLevelChange(AgentNameEnum.MultiagentRefiner, value);
                }}
                hideHeader
              />
            </div>
          </div>
          <SectionApplyButton
            isDarkMode={isDarkMode}
            isDirty={dirtyCards.has('agent')}
            confirmed={confirmedCard === 'agent'}
            onApply={() => applyCard('agent')}
          />
        </div>
      </div>

      {/* History Context Summarization Section */}
      <div className={`rounded-xl border p-5 ${getSectionColor(AgentNameEnum.HistorySummariser)}`} style={{ order: 7 }}>
        <h2 className={`mb-4 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          History Context Summarization
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={`block text-xs mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                Window (hrs)
              </label>
              <input
                type="number"
                min={1}
                max={168}
                value={settings.historySummaryWindowHours || 24}
                onChange={e =>
                  updateLocalSetting(
                    'historySummaryWindowHours',
                    Math.max(1, Math.min(168, Number.parseInt(e.target.value, 10) || 24)),
                    'history',
                  )
                }
                className={`w-full rounded-lg border px-2 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
            <div>
              <label className={`block text-xs mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                Max Fetch
              </label>
              <input
                type="number"
                min={100}
                max={50000}
                step={100}
                value={settings.historySummaryMaxRawItems || 1000}
                onChange={e =>
                  updateLocalSetting(
                    'historySummaryMaxRawItems',
                    Math.max(100, Math.min(50000, Number.parseInt(e.target.value, 10) || 1000)),
                    'history',
                  )
                }
                className={`w-full rounded-lg border px-2 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
            <div>
              <label className={`block text-xs mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                Max to AI
              </label>
              <input
                type="number"
                min={50}
                max={2000}
                step={50}
                value={settings.historySummaryMaxProcessedItems || 50}
                onChange={e =>
                  updateLocalSetting(
                    'historySummaryMaxProcessedItems',
                    Math.max(50, Math.min(2000, Number.parseInt(e.target.value, 10) || 50)),
                    'history',
                  )
                }
                className={`w-full rounded-lg border px-2 py-1.5 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`}
              />
            </div>
          </div>
          <ModelSelect
            isDarkMode={isDarkMode}
            agentName={AgentNameEnum.HistorySummariser}
            availableModels={availableModels}
            selectedValue={selectedModels[AgentNameEnum.HistorySummariser] || ''}
            modelParameters={modelParameters[AgentNameEnum.HistorySummariser]}
            thinkingLevelValue={thinkingLevel[AgentNameEnum.HistorySummariser]}
            showAllModels={showAllModels}
            getAgentDisplayName={getAgentDisplayName}
            getAgentDescription={getAgentDescription}
            getAgentSectionColor={getSectionColor}
            hasModelPricing={hasModelPricing}
            onChangeModel={handleModelChange}
            onChangeParameter={handleParameterChange}
            onChangeThinkingLevel={handleThinkingLevelChange}
            hideHeader
          />
          <SectionApplyButton
            isDarkMode={isDarkMode}
            isDirty={dirtyCards.has('history')}
            confirmed={confirmedCard === 'history'}
            onApply={() => applyCard('history')}
          />
        </div>
      </div>

      {/* Workflow Estimation Section */}
      <div className={`rounded-xl border p-5 ${getSectionColor(AgentNameEnum.Estimator)}`} style={{ order: 8 }}>
        <h2 className={`mb-4 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          Workflow Estimation
        </h2>
        <ModelSelect
          isDarkMode={isDarkMode}
          agentName={AgentNameEnum.Estimator}
          availableModels={availableModels}
          selectedValue={selectedModels[AgentNameEnum.Estimator] || ''}
          modelParameters={modelParameters[AgentNameEnum.Estimator]}
          thinkingLevelValue={thinkingLevel[AgentNameEnum.Estimator]}
          showAllModels={showAllModels}
          getAgentDisplayName={getAgentDisplayName}
          getAgentDescription={getAgentDescription}
          getAgentSectionColor={getSectionColor}
          hasModelPricing={hasModelPricing}
          onChangeModel={handleModelChange}
          onChangeParameter={handleParameterChange}
          onChangeThinkingLevel={handleThinkingLevelChange}
          hideHeader
        />
        <SectionApplyButton
          isDarkMode={isDarkMode}
          isDirty={dirtyCards.has('estimator')}
          confirmed={confirmedCard === 'estimator'}
          onApply={() => applyCard('estimator')}
        />
      </div>
    </section>
  );
};
