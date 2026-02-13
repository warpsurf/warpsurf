import { useEffect, useMemo, useState } from 'react';
import {
  agentModelStore,
  AgentNameEnum,
  llmProviderModelNames,
  secureProviderClient,
  type ProviderConfig,
  type ThinkingLevel,
} from '@extension/storage';

/**
 * Determine whether a model supports configurable thinking/reasoning.
 */
function isThinkingCapableModel(modelName: string): boolean {
  const raw = modelName.includes('>') ? modelName.split('>')[1] : modelName;
  const name = raw.includes('/') ? raw.split('/').pop()! : raw;
  const l = name.toLowerCase();

  if (/^(o1|o3|o4|gpt-5)/.test(l)) return true;
  if (/^claude-(opus-4|sonnet-4|sonnet-3-7|3-7-sonnet|haiku-4-5)/.test(l)) return true;
  if (/^gemini-(2\.5|3-)/.test(l)) return true;
  if (/^grok-(4|3-mini)/.test(l)) return true;

  return false;
}

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
      const isThinkingModel = isThinkingCapableModel(globalModel);
      await Promise.all(
        ALL_AGENTS.map(agent =>
          agentModelStore.setAgentModel(agent, {
            provider,
            modelName,
            thinkingLevel: isThinkingModel ? globalThinkingLevel : undefined,
          }),
        ),
      );
    } finally {
      setIsApplying(false);
    }
  };

  // Check if current model supports thinking
  const showThinkingLevel = globalModel && isThinkingCapableModel(globalModel);

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

      {/* Thinking Level Selector - only shown for thinking-capable models */}
      {showThinkingLevel && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            <span className="group relative inline-flex items-center gap-1">
              Thinking Level
              <span
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-gray-200 text-gray-700'}`}>
                ?
              </span>
              <span
                className={`pointer-events-none absolute bottom-full left-0 z-[9999] mb-1 hidden w-48 whitespace-normal rounded px-2 py-1 text-[10px] shadow-lg group-hover:block ${isDarkMode ? 'bg-slate-900 text-slate-100 border border-slate-700' : 'bg-gray-900 text-white border border-gray-800'}`}>
                Controls how much reasoning the model performs before responding
              </span>
            </span>
          </label>
          <select
            value={globalThinkingLevel}
            onChange={e => setGlobalThinkingLevel(e.target.value as ThinkingLevel)}
            className={`min-w-[200px] rounded-md border px-3 py-2 text-sm ${isDarkMode ? 'border-slate-700 bg-slate-800 text-slate-100' : 'border-gray-300 bg-white text-gray-800'}`}>
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
