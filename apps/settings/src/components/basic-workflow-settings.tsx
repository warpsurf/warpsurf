import { useEffect, useMemo, useState } from 'react';
import {
  agentModelStore,
  AgentNameEnum,
  llmProviderModelNames,
  secureProviderClient,
  type ProviderConfig,
  type ThinkingLevel,
} from '@extension/storage';
import { SaveIndicator, useSaveIndicator } from './primitives';

interface BasicWorkflowSettingsProps {
  isDarkMode?: boolean;
}

const ALL_AGENTS: AgentNameEnum[] = [
  AgentNameEnum.Auto,
  AgentNameEnum.Chat,
  AgentNameEnum.Search,
  AgentNameEnum.AgentPlanner,
  AgentNameEnum.AgentNavigator,
  AgentNameEnum.AgentValidator,
  AgentNameEnum.MultiagentPlanner,
  AgentNameEnum.MultiagentWorker,
  AgentNameEnum.MultiagentRefiner,
  AgentNameEnum.HistorySummariser,
  AgentNameEnum.Estimator,
];

export function BasicWorkflowSettings({ isDarkMode = false }: BasicWorkflowSettingsProps) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [globalModel, setGlobalModel] = useState('');
  const [globalThinkingLevel, setGlobalThinkingLevel] = useState<ThinkingLevel>('default');
  const saved = useSaveIndicator();

  useEffect(() => {
    (async () => {
      try {
        const allProviders = await secureProviderClient.getAllProviders();
        setProviders(allProviders);
      } catch {
        setProviders({});
      }
    })();
  }, []);

  const availableModels = useMemo(() => {
    const items: Array<{ value: string; label: string }> = [];
    for (const [provider, config] of Object.entries(providers)) {
      if (!config?.apiKey) continue;
      const models = config.modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
      for (const model of models) {
        items.push({ value: `${provider}>${model}`, label: `${config.name || provider} > ${model}` });
      }
    }
    return items;
  }, [providers]);

  useEffect(() => {
    (async () => {
      try {
        const autoConfig = await agentModelStore.getAgentModel(AgentNameEnum.Auto);
        if (autoConfig?.provider && autoConfig?.modelName) {
          setGlobalModel(`${autoConfig.provider}>${autoConfig.modelName}`);
          if (autoConfig.thinkingLevel) {
            setGlobalThinkingLevel(autoConfig.thinkingLevel);
          }
          return;
        }
      } catch {}
      if (availableModels.length > 0) setGlobalModel(availableModels[0].value);
    })();
  }, [availableModels]);

  const applyToAllAgents = async (model: string, thinkingLevel: ThinkingLevel) => {
    if (!model) return;
    const [provider, modelName] = model.split('>');
    if (!provider || !modelName) return;
    await Promise.all(
      ALL_AGENTS.map(async agent => {
        const existing = await agentModelStore.getAgentModel(agent);
        const maxOutputTokens = (existing?.parameters?.maxOutputTokens as number) || 8192;
        const temperature = existing?.parameters?.temperature as number | undefined;
        const webSearch = agent === AgentNameEnum.Search ? true : (existing?.webSearch ?? false);
        await agentModelStore.setAgentModel(agent, {
          provider,
          modelName,
          parameters: { maxOutputTokens, ...(temperature !== undefined && { temperature }) },
          thinkingLevel,
          webSearch,
        });
      }),
    );
    saved.trigger();
  };

  const handleModelChange = async (value: string) => {
    setGlobalModel(value);
    await applyToAllAgents(value, globalThinkingLevel);
  };

  const handleThinkingLevelChange = async (value: ThinkingLevel) => {
    setGlobalThinkingLevel(value);
    await applyToAllAgents(globalModel, value);
  };

  const cardClass = `rounded-xl border p-5 ${isDarkMode ? 'border-[#403840] bg-[#282426]' : 'border-[#ebe4e8] bg-[#faf6f8]'}`;
  const selectClass = `rounded-lg border px-3 py-2 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`;

  return (
    <section className={cardClass}>
      <h2
        className={`flex items-center gap-2 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
        Model
        <SaveIndicator show={saved.show} isDarkMode={isDarkMode} />
      </h2>
      <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        Choose one global model for all agents.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={globalModel}
          onChange={e => handleModelChange(e.target.value)}
          className={`min-w-[360px] ${selectClass}`}>
          {availableModels.length === 0 ? (
            <option value="">No models — add API keys first</option>
          ) : (
            availableModels.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))
          )}
        </select>
      </div>

      {globalModel && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            <span className="group relative inline-flex items-center gap-1">
              Thinking Level
              <span
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${isDarkMode ? 'bg-[#3a3a34] text-gray-400' : 'bg-[#e5e4de] text-gray-600'}`}>
                ?
              </span>
              <span
                className={`pointer-events-none absolute bottom-full left-0 z-[9999] mb-1 hidden w-48 whitespace-normal rounded-lg px-2 py-1 text-[10px] group-hover:block ${isDarkMode ? 'bg-[#252522] text-gray-300 border border-[#3a3a34]' : 'bg-white text-gray-700 border border-[#dddcd5]'}`}>
                Controls reasoning depth for supported models. Set to Default if unsupported.
              </span>
            </span>
          </label>
          <select
            value={globalThinkingLevel}
            onChange={e => handleThinkingLevelChange(e.target.value as ThinkingLevel)}
            className={`min-w-[160px] ${selectClass}`}>
            <option value="default">Default</option>
            <option value="high">High (Thorough)</option>
            <option value="medium">Medium (Balanced)</option>
            <option value="low">Low (Faster)</option>
            <option value="off">Off (Suppress)</option>
          </select>
        </div>
      )}
    </section>
  );
}
