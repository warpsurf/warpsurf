import { LabelWithTooltip, cn, ModelComboBox } from './primitives';

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
    return { value: `${provider}>${model}`, label: `${providerName} > ${model}${costNote}` };
  });

  const cardClass = isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]';
  const btnClass = cn(
    'rounded-lg px-3 py-2 text-sm font-medium',
    isDarkMode ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]' : 'bg-[#ecebe5] text-gray-800 hover:bg-[#dfddd4]',
    !value && 'opacity-50 cursor-not-allowed',
  );

  return (
    <div className={cn('rounded-xl border p-5 text-left', cardClass)}>
      <div className="flex items-center gap-3">
        <LabelWithTooltip isDarkMode={isDarkMode} htmlFor="global-model" label="Global model" width="w-28" />
        <ModelComboBox
          id="global-model"
          isDarkMode={isDarkMode}
          value={value}
          options={options}
          onChange={onChangeValue}
        />
        <button type="button" onClick={applyToAll} disabled={!value} className={btnClass}>
          Apply to all
        </button>
      </div>
      {value && (
        <p className={cn('mt-2 text-xs', isDarkMode ? 'text-gray-500' : 'text-gray-500')}>
          Web search compatibility varies by model.
        </p>
      )}
    </div>
  );
}
