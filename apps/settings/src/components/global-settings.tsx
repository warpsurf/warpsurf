import { LabelWithTooltip, cn, ModelComboBox, TemperatureControl, SaveIndicator } from './primitives';
import { WEB_SEARCH_COMPATIBILITY_WARNING } from './agent-helpers';
import type { ThinkingLevel } from '@extension/storage';

export interface GlobalModelOption {
  provider: string;
  providerName: string;
  model: string;
}

export interface GlobalModelParameters {
  temperature: number | undefined;
  maxOutputTokens: number;
  thinkingLevel: ThinkingLevel;
}

interface GlobalSettingsProps {
  isDarkMode: boolean;
  // Global model selection
  availableModels: GlobalModelOption[];
  globalModelValue: string;
  onChangeGlobalModel: (v: string) => void;
  applyToAll: () => void;
  showAllModels: boolean;
  hasModelPricing: (modelName: string) => boolean;
  // Global model parameters
  globalModelParameters: GlobalModelParameters;
  onChangeGlobalParameter: (param: keyof GlobalModelParameters, value: number | undefined | ThinkingLevel) => void;
  // Response timeout
  responseTimeoutSeconds: number;
  onChangeTimeout: (seconds: number) => void;
  // Save indicator
  showSaveIndicator?: boolean;
}

export function GlobalSettings(props: GlobalSettingsProps) {
  const {
    isDarkMode,
    availableModels,
    globalModelValue,
    onChangeGlobalModel,
    applyToAll,
    showAllModels,
    hasModelPricing,
    globalModelParameters,
    onChangeGlobalParameter,
    responseTimeoutSeconds,
    onChangeTimeout,
    showSaveIndicator = false,
  } = props;

  const options = availableModels.map(({ provider, providerName, model }) => {
    const costNote = showAllModels && !hasModelPricing(model) ? ' (cost unknown)' : '';
    const val = `${provider}>${model}`;
    return { value: val, label: `${providerName} > ${model}${costNote}` };
  });

  const handleTimeoutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.max(30, Math.min(600, Number.parseInt(e.target.value, 10) || 120));
    onChangeTimeout(val);
  };

  return (
    <div
      className={cn(
        'rounded-xl border p-5 text-left',
        isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]',
      )}>
      <h2 className={cn('mb-4 text-base font-semibold', isDarkMode ? 'text-gray-100' : 'text-gray-900')}>
        Global Settings
      </h2>

      {/* Global Model Selection */}
      <div className="flex items-center gap-3">
        <LabelWithTooltip
          isDarkMode={isDarkMode}
          htmlFor="global-model"
          label="Global model"
          tooltip="Select model for all agents"
          width="w-28"
        />
        <ModelComboBox
          id="global-model"
          isDarkMode={isDarkMode}
          value={globalModelValue}
          options={options}
          onChange={onChangeGlobalModel}
        />
        <button
          type="button"
          onClick={applyToAll}
          disabled={!globalModelValue}
          className={cn(
            'rounded-lg px-3 py-2 text-sm font-medium shrink-0',
            isDarkMode
              ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]'
              : 'bg-[#ecebe5] text-gray-800 hover:bg-[#dfddd4]',
            !globalModelValue && 'opacity-50 cursor-not-allowed',
          )}>
          Apply to all
        </button>
        <SaveIndicator show={showSaveIndicator} isDarkMode={isDarkMode} message="Applied to all agents" />
      </div>

      {/* Search compatibility warning */}
      {globalModelValue && (
        <div className={cn('mt-2 text-xs', isDarkMode ? 'text-amber-300' : 'text-amber-700')}>
          {WEB_SEARCH_COMPATIBILITY_WARNING}
        </div>
      )}

      {globalModelValue && (
        <div className="mt-4 flex items-center gap-3">
          <LabelWithTooltip
            isDarkMode={isDarkMode}
            htmlFor="global-thinking-level"
            label="Thinking Level"
            tooltip="Controls reasoning depth for supported models."
            width="w-28"
          />
          <select
            id="global-thinking-level"
            value={globalModelParameters.thinkingLevel}
            onChange={e => onChangeGlobalParameter('thinkingLevel', e.target.value as ThinkingLevel)}
            className={cn(
              'flex-1 rounded-lg border px-3 py-2 text-sm',
              isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700',
            )}>
            <option value="default">Default</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="off">Off</option>
          </select>
        </div>
      )}

      {/* Temperature */}
      <div className="mt-4 flex items-center gap-3">
        <LabelWithTooltip
          isDarkMode={isDarkMode}
          htmlFor="global-temperature"
          label="Temperature"
          tooltip="Controls randomness of outputs. Leave as default to use the provider's recommended temperature."
          width="w-28"
        />
        <TemperatureControl
          isDarkMode={isDarkMode}
          id="global-temperature"
          value={globalModelParameters.temperature}
          onChange={v => onChangeGlobalParameter('temperature', v)}
          ariaLabel="Global temperature input"
        />
      </div>

      {/* Max Output Tokens */}
      <div className="mt-4 flex items-center gap-3">
        <LabelWithTooltip
          isDarkMode={isDarkMode}
          htmlFor="global-max-output"
          label="Max Output"
          tooltip="Maximum tokens in model response"
          width="w-28"
        />
        <div className="flex flex-1 items-center space-x-2">
          <input
            id="global-max-output"
            type="number"
            min={256}
            max={65536}
            step={256}
            value={globalModelParameters.maxOutputTokens}
            onChange={e => {
              const val = Math.max(256, Math.min(65536, Number.parseInt(e.target.value, 10) || 8192));
              onChangeGlobalParameter('maxOutputTokens', val);
            }}
            className={cn(
              'w-24 rounded-lg border px-3 py-2 text-sm',
              isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700',
            )}
            aria-label="Global max output tokens"
          />
          <span className={cn('text-sm', isDarkMode ? 'text-gray-400' : 'text-gray-500')}>tokens</span>
        </div>
      </div>

      <div className={cn('my-4 border-t', isDarkMode ? 'border-[#2f2f29]' : 'border-[#dddcd5]')} />

      {/* Response Timeout */}
      <div className="flex items-center gap-3">
        <LabelWithTooltip
          isDarkMode={isDarkMode}
          htmlFor="response-timeout"
          label="Response timeout"
          tooltip="Maximum seconds to wait for LLM responses (Chat, Auto, Search). Range: 30-600s."
          width="w-28"
        />
        <input
          id="response-timeout"
          type="number"
          min={30}
          max={600}
          step={10}
          value={responseTimeoutSeconds}
          onChange={handleTimeoutChange}
          className={cn(
            'w-20 rounded-lg border px-3 py-2 text-sm',
            isDarkMode ? 'border-[#3a3a34] bg-[#252522] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700',
          )}
          aria-label="Response timeout in seconds"
        />
        <span className={cn('text-sm', isDarkMode ? 'text-gray-400' : 'text-gray-500')}>seconds</span>
      </div>
    </div>
  );
}
