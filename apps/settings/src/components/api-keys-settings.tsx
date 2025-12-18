/*
 * API Keys Settings Component
 * Handles LLM provider configuration (API keys, models, etc.)
 */
import { useEffect, useState, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '@extension/ui';
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
// Temporary: use console in settings to avoid direct background dependency
const apiKeysLogger = { error: (...args: any[]) => console.error(...args) } as const;

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
          const result = await (window as any).chrome?.runtime?.sendMessage?.({ type: 'get_provider_models', provider });
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
    const newEnabled = enabled
      ? [...currentEnabled, groupId]
      : currentEnabled.filter(id => id !== groupId);
    
    const newModels = openRouterGroups
      .filter(g => newEnabled.includes(g.id))
      .flatMap(g => g.models);

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
      const result = await ((window as any).chrome?.runtime?.sendMessage?.({ type: 'test_provider', providerId }) ?? (async () => ({ ok: false, error: 'Runtime unavailable' }))());
      if (result && result.ok) {
        const latency = typeof result.latencyMs === 'number' ? `${result.latencyMs} ms` : 'OK';
        setProviderTestLatency(prev => ({ ...prev, [providerId]: latency }));
      } else {
        const errorText = result?.error ? String(result.error) : `Status ${result?.status ?? ''}`;
        setProviderTestLatency(prev => ({ ...prev, [providerId]: `Error: ${errorText}` }));
      }
    } catch (e) {
      apiKeysLogger.error('Provider test failed', e);
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

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          🔑 LLM Provider API Keys
        </h2>
        <h6 className={`mb-4 text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Using uncapped API keys is risky. Where possible, set spending limits or caps to an amount you are comfortable losing.
        </h6>
        <div className="space-y-6">
          {getSortedProviders().length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <p className="mb-4">No providers configured yet. Add a provider to get started.</p>
            </div>
          ) : (
            getSortedProviders().map(([providerId, providerConfig]) => {
              if (!providerConfig || !providerConfig.type) {
                console.warn(`Skipping rendering for providerId ${providerId} due to missing config or type`);
                return null;
              }

              return (
                <div
                  key={providerId}
                  id={`provider-${providerId}`}
                  className={`space-y-4 ${modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) ? `rounded-lg border p-4 ${isDarkMode ? 'border-blue-700 bg-slate-700' : 'border-blue-200 bg-blue-50/70'}` : ''}`}>
                  <div className="flex items-center justify-between">
                    <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {providerConfig.name || providerId}
                    </h3>
                    <div className="flex space-x-2">
                      <Button variant="secondary" onClick={() => testProvider(providerId)}>
                        Test
                      </Button>
                      {providerTestLatency[providerId] && (
                        <span className={`${isDarkMode ? 'text-gray-300' : 'text-gray-600'} self-center text-xs`}>
                          {providerTestLatency[providerId]}
                        </span>
                      )}
                      {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
                        <Button variant="secondary" onClick={() => handleCancelProvider(providerId)}>
                          Cancel
                        </Button>
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

                  {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
                    <div className={`mb-2 text-sm ${isDarkMode ? 'text-teal-300' : 'text-teal-700'}`}>
                      <p>This provider is newly added. Enter your API key and click Save to configure it.</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {providerConfig.type === ProviderTypeEnum.CustomOpenAI && (
                      <div className="flex flex-col">
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-name`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Name
                          </label>
                          <input
                            id={`${providerId}-name`}
                            type="text"
                            placeholder="Provider name"
                            value={providerConfig.name || ''}
                            onChange={e => {
                              console.log('Name input changed:', e.target.value);
                              handleNameChange(providerId, e.target.value);
                            }}
                            className={`flex-1 rounded-md border p-2 text-sm ${
                              nameErrors[providerId]
                                ? isDarkMode
                                  ? 'border-red-700 bg-slate-700 text-gray-200 focus:border-red-600 focus:ring-2 focus:ring-red-900'
                                  : 'border-red-300 bg-gray-50 focus:border-red-400 focus:ring-2 focus:ring-red-200'
                                : isDarkMode
                                  ? 'border-blue-700 bg-slate-700 text-gray-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-900'
                                  : 'border-blue-300 bg-gray-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'
                            } outline-none`}
                          />
                        </div>
                        {nameErrors[providerId] ? (
                          <p className={`ml-20 mt-1 text-xs ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>
                            {nameErrors[providerId]}
                          </p>
                        ) : (
                          <p className={`ml-20 mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Provider name (spaces are not allowed when saving)
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center">
                      <label
                        htmlFor={`${providerId}-api-key`}
                        className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        API Key
                        {providerConfig.type !== ProviderTypeEnum.CustomOpenAI ? '*' : ''}
                      </label>
                      <div className="relative flex-1">
                        <input
                          id={`${providerId}-api-key`}
                          type={visibleApiKeys[providerId] ? 'text' : 'password'}
                          placeholder={
                            providerConfig.type === ProviderTypeEnum.CustomOpenAI
                              ? `${providerConfig.name || providerId} API key (optional)`
                              : `${providerConfig.name || providerId} API key (required)`
                          }
                          value={providerConfig.apiKey || ''}
                          onChange={e => handleApiKeyChange(providerId, e.target.value, providerConfig.baseUrl)}
                          className={`w-full rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
                        />
                        {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
                          <button
                            type="button"
                            className={`absolute right-2 top-1/2 -translate-y-1/2 ${
                              isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'
                            }`}
                            onClick={() => toggleApiKeyVisibility(providerId)}
                            aria-label={visibleApiKeys[providerId] ? 'Hide API key' : 'Show API key'}>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="size-5"
                              aria-hidden="true">
                              <title>{visibleApiKeys[providerId] ? 'Hide API key' : 'Show API key'}</title>
                              {visibleApiKeys[providerId] ? (
                                <>
                                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                  <circle cx="12" cy="12" r="3" />
                                  <line x1="2" y1="22" x2="22" y2="2" />
                                </>
                              ) : (
                                <>
                                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                  <circle cx="12" cy="12" r="3" />
                                </>
                              )}
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {(providerConfig.type === ProviderTypeEnum.CustomOpenAI ||
                      providerConfig.type === ProviderTypeEnum.OpenRouter) && (
                      <div className="flex flex-col">
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-base-url`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Base URL
                            {providerConfig.type === ProviderTypeEnum.CustomOpenAI ? '*' : ''}
                          </label>
                          <input
                            id={`${providerId}-base-url`}
                            type="text"
                            placeholder={
                              providerConfig.type === ProviderTypeEnum.CustomOpenAI
                                ? 'Required OpenAI-compatible API endpoint'
                                : 'OpenRouter Base URL (optional, defaults to https://openrouter.ai/api/v1)'
                            }
                            value={providerConfig.baseUrl || ''}
                            onChange={e => handleApiKeyChange(providerId, providerConfig.apiKey || '', e.target.value)}
                            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
                          />
                        </div>
                      </div>
                    )}

                    {providerConfig.type === ProviderTypeEnum.OpenRouter && (
                      <>
                        <div className="flex items-start">
                          <label className={`w-20 pt-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Providers
                          </label>
                          <div className="flex-1">
                            <button
                              type="button"
                              onClick={() => setOpenRouterProvidersExpanded(prev => !prev)}
                              className={`flex w-full items-center justify-between rounded-md border p-3 ${isDarkMode ? 'border-slate-600 bg-slate-700 hover:bg-slate-600' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
                            >
                              <span className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                                {(providerConfig.enabledSubProviders || []).length > 0
                                  ? `${(providerConfig.enabledSubProviders || []).length} provider(s) selected`
                                  : 'Select providers to add models'}
                              </span>
                              <svg
                                className={`h-4 w-4 transition-transform ${openRouterProvidersExpanded ? 'rotate-180' : ''} ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {openRouterProvidersExpanded && (
                              <div className={`mt-2 grid grid-cols-2 gap-2 rounded-md border p-3 ${isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-gray-300 bg-white'}`}>
                                {openRouterLoading ? (
                                  <span className={`col-span-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Loading...</span>
                                ) : openRouterGroups.length === 0 ? (
                                  <span className={`col-span-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>No providers available</span>
                                ) : (
                                  openRouterGroups.map(group => (
                                    <label key={group.id} className={`flex items-center gap-2 cursor-pointer rounded p-2 ${isDarkMode ? 'hover:bg-slate-600' : 'hover:bg-gray-100'}`}>
                                      <input
                                        type="checkbox"
                                        checked={(providerConfig.enabledSubProviders || []).includes(group.id)}
                                        onChange={e => handleOpenRouterProviderToggle(group.id, e.target.checked)}
                                        className="rounded border-gray-300"
                                      />
                                      <span className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>{group.displayName}</span>
                                      <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>({group.modelCount})</span>
                                    </label>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-start">
                          <label className={`w-20 pt-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Models
                          </label>
                          <div className="flex-1 space-y-2">
                            <div
                              className={`flex min-h-[42px] max-h-[200px] overflow-y-auto flex-wrap items-start gap-2 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2`}>
                              {providerConfig.modelNames && providerConfig.modelNames.length > 0 ? (
                                providerConfig.modelNames.map(model => (
                                  <div
                                    key={model}
                                    className={`flex items-center rounded-full ${isDarkMode ? 'bg-blue-900 text-blue-100' : 'bg-blue-100 text-blue-800'} px-2 py-1 text-sm`}>
                                    <span>{model}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeModel(providerId, model)}
                                      className={`ml-1 font-bold ${isDarkMode ? 'text-blue-300 hover:text-blue-100' : 'text-blue-600 hover:text-blue-800'}`}
                                      aria-label={`Remove ${model}`}>
                                      ×
                                    </button>
                                  </div>
                                ))
                              ) : (
                                <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                  No models selected. Select providers above to add models.
                                </span>
                              )}
                            </div>
                            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              {providerConfig.modelNames?.length || 0} models selected
                            </p>
                          </div>
                        </div>
                      </>
                    )}

                    {providerConfig.type !== ProviderTypeEnum.OpenRouter && (
                      <div className="flex items-start">
                        <label
                          htmlFor={`${providerId}-models-label`}
                          className={`w-20 pt-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          Models
                        </label>
                        <div className="flex-1 space-y-2">
                          <div
                            className={`flex min-h-[42px] flex-wrap items-center gap-2 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2`}>
                            {(() => {
                              const models =
                                providerConfig.modelNames !== undefined
                                  ? providerConfig.modelNames
                                  : llmProviderModelNames[providerId as keyof typeof llmProviderModelNames] || [];
                              return models.map(model => (
                                <div
                                  key={model}
                                  className={`flex items-center rounded-full ${isDarkMode ? 'bg-blue-900 text-blue-100' : 'bg-blue-100 text-blue-800'} px-2 py-1 text-sm`}>
                                  <span>{model}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeModel(providerId, model)}
                                    className={`ml-1 font-bold ${isDarkMode ? 'text-blue-300 hover:text-blue-100' : 'text-blue-600 hover:text-blue-800'}`}
                                    aria-label={`Remove ${model}`}>
                                    ×
                                  </button>
                                </div>
                              ));
                            })()}
                            <input
                              id={`${providerId}-models-input`}
                              type="text"
                              placeholder=""
                              value={newModelInputs[providerId] || ''}
                              onChange={e => handleModelsChange(providerId, e.target.value)}
                              onKeyDown={e => handleKeyDown(e, providerId)}
                              className={`min-w-[150px] flex-1 border-none text-sm ${isDarkMode ? 'bg-transparent text-gray-200' : 'bg-transparent text-gray-700'} p-1 outline-none`}
                            />
                          </div>
                          <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Type and Press Enter or Space to add.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {Object.keys(providers).indexOf(providerId) < Object.keys(providers).length - 1 && (
                    <div className={`mt-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`} />
                  )}
                </div>
              );
            })
          )}

          <div className="provider-selector-container relative pt-4">
            <Button
              variant="secondary"
              onClick={() => setIsProviderSelectorOpen(prev => !prev)}
              className={`flex w-full items-center justify-center font-medium ${
                isDarkMode
                  ? 'border-blue-700 bg-blue-600 text-white hover:bg-blue-500'
                  : 'border-blue-200 bg-blue-100 text-blue-800 hover:bg-blue-200'
              }`}>
              <span className="mr-2 text-sm">+</span> <span className="text-sm">Add New Provider</span>
            </Button>

            {isProviderSelectorOpen && (
              <div
                className={`absolute left-0 top-full z-10 mt-0 w-full overflow-hidden rounded-md border ${
                  isDarkMode
                    ? 'border-blue-600 bg-slate-700 shadow-lg shadow-slate-900/50'
                    : 'border-blue-200 bg-white shadow-xl shadow-blue-100/50'
                }`}>
                <div className="py-1">
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
                        className={`flex w-full items-center px-4 py-3 text-left text-sm ${
                          isDarkMode
                            ? 'text-blue-200 hover:bg-blue-600/30 hover:text-white'
                            : 'text-blue-700 hover:bg-blue-100 hover:text-blue-800'
                        } transition-colors duration-150`}
                        onClick={() => handleProviderSelection(type)}>
                        <span className="font-medium">{getDefaultDisplayNameFromProviderId(type)}</span>
                      </button>
                    ))}

                  <button
                    type="button"
                    className={`flex w-full items-center px-4 py-3 text-left text-sm ${
                      isDarkMode
                        ? 'text-blue-200 hover:bg-blue-600/30 hover:text-white'
                        : 'text-blue-700 hover:bg-blue-100 hover:text-blue-800'
                    } transition-colors duration-150`}
                    onClick={() => handleProviderSelection(ProviderTypeEnum.CustomOpenAI)}>
                    <span className="font-medium">OpenAI-compatible API Provider</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
