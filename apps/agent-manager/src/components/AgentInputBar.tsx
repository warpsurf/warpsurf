import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { FaBrain, FaSearch, FaRobot, FaRandom, FaChevronDown, FaArrowUp } from 'react-icons/fa';
import { MicrophoneButton } from '@extension/shared';
import { TabContextSelector } from './TabContextSelector';

type AgentType = 'auto' | 'chat' | 'search' | 'agent' | 'multiagent';

interface AgentOption {
  type: AgentType;
  name: string;
  icon: React.ReactNode;
}

const AGENT_OPTIONS: AgentOption[] = [
  { type: 'auto', name: 'Auto', icon: <FaRandom className="w-3.5 h-3.5" /> },
  { type: 'chat', name: 'Chat', icon: <FaBrain className="w-3.5 h-3.5" /> },
  { type: 'search', name: 'Search', icon: <FaSearch className="w-3.5 h-3.5" /> },
  { type: 'agent', name: 'Agent', icon: <FaRobot className="w-3.5 h-3.5" /> },
  {
    type: 'multiagent',
    name: 'Multi-Agent',
    icon: (
      <span className="inline-flex">
        <FaRobot className="w-3.5 h-3.5" />
        <FaRobot className="w-3.5 h-3.5 -ml-1.5" />
      </span>
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
  // Speech-to-text props
  onMicClick?: () => void;
  onMicStop?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  recordingDurationMs?: number;
  audioLevel?: number;
  sttConfigured?: boolean;
  onOpenVoiceSettings?: () => void;
}

export function AgentInputBar({
  isDarkMode,
  onSendMessage,
  disabled = false,
  autoContextEnabled = false,
  autoContextTabIds = [],
  onAutoContextToggle,
  onMicClick,
  onMicStop,
  isRecording = false,
  isProcessingSpeech = false,
  recordingDurationMs = 0,
  audioLevel = 0,
  sttConfigured = false,
  onOpenVoiceSettings,
}: AgentInputBarProps) {
  const [text, setText] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('auto');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualContextTabIds, setManualContextTabIds] = useState<number[]>([]);
  const [excludedAutoTabIds, setExcludedAutoTabIds] = useState<number[]>([]);
  const [workflowDropdownOpen, setWorkflowDropdownOpen] = useState(false);
  const workflowDropdownRef = useRef<HTMLDivElement>(null);

  // Close workflow dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (workflowDropdownRef.current && !workflowDropdownRef.current.contains(e.target as Node)) {
        setWorkflowDropdownOpen(false);
      }
    };
    if (workflowDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [workflowDropdownOpen]);

  const selectedOption = AGENT_OPTIONS.find(o => o.type === selectedAgent) || AGENT_OPTIONS[0];

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

  return (
    <form
      onSubmit={handleSubmit}
      className={`overflow-visible rounded-xl border transition-colors ${
        isDarkMode ? 'border-slate-600 bg-slate-800/50' : 'border-gray-200 bg-white'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'focus-within:border-violet-400 hover:border-violet-400'}`}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="What can I help you with?"
        rows={2}
        className={`w-full resize-none border-none p-3 focus:outline-none ${
          isDarkMode
            ? 'bg-transparent text-slate-200 placeholder-slate-400'
            : 'bg-transparent text-gray-800 placeholder-gray-400'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      />

      <div
        className={`flex items-center justify-between gap-2 px-3 pb-2 ${isDarkMode ? 'border-slate-700' : 'border-gray-100'}`}>
        <div className="flex items-center gap-2">
          {/* Tab context selector - simplified */}
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
            compact
          />

          {/* Workflow dropdown selector */}
          <div ref={workflowDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setWorkflowDropdownOpen(!workflowDropdownOpen)}
              disabled={disabled}
              title={selectedOption.name}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                isDarkMode
                  ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } ${disabled ? 'cursor-not-allowed' : ''}`}>
              {selectedOption.icon}
              <FaChevronDown className={`w-2 h-2 transition-transform ${workflowDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {workflowDropdownOpen && (
              <div
                className={`absolute left-0 top-full z-50 mt-1 w-40 rounded-lg border shadow-lg ${
                  isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'
                }`}>
                {AGENT_OPTIONS.map(option => (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => {
                      setSelectedAgent(option.type);
                      setWorkflowDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      selectedAgent === option.type
                        ? isDarkMode
                          ? 'bg-violet-600/30 text-violet-300'
                          : 'bg-violet-50 text-violet-700'
                        : isDarkMode
                          ? 'text-slate-200 hover:bg-slate-700'
                          : 'text-gray-700 hover:bg-gray-50'
                    }`}>
                    {option.icon}
                    <span>{option.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Microphone button for voice input */}
          {onMicClick && (
            <MicrophoneButton
              isRecording={isRecording}
              isProcessing={isProcessingSpeech}
              recordingDurationMs={recordingDurationMs}
              audioLevel={audioLevel}
              onClick={onMicClick}
              onStopClick={onMicStop || (() => {})}
              isDarkMode={isDarkMode}
              disabled={!sttConfigured || disabled}
              disabledTooltip={!sttConfigured ? 'Configure a voice model to enable voice input' : undefined}
              onOpenSettings={onOpenVoiceSettings}
            />
          )}

          {/* Send button */}
          <button
            type="submit"
            disabled={isDisabled}
            title="Send"
            aria-label="Send message"
            className={`rounded-lg p-1.5 text-white transition-colors ${
              isDisabled ? 'bg-violet-400 opacity-50 cursor-not-allowed' : 'bg-violet-500 hover:bg-violet-600'
            }`}>
            {isSubmitting ? (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              <FaArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
