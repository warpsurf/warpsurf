import { useState, useCallback, useMemo } from 'react';
import { FaBrain, FaSearch, FaRobot, FaRandom } from 'react-icons/fa';
import { TabContextSelector } from './TabContextSelector';

type AgentType = 'auto' | 'chat' | 'search' | 'agent' | 'multiagent';

interface AgentOption {
  type: AgentType;
  name: string;
  icon: React.ReactNode;
}

const AGENT_OPTIONS: AgentOption[] = [
  { type: 'auto', name: 'Auto', icon: <FaRandom className="w-4 h-4" /> },
  { type: 'chat', name: 'Chat', icon: <FaBrain className="w-4 h-4" /> },
  { type: 'search', name: 'Search', icon: <FaSearch className="w-4 h-4" /> },
  { type: 'agent', name: 'Agent', icon: <FaRobot className="w-4 h-4" /> },
  {
    type: 'multiagent',
    name: 'Multi',
    icon: (
      <>
        <FaRobot className="w-4 h-4" />
        <FaRobot className="w-4 h-4 -ml-2" />
      </>
    ),
  },
];

interface AgentInputBarProps {
  isDarkMode: boolean;
  onSendMessage: (text: string, agentType?: string, contextTabIds?: number[]) => Promise<void>;
  disabled?: boolean;
  autoContextEnabled?: boolean;
  autoContextTabIds?: number[];
  onAutoContextToggle?: (enabled: boolean) => Promise<void>;
}

export function AgentInputBar({
  isDarkMode,
  onSendMessage,
  disabled = false,
  autoContextEnabled = false,
  autoContextTabIds = [],
  onAutoContextToggle,
}: AgentInputBarProps) {
  const [text, setText] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('auto');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualContextTabIds, setManualContextTabIds] = useState<number[]>([]);
  const [excludedAutoTabIds, setExcludedAutoTabIds] = useState<number[]>([]);

  const isDisabled = useMemo(() => disabled || text.trim() === '' || isSubmitting, [disabled, text, isSubmitting]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed || isSubmitting) return;

      setIsSubmitting(true);
      try {
        // Combine auto context (minus excluded) with manual context
        let allContextTabIds: number[] = [];
        if (autoContextEnabled) {
          const effectiveAutoTabs = autoContextTabIds.filter(id => !excludedAutoTabIds.includes(id));
          allContextTabIds = [...new Set([...effectiveAutoTabs, ...manualContextTabIds])];
        } else {
          allContextTabIds = manualContextTabIds;
        }

        await onSendMessage(trimmed, selectedAgent, allContextTabIds.length > 0 ? allContextTabIds : undefined);
        setText('');
        setManualContextTabIds([]);
        setExcludedAutoTabIds([]);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      text,
      selectedAgent,
      isSubmitting,
      onSendMessage,
      manualContextTabIds,
      autoContextEnabled,
      autoContextTabIds,
      excludedAutoTabIds,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  const getButtonStyle = (type: AgentType) => {
    const isSelected = selectedAgent === type;
    if (!isSelected) {
      return isDarkMode
        ? 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'
        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100';
    }
    const colors: Record<AgentType, string> = {
      auto: 'bg-slate-600 text-white border-slate-600',
      chat: isDarkMode ? 'bg-violet-500 text-white border-violet-500' : 'bg-violet-400 text-white border-violet-400',
      search: isDarkMode ? 'bg-teal-500 text-white border-teal-500' : 'bg-teal-400 text-white border-teal-400',
      agent: isDarkMode ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-400 text-white border-amber-400',
      multiagent: isDarkMode
        ? 'bg-orange-500 text-white border-orange-500'
        : 'bg-orange-400 text-white border-orange-400',
    };
    return colors[type];
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="What can I help you with?"
        rows={2}
        className={`w-full resize-none rounded-lg border p-3 focus:outline-none focus:ring-2 focus:ring-violet-500 ${
          isDarkMode
            ? 'bg-slate-800 border-slate-600 text-slate-200 placeholder-slate-400'
            : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tab context selector */}
          <TabContextSelector
            selectedTabIds={manualContextTabIds}
            onSelectionChange={setManualContextTabIds}
            isDarkMode={isDarkMode}
            disabled={disabled}
            autoContextEnabled={autoContextEnabled}
            autoContextTabIds={autoContextTabIds}
            excludedAutoTabIds={excludedAutoTabIds}
            onExcludedAutoTabIdsChange={setExcludedAutoTabIds}
            onAutoContextToggle={onAutoContextToggle}
          />

          {/* Agent type selector */}
          <div className="flex items-center gap-1">
            {AGENT_OPTIONS.map(option => (
              <button
                key={option.type}
                type="button"
                onClick={() => setSelectedAgent(option.type)}
                disabled={disabled}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${getButtonStyle(option.type)} ${
                  disabled ? 'opacity-50 cursor-not-allowed' : ''
                }`}>
                {option.icon}
                <span>{option.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Send button */}
        <button
          type="submit"
          disabled={isDisabled}
          className={`rounded-lg px-4 py-2 font-medium text-white transition-colors ${
            isDisabled ? 'bg-violet-400 opacity-50 cursor-not-allowed' : 'bg-violet-500 hover:bg-violet-600'
          }`}>
          {isSubmitting ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  );
}
