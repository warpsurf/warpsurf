import { useEffect, useMemo, useState } from 'react';
import {
  agentModelStore,
  AgentNameEnum,
  llmProviderModelNames,
  secureProviderClient,
  type ProviderConfig,
} from '@extension/storage';

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
  const [isApplying, setIsApplying] = useState(false);

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
          return;
        }
      } catch {}
      if (availableModels.length > 0) setGlobalModel(availableModels[0].value);
    })();
  }, [availableModels]);

  const applyGlobalModel = async () => {
    if (!globalModel) return;
    const [provider, modelName] = globalModel.split('>');
    if (!provider || !modelName) return;
    setIsApplying(true);
    try {
      await Promise.all(
        ALL_AGENTS.map(agent =>
          agentModelStore.setAgentModel(agent, {
            provider,
            modelName,
          }),
        ),
      );
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <section
      className={`rounded-xl border p-5 ${isDarkMode ? 'border-[#2f2f29] bg-[#171715]' : 'border-[#dddcd5] bg-[#fbfbf8]'}`}>
      <h2 className={`text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>Workflow</h2>
      <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        Choose one global model for all workflows.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={globalModel}
          onChange={e => setGlobalModel(e.target.value)}
          className={`min-w-[360px] rounded-md border px-3 py-2 text-sm ${isDarkMode ? 'border-slate-700 bg-slate-800 text-slate-100' : 'border-gray-300 bg-white text-gray-800'}`}>
          {availableModels.length === 0 ? (
            <option value="">No models available - add API keys first</option>
          ) : (
            availableModels.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={applyGlobalModel}
          disabled={!globalModel || isApplying}
          className={`rounded-md px-3 py-2 text-sm font-medium ${isDarkMode ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]' : 'bg-[#ecebe5] text-gray-900 hover:bg-[#dfddd4]'} ${!globalModel || isApplying ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {isApplying ? 'Applying...' : 'Apply'}
        </button>
      </div>
    </section>
  );
}
