import { useEffect, useState, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '@extension/ui';
import { FiKey, FiPlus, FiEye, FiEyeOff, FiChevronDown, FiX } from 'react-icons/fi';
import {
  secureProviderClient,
  llmProviderModelNames,
  ProviderTypeEnum,
  getDefaultDisplayNameFromProviderId,
  getDefaultProviderConfig,
  agentModelStore,
  AgentNameEnum,
  type ProviderConfig,
} from '@extension/storage';
import { hasModelPricing } from '../../../background/src/utils/cost-calculator';

interface ApiKeysSettingsProps {
  isDarkMode?: boolean;
}

interface OpenRouterProviderGroup {
  id: string;
  displayName: string;
  modelCount: number;
  models: string[];
}

export const ApiKeysSettings = ({ isDarkMode = false }: ApiKeysSettingsProps) => {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [modifiedProviders, setModifiedProviders] = useState<Set<string>>(new Set());
  const [providersFromStorage, setProvidersFromStorage] = useState<Set<string>>(new Set());
  const [newModelInputs, setNewModelInputs] = useState<Record<string, string>>({});
  const [isProviderSelectorOpen, setIsProviderSelectorOpen] = useState(false);
  const newlyAddedProviderRef = useRef<string | null>(null);
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>({});
  const [providerTestLatency, setProviderTestLatency] = useState<Record<string, string>>({});
  const [openRouterGroups, setOpenRouterGroups] = useState<OpenRouterProviderGroup[]>([]);
  const [openRouterLoading, setOpenRouterLoading] = useState(false);
  const [openRouterProvidersExpanded, setOpenRouterProvidersExpanded] = useState(false);
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const allProviders = await secureProviderClient.getAllProviders();
        const fromStorage = new Set(Object.keys(allProviders));
        setProvidersFromStorage(fromStorage);
        setProviders(allProviders);
      } catch (error) {
        console.error('Error loading providers:', error);
        setProviders({});
        setProvidersFromStorage(new Set());
      }
    };

    loadProviders();
  }, []);

  useEffect(() => {
    if (newlyAddedProviderRef.current && providers[newlyAddedProviderRef.current]) {
      const providerId = newlyAddedProviderRef.current;
      const config = providers[providerId];

      if (config.type === ProviderTypeEnum.CustomOpenAI) {
        const nameInput = document.getElementById(`${providerId}-name`);
        if (nameInput) {
          nameInput.focus();
        }
      } else {
        const apiKeyInput = document.getElementById(`${providerId}-api-key`);
        if (apiKeyInput) {
          apiKeyInput.focus();
        }
      }

      newlyAddedProviderRef.current = null;
    }
  }, [providers]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isProviderSelectorOpen && !target.closest('.provider-selector-container')) {
        setIsProviderSelectorOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProviderSelectorOpen]);

  // Load available models from model registry and merge with existing provider models
  const hasLoadedModels = useRef(false);
  useEffect(() => {
    // Wait for providers to load from storage before merging
    if (providersFromStorage.size === 0 && Object.keys(providers).length === 0) return;
    if (hasLoadedModels.current) return;
    hasLoadedModels.current = true;

    const loadAndMergeModels = async () => {
      try {
        const providerTypes = ['openai', 'anthropic', 'gemini', 'grok'];
        const results: Record<string, string[]> = {};
        const updates: Record<string, string[]> = {};

        for (const provider of providerTypes) {
          const result = await (window as any).chrome?.runtime?.sendMessage?.({
            type: 'get_provider_models',
            provider,
          });
          if (result?.ok && result.models?.length > 0) {
            results[provider] = result.models;

            // Merge with existing models (keep user-added, add new from registry)
            if (providers[provider]) {
              const existing = providers[provider].modelNames || [];
              const registrySet = new Set(result.models);
              // Keep user-added models (not in registry) + all registry models
              const userAdded = existing.filter(m => !registrySet.has(m));
              const merged = [...result.models, ...userAdded];
              if (merged.length !== existing.length || !merged.every((m, i) => m === existing[i])) {
                updates[provider] = merged;
              }
            }
          }
        }

        setAvailableModels(results);

        // Apply merged models to providers
        if (Object.keys(updates).length > 0) {
          setProviders(prev => {
            const newProviders = { ...prev };
            for (const [provider, models] of Object.entries(updates)) {
              if (newProviders[provider]) {
                newProviders[provider] = { ...newProviders[provider], modelNames: models };
              }
            }
            return newProviders;
          });
          // Mark as modified so they get saved
          Object.keys(updates).forEach(p => setModifiedProviders(prev => new Set(prev).add(p)));
        }
      } catch (e) {
        console.error('Failed to load available models:', e);
      }
    };
    loadAndMergeModels();
  }, [providersFromStorage, providers]);

  // Load OpenRouter provider groups
  useEffect(() => {
    const loadOpenRouterGroups = async () => {
      if (!providers['openrouter']) return;
      setOpenRouterLoading(true);
      try {
        const result = await (window as any).chrome?.runtime?.sendMessage?.({ type: 'get_openrouter_providers' });
        if (result?.ok && result.providers) {
          setOpenRouterGroups(result.providers);
        }
      } catch (e) {
        console.error('Failed to load OpenRouter providers:', e);
      }
      setOpenRouterLoading(false);
    };
    loadOpenRouterGroups();
  }, [providers['openrouter']?.apiKey]);

  const handleApiKeyChange = (provider: string, apiKey: string, baseUrl?: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        apiKey: apiKey.trim(),
        baseUrl: baseUrl !== undefined ? baseUrl.trim() : prev[provider]?.baseUrl,
      },
    }));
  };

  const toggleApiKeyVisibility = (provider: string) => {
    setVisibleApiKeys(prev => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  const handleNameChange = (provider: string, name: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const updated = {
        ...prev,
        [provider]: {
          ...prev[provider],
          name: name.trim(),
        },
      };
      return updated;
    });
  };

  const handleModelsChange = (provider: string, modelsString: string) => {
    setNewModelInputs(prev => ({
      ...prev,
      [provider]: modelsString,
    }));
  };

  const addModel = (provider: string, model: string) => {
    if (!model.trim()) return;

    const trimmedModel = model.trim();

    // Allow adding models without pricing data - costs will display as NaN
    if (!hasModelPricing(trimmedModel)) {
      console.info(`[Settings] Model '${trimmedModel}' has no pricing data - costs will display as NaN`);
    }

    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const providerData = prev[provider] || {};
      let currentModels = providerData.modelNames;
      if (currentModels === undefined) {
        currentModels = [...(llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [])];
      }

      if (currentModels.includes(trimmedModel)) return prev;

      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: [...currentModels, trimmedModel],
        },
      };
    });

    setNewModelInputs(prev => ({
      ...prev,
      [provider]: '',
    }));
  };

  const removeModel = (provider: string, modelToRemove: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));

    setProviders(prev => {
      const providerData = prev[provider] || {};

      if (!providerData.modelNames) {
        const defaultModels = llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
        const filteredModels = defaultModels.filter(model => model !== modelToRemove);

        return {
          ...prev,
          [provider]: {
            ...providerData,
            modelNames: filteredModels,
          },
        };
      }

      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: providerData.modelNames.filter(model => model !== modelToRemove),
        },
      };
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, provider: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const value = newModelInputs[provider] || '';
      addModel(provider, value);
    }
  };

  const handleOpenRouterProviderToggle = (groupId: string, enabled: boolean) => {
    const currentEnabled = providers['openrouter']?.enabledSubProviders || [];
    const newEnabled = enabled ? [...currentEnabled, groupId] : currentEnabled.filter(id => id !== groupId);

    const newModels = openRouterGroups.filter(g => newEnabled.includes(g.id)).flatMap(g => g.models);

    setModifiedProviders(prev => new Set(prev).add('openrouter'));
    setProviders(prev => ({
      ...prev,
      openrouter: {
        ...prev.openrouter,
        modelNames: newModels,
        enabledSubProviders: newEnabled,
      },
    }));
  };

  const getButtonProps = (provider: string) => {
    const isInStorage = providersFromStorage.has(provider);
    const isModified = modifiedProviders.has(provider);

    if (isInStorage && !isModified) {
      return {
        theme: isDarkMode ? 'dark' : 'light',
        variant: 'danger' as const,
        children: 'Delete',
        disabled: false,
      };
    }

    let hasInput = false;
    const providerType = providers[provider]?.type;
    const config = providers[provider];

    if (providerType === ProviderTypeEnum.CustomOpenAI) {
      hasInput = Boolean(config?.baseUrl?.trim());
    } else if (providerType === ProviderTypeEnum.OpenRouter) {
      hasInput = Boolean(config?.apiKey?.trim()) && Boolean(config?.baseUrl?.trim());
    } else {
      hasInput = Boolean(config?.apiKey?.trim());
    }

    return {
      theme: isDarkMode ? 'dark' : 'light',
      variant: 'primary' as const,
      children: 'Save',
      disabled: !hasInput || !isModified,
    };
  };

  const testProvider = async (providerId: string) => {
    try {
      const cfg = providers[providerId];
      if (!cfg) {
        setProviderTestLatency(prev => ({ ...prev, [providerId]: 'Not configured' }));
        return;
      }
      const result = await ((window as any).chrome?.runtime?.sendMessage?.({ type: 'test_provider', providerId }) ??
        (async () => ({ ok: false, error: 'Runtime unavailable' }))());
      if (result && result.ok) {
        const latency = typeof result.latencyMs === 'number' ? `${result.latencyMs} ms` : 'OK';
        setProviderTestLatency(prev => ({ ...prev, [providerId]: latency }));
      } else {
        const errorText = result?.error ? String(result.error) : `Status ${result?.status ?? ''}`;
        setProviderTestLatency(prev => ({ ...prev, [providerId]: `Error: ${errorText}` }));
      }
    } catch (e) {
      console.error('Provider test failed', e);
      setProviderTestLatency(prev => ({ ...prev, [providerId]: 'Error' }));
    }
  };

  const handleSave = async (provider: string) => {
    try {
      if (providers[provider].type === ProviderTypeEnum.CustomOpenAI && providers[provider].name?.includes(' ')) {
        setNameErrors(prev => ({
          ...prev,
          [provider]: 'Spaces are not allowed in provider names. Please use underscores or other characters instead.',
        }));
        return;
      }

      if (
        (providers[provider].type === ProviderTypeEnum.CustomOpenAI ||
          providers[provider].type === ProviderTypeEnum.OpenRouter) &&
        (!providers[provider].baseUrl || !providers[provider].baseUrl.trim())
      ) {
        alert(`Base URL is required for ${getDefaultDisplayNameFromProviderId(provider)}. Please enter it.`);
        return;
      }

      let modelNames = providers[provider].modelNames;
      if (!modelNames) {
        modelNames = [...(llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [])];
      }

      const configToSave: Partial<ProviderConfig> = { ...providers[provider] };
      configToSave.apiKey = providers[provider].apiKey || '';
      configToSave.name = providers[provider].name || getDefaultDisplayNameFromProviderId(provider);
      configToSave.type = providers[provider].type;
      configToSave.createdAt = providers[provider].createdAt || Date.now();
      configToSave.modelNames =
        providers[provider].modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
      if (providers[provider].type === ProviderTypeEnum.OpenRouter) {
        configToSave.enabledSubProviders = providers[provider].enabledSubProviders || [];
      }

      await secureProviderClient.setProvider(provider, configToSave as ProviderConfig);

      setNameErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[provider];
        return newErrors;
      });

      setProvidersFromStorage(prev => new Set(prev).add(provider));

      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });
    } catch (error) {
      console.error('Error saving API key:', error);
    }
  };

  const handleDelete = async (provider: string) => {
    try {
      await secureProviderClient.removeProvider(provider);

      // Clean up any agent models that reference this deleted provider
      try {
        const agentModels = await agentModelStore.getAllAgentModels();
        for (const [agentName, config] of Object.entries(agentModels)) {
          if (config?.provider === provider) {
            await agentModelStore.resetAgentModel(agentName as AgentNameEnum);
          }
        }
      } catch (e) {
        console.warn('Failed to cleanup orphaned agent models:', e);
      }

      setProvidersFromStorage(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      setProviders(prev => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });

      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });
    } catch (error) {
      console.error('Error deleting provider:', error);
    }
  };

  const handleCancelProvider = (providerId: string) => {
    setProviders(prev => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });

    setModifiedProviders(prev => {
      const next = new Set(prev);
      next.delete(providerId);
      return next;
    });
  };

  const getMaxCustomProviderNumber = () => {
    let maxNumber = 0;
    for (const providerId of Object.keys(providers)) {
      if (providerId.startsWith('custom_openai_')) {
        const match = providerId.match(/custom_openai_(\d+)/);
        if (match) {
          const number = Number.parseInt(match[1], 10);
          maxNumber = Math.max(maxNumber, number);
        }
      }
    }
    return maxNumber;
  };

  const addCustomProvider = () => {
    const nextNumber = getMaxCustomProviderNumber() + 1;
    const providerId = `custom_openai_${nextNumber}`;

    setProviders(prev => ({
      ...prev,
      [providerId]: {
        apiKey: '',
        name: `CustomProvider${nextNumber}`,
        type: ProviderTypeEnum.CustomOpenAI,
        baseUrl: '',
        modelNames: [],
        createdAt: Date.now(),
      },
    }));

    setModifiedProviders(prev => new Set(prev).add(providerId));
    newlyAddedProviderRef.current = providerId;

    setTimeout(() => {
      const providerElement = document.getElementById(`provider-${providerId}`);
      if (providerElement) {
        providerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const addBuiltInProvider = (provider: string) => {
    const config = getDefaultProviderConfig(provider);

    // Use dynamically fetched models from registry if available
    if (provider !== ProviderTypeEnum.OpenRouter && availableModels[provider]?.length > 0) {
      config.modelNames = [...availableModels[provider]];
    }

    setProviders(prev => ({
      ...prev,
      [provider]: config,
    }));

    setModifiedProviders(prev => new Set(prev).add(provider));
    newlyAddedProviderRef.current = provider;

    setTimeout(() => {
      const providerElement = document.getElementById(`provider-${provider}`);
      if (providerElement) {
        providerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const handleProviderSelection = (providerType: string) => {
    setIsProviderSelectorOpen(false);

    if (providerType === ProviderTypeEnum.CustomOpenAI) {
      addCustomProvider();
      return;
    }

    addBuiltInProvider(providerType);
  };

  const getSortedProviders = () => {
    const filteredProviders = Object.entries(providers).filter(([providerId, config]) => {
      if (!config || !config.type) {
        console.warn(`Filtering out provider ${providerId} with missing config or type.`);
        return false;
      }

      if (providersFromStorage.has(providerId)) {
        return true;
      }

      if (modifiedProviders.has(providerId)) {
        return true;
      }

      return false;
    });

    return filteredProviders.sort(([keyA, configA], [keyB, configB]) => {
      const isNewA = !providersFromStorage.has(keyA) && modifiedProviders.has(keyA);
      const isNewB = !providersFromStorage.has(keyB) && modifiedProviders.has(keyB);

      if (isNewA && !isNewB) return 1;
      if (!isNewA && isNewB) return -1;

      if (configA.createdAt && configB.createdAt) {
        return configA.createdAt - configB.createdAt;
      }

      if (configA.createdAt) return -1;
      if (configB.createdAt) return 1;

      const isCustomA = configA.type === ProviderTypeEnum.CustomOpenAI;
      const isCustomB = configB.type === ProviderTypeEnum.CustomOpenAI;

      if (isCustomA && !isCustomB) {
        return 1;
      }

      if (!isCustomA && isCustomB) {
        return -1;
      }

      return (configA.name || keyA).localeCompare(configB.name || keyB);
    });
  };

  const cardClass = `rounded-xl border p-5 ${isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]'}`;
  const inputClass = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'
  }`;
  const btnClass = `rounded-lg px-3 py-2 text-sm font-medium ${
    isDarkMode ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]' : 'bg-[#ecebe5] text-gray-800 hover:bg-[#dfddd4]'
  }`;

  return (
    <section className="space-y-5">
      <div className={cardClass}>
        <h2
          className={`mb-1 flex items-center gap-2 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          <FiKey className="h-4 w-4" /> LLM Provider API Keys
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Set spending limits with your provider — uncapped keys are risky.
        </p>

        <details className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          <summary className="cursor-pointer select-none font-medium">Need an API key?</summary>
          <p className="mt-2">
            Gemini offers a free tier.{' '}
            <a
              href="https://ai.google.dev/gemini-api/docs/api-key"
              target="_blank"
              rel="noopener noreferrer"
              className={isDarkMode ? 'text-gray-300 underline' : 'text-gray-700 underline'}>
              Create a Gemini API key
            </a>
          </p>
        </details>

        <div className="space-y-4">
          {getSortedProviders().length === 0 ? (
            <p className={`py-6 text-center text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              No providers configured. Add one to get started.
            </p>
          ) : (
            getSortedProviders().map(([providerId, providerConfig]) => {
              if (!providerConfig || !providerConfig.type) return null;
              const isNew = modifiedProviders.has(providerId) && !providersFromStorage.has(providerId);

              return (
                <div
                  key={providerId}
                  id={`provider-${providerId}`}
                  className={`space-y-3 ${isNew ? `rounded-xl border p-4 ${isDarkMode ? 'border-[#3a3a34] bg-[#252522]' : 'border-[#dddcd5] bg-[#f3f2ee]'}` : ''}`}>
                  <div className="flex items-center justify-between">
                    <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      {providerConfig.name || providerId}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => testProvider(providerId)} className={btnClass}>
                        Test
                      </button>
                      {providerTestLatency[providerId] && (
                        <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {providerTestLatency[providerId]}
                        </span>
                      )}
                      {isNew && (
                        <button type="button" onClick={() => handleCancelProvider(providerId)} className={btnClass}>
                          Cancel
                        </button>
                      )}
                      <Button
                        variant={getButtonProps(providerId).variant}
                        disabled={getButtonProps(providerId).disabled}
                        onClick={() =>
                          providersFromStorage.has(providerId) && !modifiedProviders.has(providerId)
                            ? handleDelete(providerId)
                            : handleSave(providerId)
                        }>
                        {getButtonProps(providerId).children}
                      </Button>
                    </div>
                  </div>

                  {isNew && (
                    <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      Enter your API key and click Save.
                    </p>
                  )}

                  <div className="space-y-2">
                    {providerConfig.type === ProviderTypeEnum.CustomOpenAI && (
                      <div className="flex items-center gap-3">
                        <label
                          htmlFor={`${providerId}-name`}
                          className={`w-20 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Name
                        </label>
                        <div className="flex-1">
                          <input
                            id={`${providerId}-name`}
                            type="text"
                            placeholder="Provider name"
                            value={providerConfig.name || ''}
                            onChange={e => handleNameChange(providerId, e.target.value)}
                            className={inputClass}
                          />
                          {nameErrors[providerId] && (
                            <p className={`mt-1 text-xs ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>
                              {nameErrors[providerId]}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <label
                        htmlFor={`${providerId}-api-key`}
                        className={`w-20 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        API Key{providerConfig.type !== ProviderTypeEnum.CustomOpenAI && '*'}
                      </label>
                      <div className="relative flex-1">
                        <input
                          id={`${providerId}-api-key`}
                          type={visibleApiKeys[providerId] ? 'text' : 'password'}
                          placeholder={providerConfig.type === ProviderTypeEnum.CustomOpenAI ? 'Optional' : 'Required'}
                          value={providerConfig.apiKey || ''}
                          onChange={e => handleApiKeyChange(providerId, e.target.value, providerConfig.baseUrl)}
                          className={inputClass}
                        />
                        {isNew && (
                          <button
                            type="button"
                            className={`absolute right-2 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}
                            onClick={() => toggleApiKeyVisibility(providerId)}>
                            {visibleApiKeys[providerId] ? (
                              <FiEyeOff className="h-4 w-4" />
                            ) : (
                              <FiEye className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {(providerConfig.type === ProviderTypeEnum.CustomOpenAI ||
                      providerConfig.type === ProviderTypeEnum.OpenRouter) && (
                      <div className="flex items-center gap-3">
                        <label
                          htmlFor={`${providerId}-base-url`}
                          className={`w-20 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Base URL{providerConfig.type === ProviderTypeEnum.CustomOpenAI && '*'}
                        </label>
                        <input
                          id={`${providerId}-base-url`}
                          type="text"
                          placeholder={providerConfig.type === ProviderTypeEnum.CustomOpenAI ? 'Required' : 'Optional'}
                          value={providerConfig.baseUrl || ''}
                          onChange={e => handleApiKeyChange(providerId, providerConfig.apiKey || '', e.target.value)}
                          className={inputClass}
                        />
                      </div>
                    )}

                    {providerConfig.type === ProviderTypeEnum.OpenRouter && (
                      <>
                        <div className="flex items-start gap-3">
                          <label className={`w-20 pt-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Providers
                          </label>
                          <div className="flex-1">
                            <button
                              type="button"
                              onClick={() => setOpenRouterProvidersExpanded(prev => !prev)}
                              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                                isDarkMode
                                  ? 'border-[#3a3a34] bg-[#252522] text-gray-200'
                                  : 'border-[#dddcd5] bg-white text-gray-700'
                              }`}>
                              <span>
                                {(providerConfig.enabledSubProviders || []).length > 0
                                  ? `${(providerConfig.enabledSubProviders || []).length} selected`
                                  : 'Select providers'}
                              </span>
                              <FiChevronDown
                                className={`h-4 w-4 transition-transform ${openRouterProvidersExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>
                            {openRouterProvidersExpanded && (
                              <div
                                className={`mt-2 grid grid-cols-2 gap-1 rounded-lg border p-2 ${
                                  isDarkMode ? 'border-[#3a3a34] bg-[#252522]' : 'border-[#dddcd5] bg-white'
                                }`}>
                                {openRouterLoading ? (
                                  <span
                                    className={`col-span-2 text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    Loading...
                                  </span>
                                ) : openRouterGroups.length === 0 ? (
                                  <span
                                    className={`col-span-2 text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    No providers
                                  </span>
                                ) : (
                                  openRouterGroups.map(group => (
                                    <label
                                      key={group.id}
                                      className={`flex items-center gap-2 cursor-pointer rounded px-2 py-1 text-sm ${
                                        isDarkMode ? 'hover:bg-[#33332e]' : 'hover:bg-[#f3f2ee]'
                                      }`}>
                                      <input
                                        type="checkbox"
                                        checked={(providerConfig.enabledSubProviders || []).includes(group.id)}
                                        onChange={e => handleOpenRouterProviderToggle(group.id, e.target.checked)}
                                        className="rounded"
                                      />
                                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                                        {group.displayName}
                                      </span>
                                      <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>
                                        ({group.modelCount})
                                      </span>
                                    </label>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <label className={`w-20 pt-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Models
                          </label>
                          <div className="flex-1">
                            <div
                              className={`flex min-h-[40px] max-h-48 overflow-y-auto flex-wrap gap-1.5 rounded-lg border p-2 ${
                                isDarkMode ? 'border-[#3a3a34] bg-[#252522]' : 'border-[#dddcd5] bg-white'
                              }`}>
                              {providerConfig.modelNames && providerConfig.modelNames.length > 0 ? (
                                providerConfig.modelNames.map(model => (
                                  <span
                                    key={model}
                                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                                      isDarkMode ? 'bg-[#2a3a3a] text-teal-300' : 'bg-[#e8f4f4] text-teal-800'
                                    }`}>
                                    {model}
                                    <button
                                      type="button"
                                      onClick={() => removeModel(providerId, model)}
                                      className="hover:opacity-70">
                                      <FiX className="h-3 w-3" />
                                    </button>
                                  </span>
                                ))
                              ) : (
                                <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                  Select providers above
                                </span>
                              )}
                            </div>
                            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                              {providerConfig.modelNames?.length || 0} models
                            </p>
                          </div>
                        </div>
                      </>
                    )}

                    {providerConfig.type !== ProviderTypeEnum.OpenRouter && (
                      <div className="flex items-start gap-3">
                        <label className={`w-20 pt-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Models
                        </label>
                        <div className="flex-1">
                          <div
                            className={`flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-lg border p-2 ${
                              isDarkMode ? 'border-[#3a3a34] bg-[#252522]' : 'border-[#dddcd5] bg-white'
                            }`}>
                            {(() => {
                              const models =
                                providerConfig.modelNames ??
                                llmProviderModelNames[providerId as keyof typeof llmProviderModelNames] ??
                                [];
                              return models.map(model => (
                                <span
                                  key={model}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                                    isDarkMode ? 'bg-[#2a3a3a] text-teal-300' : 'bg-[#e8f4f4] text-teal-800'
                                  }`}>
                                  {model}
                                  <button
                                    type="button"
                                    onClick={() => removeModel(providerId, model)}
                                    className="hover:opacity-70">
                                    <FiX className="h-3 w-3" />
                                  </button>
                                </span>
                              ));
                            })()}
                            <input
                              id={`${providerId}-models-input`}
                              type="text"
                              value={newModelInputs[providerId] || ''}
                              onChange={e => handleModelsChange(providerId, e.target.value)}
                              onKeyDown={e => handleKeyDown(e, providerId)}
                              placeholder="Add model..."
                              className={`min-w-[100px] flex-1 border-none bg-transparent p-1 text-sm outline-none ${
                                isDarkMode ? 'text-gray-200 placeholder-gray-600' : 'text-gray-700 placeholder-gray-400'
                              }`}
                            />
                          </div>
                          <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                            Press Enter or Space to add
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {Object.keys(providers).indexOf(providerId) < Object.keys(providers).length - 1 && (
                    <div className={`mt-3 border-t ${isDarkMode ? 'border-[#2f2f29]' : 'border-[#dddcd5]'}`} />
                  )}
                </div>
              );
            })
          )}

          <div className="provider-selector-container relative pt-3">
            <button
              type="button"
              onClick={() => setIsProviderSelectorOpen(prev => !prev)}
              className={`flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium ${btnClass}`}>
              <FiPlus className="h-4 w-4" /> Add Provider
            </button>

            {isProviderSelectorOpen && (
              <div
                className={`absolute left-0 top-full z-10 mt-1 w-full overflow-hidden rounded-xl border ${
                  isDarkMode ? 'border-[#3a3a34] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-white'
                }`}>
                {Object.values(ProviderTypeEnum)
                  .filter(
                    type =>
                      type !== ProviderTypeEnum.CustomOpenAI &&
                      !providersFromStorage.has(type) &&
                      !modifiedProviders.has(type),
                  )
                  .map(type => (
                    <button
                      key={type}
                      type="button"
                      className={`flex w-full items-center px-4 py-2.5 text-left text-sm ${
                        isDarkMode ? 'text-gray-300 hover:bg-[#252522]' : 'text-gray-700 hover:bg-[#f3f2ee]'
                      }`}
                      onClick={() => handleProviderSelection(type)}>
                      {getDefaultDisplayNameFromProviderId(type)}
                    </button>
                  ))}
                <button
                  type="button"
                  className={`flex w-full items-center px-4 py-2.5 text-left text-sm ${
                    isDarkMode ? 'text-gray-300 hover:bg-[#252522]' : 'text-gray-700 hover:bg-[#f3f2ee]'
                  }`}
                  onClick={() => handleProviderSelection(ProviderTypeEnum.CustomOpenAI)}>
                  OpenAI-compatible API
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
