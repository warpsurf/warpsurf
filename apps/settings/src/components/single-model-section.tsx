import type { ReactNode } from 'react';
import { cn } from './primitives';
import { ModelSelect } from './model-select';
import type { AgentNameEnum, ThinkingLevel } from '@extension/storage';

interface SingleModelSectionProps {
  isDarkMode: boolean;
  title: string;
  agent: AgentNameEnum;
  availableModels: Array<{ provider: string; providerName: string; model: string }>;
  selectedValue: string;
  modelParameters: { temperature: number | undefined; maxOutputTokens: number };
  thinkingLevelValue?: ThinkingLevel;
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
  onChangeThinkingLevel: (agent: AgentNameEnum, value: ThinkingLevel) => Promise<void> | void;
  children?: ReactNode;
  saveIndicator?: ReactNode;
}

export function SingleModelSection(props: SingleModelSectionProps) {
  const {
    isDarkMode,
    title,
    agent,
    availableModels,
    selectedValue,
    modelParameters,
    thinkingLevelValue,
    showAllModels,
    getAgentDisplayName,
    getAgentDescription,
    getAgentSectionColor,
    hasModelPricing,
    onChangeModel,
    onChangeParameter,
    onChangeThinkingLevel,
    children,
    saveIndicator,
  } = props;

  const sectionColor = getAgentSectionColor(agent);

  return (
    <div className={cn('rounded-xl border p-5 text-left', sectionColor)}>
      <h2
        className={cn(
          'mb-4 flex items-center gap-2 text-base font-semibold',
          isDarkMode ? 'text-gray-100' : 'text-gray-900',
        )}>
        {title}
        {saveIndicator}
      </h2>
      <div className="space-y-4">
        <ModelSelect
          isDarkMode={isDarkMode}
          agentName={agent}
          availableModels={availableModels}
          selectedValue={selectedValue}
          modelParameters={modelParameters}
          thinkingLevelValue={thinkingLevelValue}
          showAllModels={showAllModels}
          getAgentDisplayName={getAgentDisplayName}
          getAgentDescription={getAgentDescription}
          getAgentSectionColor={getAgentSectionColor}
          hasModelPricing={hasModelPricing}
          onChangeModel={onChangeModel}
          onChangeParameter={onChangeParameter}
          onChangeThinkingLevel={onChangeThinkingLevel}
          hideHeader
        />
        {children}
      </div>
    </div>
  );
}
