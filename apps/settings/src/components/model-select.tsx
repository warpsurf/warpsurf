import { ModelComboBox, TemperatureControl, LabelWithTooltip, cn } from './primitives';
import { AgentNameEnum, type ThinkingLevel } from '@extension/storage';

interface ModelSelectProps {
  isDarkMode: boolean;
  agentName: AgentNameEnum;
  availableModels: Array<{ provider: string; providerName: string; model: string }>;
  selectedValue: string;
  modelParameters: { temperature: number | undefined; maxOutputTokens: number };
  thinkingLevelValue?: ThinkingLevel;
  showAllModels: boolean;
  getAgentDisplayName: (agent: AgentNameEnum) => string;
  getAgentDescription: (agent: AgentNameEnum) => string;
  getAgentSectionColor: (agent: AgentNameEnum) => string;
  hasModelPricing: (modelName: string) => boolean;
  onChangeModel: (agent: AgentNameEnum, value: string) => void;
  onChangeParameter: (
    agent: AgentNameEnum,
    param: 'temperature' | 'maxOutputTokens',
    value: number | undefined,
  ) => void;
  onChangeThinkingLevel: (agent: AgentNameEnum, value: ThinkingLevel) => void;
  hideHeader?: boolean;
}

export function ModelSelect(props: ModelSelectProps) {
  const {
    isDarkMode,
    agentName,
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
    hideHeader = false,
  } = props;

  const sectionTone = getAgentSectionColor(agentName);
  const inputClass = cn(
    'rounded-lg border px-3 py-1.5 text-sm',
    isDarkMode ? 'border-[#3a3a34] bg-[#1d1d1a] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700',
  );

  const options = availableModels.map(({ provider, providerName, model }) => {
    const costNote = showAllModels && !hasModelPricing(model) ? ' (cost unknown)' : '';
    return { value: `${provider}>${model}`, label: `${providerName} > ${model}${costNote}` };
  });

  const displayName = getAgentDisplayName(agentName);
  const description = getAgentDescription(agentName);

  const wrapperClass = hideHeader ? '' : cn('rounded-xl border p-4', sectionTone);

  return (
    <div className={wrapperClass}>
      {!hideHeader && displayName && (
        <h3 className={cn('mb-1 text-sm font-medium', isDarkMode ? 'text-gray-200' : 'text-gray-800')}>
          {displayName}
        </h3>
      )}
      {!hideHeader && description && (
        <p className={cn('mb-3 text-xs', isDarkMode ? 'text-gray-500' : 'text-gray-500')}>{description}</p>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <LabelWithTooltip isDarkMode={isDarkMode} htmlFor={`${agentName}-model`} label="Model" width="w-20" />
          <ModelComboBox
            isDarkMode={isDarkMode}
            id={`${agentName}-model`}
            value={selectedValue || ''}
            options={options}
            onChange={v => onChangeModel(agentName, v)}
          />
        </div>

        {agentName === AgentNameEnum.Search && selectedValue && (
          <p className={cn('text-xs', isDarkMode ? 'text-gray-500' : 'text-gray-500')}>
            Web search compatibility varies by model.
          </p>
        )}

        <div className="flex items-center gap-3">
          <LabelWithTooltip isDarkMode={isDarkMode} htmlFor={`${agentName}-temperature`} label="Temp" width="w-20" />
          <TemperatureControl
            isDarkMode={isDarkMode}
            id={`${agentName}-temperature`}
            value={modelParameters.temperature}
            onChange={v => onChangeParameter(agentName, 'temperature', v)}
            ariaLabel={`${agentName} temperature`}
          />
        </div>

        <div className="flex items-center gap-3">
          <LabelWithTooltip
            isDarkMode={isDarkMode}
            htmlFor={`${agentName}-maxOutputTokens`}
            label="Max Out"
            width="w-20"
          />
          <input
            id={`${agentName}-maxOutputTokens`}
            type="number"
            min={256}
            max={65536}
            step={256}
            value={modelParameters.maxOutputTokens}
            onChange={e =>
              onChangeParameter(
                agentName,
                'maxOutputTokens',
                Math.max(256, Math.min(65536, Number.parseInt(e.target.value, 10) || 8192)),
              )
            }
            className={cn('w-24', inputClass)}
          />
        </div>

        {selectedValue && (
          <div className="flex items-center gap-3">
            <LabelWithTooltip
              isDarkMode={isDarkMode}
              htmlFor={`${agentName}-thinking-level`}
              label="Thinking"
              width="w-20"
            />
            <select
              id={`${agentName}-thinking-level`}
              value={thinkingLevelValue || 'default'}
              onChange={e => onChangeThinkingLevel(agentName, e.target.value as ThinkingLevel)}
              className={cn('flex-1', inputClass)}>
              <option value="default">Default</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="off">Off</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
