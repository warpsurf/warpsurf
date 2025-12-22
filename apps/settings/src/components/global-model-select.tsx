import { Button } from '@extension/ui';
import { LabelWithTooltip, cn, ModelComboBox } from './primitives';
import { WEB_SEARCH_COMPATIBILITY_WARNING } from './agent-helpers';

export interface GlobalModelOption {
  provider: string;
  providerName: string;
  model: string;
}

interface GlobalModelSelectProps {
  isDarkMode: boolean;
  availableModels: GlobalModelOption[];
  value: string;
  onChangeValue: (v: string) => void;
  applyToAll: () => void;
  showAllModels: boolean;
  hasModelPricing: (modelName: string) => boolean;
}

export function GlobalModelSelect(props: GlobalModelSelectProps) {
  const { isDarkMode, availableModels, value, onChangeValue, applyToAll, showAllModels, hasModelPricing } = props;

  const options = availableModels.map(({ provider, providerName, model }) => {
    const costNote = showAllModels && !hasModelPricing(model) ? ' (cost unknown)' : '';
    const val = `${provider}>${model}`;
    return { value: val, label: `${providerName} > ${model}${costNote}` };
  });

  return (
    <div
      className={cn(
        'rounded-xl border p-5 text-left shadow-sm backdrop-blur-md',
        isDarkMode ? 'border-slate-700/70 bg-slate-800/60' : 'border-white/20 bg-white/40',
      )}>
      <div className="flex items-center gap-3">
        <LabelWithTooltip
          isDarkMode={isDarkMode}
          htmlFor="global-model"
          label="Global model"
          tooltip="Select model for all options"
          width="w-28"
        />
        <ModelComboBox
          id="global-model"
          isDarkMode={isDarkMode}
          value={value}
          options={options}
          onChange={onChangeValue}
        />
        <Button
          variant="secondary"
          onClick={applyToAll}
          disabled={!value}
          className={cn(
            'text-sm',
            isDarkMode
              ? 'border-blue-600 bg-blue-700 text-blue-100 hover:bg-blue-600'
              : 'border-blue-300 bg-blue-100 text-blue-800 hover:bg-blue-200',
          )}>
          Apply to all
        </Button>
      </div>
      {value && (
        <div className={cn('mt-2 text-xs', isDarkMode ? 'text-amber-300' : 'text-amber-700')}>
          {WEB_SEARCH_COMPATIBILITY_WARNING}
        </div>
      )}
    </div>
  );
}
