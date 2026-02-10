import { ModelComboBox, TemperatureControl, LabelWithTooltip, cn, isThinkingCapableModel } from './primitives';
import { AgentNameEnum, type ThinkingLevel } from '@extension/storage';
import { WEB_SEARCH_COMPATIBILITY_WARNING } from './agent-helpers';

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
  } = props;

  const sectionTone = getAgentSectionColor(agentName);
  const options = availableModels.map(({ provider, providerName, model }) => {
    const costNote = showAllModels && !hasModelPricing(model) ? ' (cost unknown)' : '';
    return { value: `${provider}>${model}`, label: `${providerName} > ${model}${costNote}` };
  });

  return (
    <div className={cn('rounded-xl border p-4 shadow-sm', sectionTone)}>
      <h3 className={cn('mb-2 text-base font-semibold', isDarkMode ? 'text-gray-200' : 'text-gray-800')}>
        {getAgentDisplayName(agentName)}
      </h3>
      <p className={cn('mb-4 text-sm font-normal', isDarkMode ? 'text-gray-400' : 'text-gray-500')}>
        {getAgentDescription(agentName)}
      </p>

      <div className="space-y-4">
        <div className="flex items-center">
          <LabelWithTooltip
            isDarkMode={isDarkMode}
            htmlFor={`${agentName}-model`}
            label="Model"
            tooltip="Choose provider and model for this role"
          />
          <div className="flex flex-1 items-center space-x-2">
            <ModelComboBox
              isDarkMode={isDarkMode}
              id={`${agentName}-model`}
              value={selectedValue || ''}
              options={options}
              onChange={v => onChangeModel(agentName, v)}
            />
          </div>
        </div>

        {agentName === AgentNameEnum.Search && selectedValue && (
          <div
            className={cn(
              'rounded-md px-3 py-2 text-xs',
              isDarkMode ? 'bg-amber-900/30 text-amber-300' : 'bg-amber-100 text-amber-700',
            )}>
            {WEB_SEARCH_COMPATIBILITY_WARNING}
          </div>
        )}

        <div className="flex items-center">
          <LabelWithTooltip
            isDarkMode={isDarkMode}
            htmlFor={`${agentName}-temperature`}
            label="Temperature"
            tooltip="Controls randomness of outputs. Leave as default to use the provider's recommended temperature."
          />
          <TemperatureControl
            isDarkMode={isDarkMode}
            id={`${agentName}-temperature`}
            value={modelParameters.temperature}
            onChange={v => onChangeParameter(agentName, 'temperature', v)}
            ariaLabel={`${agentName} temperature input`}
          />
        </div>

        <div className="flex items-center">
          <LabelWithTooltip
            isDarkMode={isDarkMode}
            htmlFor={`${agentName}-maxOutputTokens`}
            label="Max Output"
            tooltip="Maximum tokens in model response"
          />
          <div className="flex flex-1 items-center space-x-2">
            <input
              id={`${agentName}-maxOutputTokens`}
              type="number"
              min={256}
              max={65536}
              step={256}
              value={modelParameters.maxOutputTokens}
              onChange={e => {
                const val = Math.max(256, Math.min(65536, Number.parseInt(e.target.value, 10) || 8192));
                onChangeParameter(agentName, 'maxOutputTokens', val);
              }}
              className={cn(
                'w-24 rounded-md border px-3 py-2 text-sm',
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700',
              )}
              aria-label={`${agentName} max output tokens`}
            />
          </div>
        </div>

        {selectedValue && isThinkingCapableModel(selectedValue) && (
          <div className="flex items-center">
            <LabelWithTooltip
              isDarkMode={isDarkMode}
              htmlFor={`${agentName}-thinking-level`}
              label="Thinking"
              tooltip="Controls how much reasoning the model performs before responding"
            />
            <div className="flex flex-1 items-center space-x-2">
              <select
                id={`${agentName}-thinking-level`}
                value={thinkingLevelValue || 'default'}
                onChange={e => onChangeThinkingLevel(agentName, e.target.value as ThinkingLevel)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-sm',
                  isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700',
                )}>
                <option value="default">Default</option>
                <option value="high">High (Thorough)</option>
                <option value="medium">Medium (Balanced)</option>
                <option value="low">Low (Faster)</option>
                <option value="off">Off (Suppress)</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
