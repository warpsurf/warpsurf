import type { ReactNode } from 'react';
import { cn } from './primitives';
import { ModelSelect } from './model-select';
import type { AgentNameEnum } from '@extension/storage';

interface AgentModelsSectionProps {
  isDarkMode: boolean;
  sectionTitle: string;
  agents: AgentNameEnum[];
  availableModels: Array<{ provider: string; providerName: string; model: string }>;
  selectedModels: Record<AgentNameEnum, string>;
  modelParameters: Record<AgentNameEnum, { temperature: number | undefined; maxOutputTokens: number }>;
  reasoningEffort: Record<AgentNameEnum, 'low' | 'medium' | 'high' | undefined>;
  showAllModels: boolean;
  getAgentDisplayName: (agent: AgentNameEnum) => string;
  getAgentDescription: (agent: AgentNameEnum) => string;
  getAgentSectionColor: (agent: AgentNameEnum) => string;
  hasModelPricing: (modelName: string) => boolean;
  onChangeModel: (agent: AgentNameEnum, value: string) => Promise<void> | void;
  onChangeParameter: (
    agent: AgentNameEnum,
    param: 'temperature' | 'maxOutputTokens',
    value: number | undefined,
  ) => Promise<void> | void;
  onChangeReasoning: (agent: AgentNameEnum, value: 'low' | 'medium' | 'high') => Promise<void> | void;
  children?: ReactNode;
  colorOverride?: string;
}

export function AgentModelsSection(props: AgentModelsSectionProps) {
  const {
    isDarkMode,
    sectionTitle,
    agents,
    availableModels,
    selectedModels,
    modelParameters,
    reasoningEffort,
    showAllModels,
    getAgentDisplayName,
    getAgentDescription,
    getAgentSectionColor,
    hasModelPricing,
    onChangeModel,
    onChangeParameter,
    onChangeReasoning,
    children,
    colorOverride,
  } = props;

  const defaultColor = isDarkMode ? 'border-slate-700/70 bg-slate-800/60' : 'border-white/20 bg-white/40';

  return (
    <div className={cn('rounded-xl border p-5 text-left shadow-sm backdrop-blur-md', colorOverride || defaultColor)}>
      <h3 className={cn('mb-4 text-lg font-semibold', isDarkMode ? 'text-gray-200' : 'text-gray-800')}>
        {sectionTitle}
      </h3>
      {children}
      {agents.length > 0 && (
        <div className="space-y-4">
          {agents.map(agent => (
            <ModelSelect
              key={agent}
              isDarkMode={isDarkMode}
              agentName={agent}
              availableModels={availableModels}
              selectedValue={selectedModels[agent] || ''}
              modelParameters={modelParameters[agent]}
              reasoningEffortValue={reasoningEffort[agent]}
              showAllModels={showAllModels}
              getAgentDisplayName={getAgentDisplayName}
              getAgentDescription={getAgentDescription}
              getAgentSectionColor={getAgentSectionColor}
              hasModelPricing={hasModelPricing}
              onChangeModel={onChangeModel}
              onChangeParameter={onChangeParameter}
              onChangeReasoning={onChangeReasoning}
            />
          ))}
        </div>
      )}
    </div>
  );
}
