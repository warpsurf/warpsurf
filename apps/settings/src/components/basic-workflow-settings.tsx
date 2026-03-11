import { useEffect, useMemo, useState } from 'react';
import {
  agentModelStore,
  AgentNameEnum,
  llmProviderModelNames,
  secureProviderClient,
  type ProviderConfig,
  type ThinkingLevel,
} from '@extension/storage';
import { SaveIndicator, useStorageConfirmation } from './primitives';

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
  const [isApplying, setIsApplying] = useState(false);
  const confirmation = useStorageConfirmation('agent-models');

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

  const applyGlobalModel = async () => {
    if (!globalModel) return;
    const [provider, modelName] = globalModel.split('>');
    if (!provider || !modelName) return;
    setIsApplying(true);
    confirmation.markPending();
    try {
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
            thinkingLevel: globalThinkingLevel,
            webSearch,
          });
        }),
      );
    } finally {
      setIsApplying(false);
    }
  };

  // Model section: pale rose/pink tint
  const cardClass = `rounded-xl border p-5 ${isDarkMode ? 'border-[#403840] bg-[#282426]' : 'border-[#ebe4e8] bg-[#faf6f8]'}`;
  const selectClass = `rounded-lg border px-3 py-2 text-sm ${isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'}`;
  const btnClass = `rounded-lg px-3 py-2 text-sm font-medium ${isDarkMode ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]' : 'bg-[#ecebe5] text-gray-800 hover:bg-[#dfddd4]'}`;

  return (
    <section className={cardClass}>
      <h2 className={`text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>Model</h2>
      <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        Choose one global model for all agents.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={globalModel}
          onChange={e => setGlobalModel(e.target.value)}
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
        <button
          type="button"
          onClick={applyGlobalModel}
          disabled={!globalModel || isApplying}
          className={`${btnClass} ${!globalModel || isApplying ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {isApplying ? 'Applying...' : 'Apply'}
        </button>
        <SaveIndicator show={confirmation.confirmed} isDarkMode={isDarkMode} message="Applied" />
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
            onChange={e => setGlobalThinkingLevel(e.target.value as ThinkingLevel)}
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
