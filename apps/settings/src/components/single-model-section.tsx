import type { ReactNode } from 'react';
import { cn } from './primitives';
import { ModelSelect } from './model-select';
import type { AgentNameEnum, ProviderConfig } from '@extension/storage';

interface SingleModelSectionProps {
  isDarkMode: boolean;
  title: string; // "Chat", "Search", etc.
  agent: AgentNameEnum;
  providers: Record<string, ProviderConfig>;
  availableModels: Array<{ provider: string; providerName: string; model: string }>;
  selectedValue: string;
  modelParameters: { temperature: number; maxOutputTokens: number };
  reasoningEffortValue?: 'low' | 'medium' | 'high';
  showAllModels: boolean;
  getAgentDisplayName: (agent: AgentNameEnum) => string;
  getAgentDescription: (agent: AgentNameEnum) => string;
  getAgentSectionColor: (agent: AgentNameEnum) => string;
  supportsNativeSearch: (providerConfig: ProviderConfig | undefined, modelName: string) => boolean;
  hasModelPricing: (modelName: string) => boolean;
  onChangeModel: (agent: AgentNameEnum, value: string) => Promise<void> | void;
  onChangeParameter: (agent: AgentNameEnum, param: 'temperature' | 'maxOutputTokens', value: number) => Promise<void> | void;
  onChangeReasoning: (agent: AgentNameEnum, value: 'low' | 'medium' | 'high') => Promise<void> | void;
  webSearchEnabled: boolean;
  children?: ReactNode;
}

export function SingleModelSection(props: SingleModelSectionProps) {
  const {
    isDarkMode,
    title,
    agent,
    providers,
    availableModels,
    selectedValue,
    modelParameters,
    reasoningEffortValue,
    showAllModels,
    getAgentDisplayName,
    getAgentDescription,
    getAgentSectionColor,
    supportsNativeSearch,
    hasModelPricing,
    onChangeModel,
    onChangeParameter,
    onChangeReasoning,
    webSearchEnabled,
    children,
  } = props;

  return (
    <div className={cn('rounded-xl border p-5 text-left shadow-sm backdrop-blur-md', getAgentSectionColor(agent))}>
      <h2 className={cn('mb-4 text-lg font-semibold', isDarkMode ? 'text-gray-200' : 'text-gray-800')}>{title}</h2>
      <div className="space-y-4">
        <ModelSelect
          isDarkMode={isDarkMode}
          agentName={agent}
          providers={providers}
          availableModels={availableModels}
          selectedValue={selectedValue}
          modelParameters={modelParameters}
          reasoningEffortValue={reasoningEffortValue}
          showAllModels={showAllModels}
          getAgentDisplayName={getAgentDisplayName}
          getAgentDescription={getAgentDescription}
          getAgentSectionColor={getAgentSectionColor}
          supportsNativeSearch={supportsNativeSearch}
          hasModelPricing={hasModelPricing}
          onChangeModel={onChangeModel}
          onChangeParameter={onChangeParameter}
          onChangeReasoning={onChangeReasoning}
          webSearchEnabled={webSearchEnabled}
        />
        {children}
      </div>
    </div>
  );
}

