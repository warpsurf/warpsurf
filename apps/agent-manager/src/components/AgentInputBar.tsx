import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { FaBrain, FaSearch, FaRobot, FaRandom, FaChevronDown, FaArrowUp, FaPlus } from 'react-icons/fa';
import { FiPaperclip } from 'react-icons/fi';
import { MicrophoneButton } from '@extension/shared';
import {
  processFiles,
  toAttachment,
  formatFileSize,
  type PendingAttachment,
} from '@extension/shared/lib/utils/file-processor';
import { ACCEPTED_MIME_TYPES } from '@extension/storage/lib/chat/types';
import type { ContextTabInfo } from '@panel/components/chat-interface/types';
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
        <FaRobot className="w-3.5 h-3.5 -ml-0.5" />
      </span>
    ),
  },
];

interface AgentInputBarProps {
  isDarkMode: boolean;
  onSendMessage: (text: string, agentType?: string, contextTabIds?: number[], attachments?: any[]) => Promise<void>;
  disabled?: boolean;
  autoContextEnabled?: boolean;
  autoContextTabIds?: number[];
  onAutoContextToggle?: (enabled: boolean) => Promise<void>;
  onContextTabsCapture?: (timestamp: number, contextTabs: ContextTabInfo[]) => void;
  onMicClick?: () => void;
  onMicStop?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  recordingDurationMs?: number;
  audioLevel?: number;
  sttConfigured?: boolean;
  onOpenVoiceSettings?: () => void;
  /** Lifted context tab state — when provided, tabs persist across sends */
  contextTabIds?: number[];
  onContextTabsChange?: (tabIds: number[]) => void;
}

export function AgentInputBar({
  isDarkMode,
  onSendMessage,
  disabled = false,
  autoContextEnabled = false,
  autoContextTabIds = [],
  onAutoContextToggle,
  onContextTabsCapture,
  onMicClick,
  onMicStop,
  isRecording = false,
  isProcessingSpeech = false,
  recordingDurationMs = 0,
  audioLevel = 0,
  sttConfigured = false,
  onOpenVoiceSettings,
  contextTabIds: externalContextTabIds,
  onContextTabsChange,
}: AgentInputBarProps) {
  const [text, setText] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('auto');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localContextTabIds, setLocalContextTabIds] = useState<number[]>([]);
  const manualContextTabIds = externalContextTabIds ?? localContextTabIds;
  const setManualContextTabIds = onContextTabsChange ?? setLocalContextTabIds;
  const [excludedAutoTabIds, setExcludedAutoTabIds] = useState<number[]>([]);
  const [workflowDropdownOpen, setWorkflowDropdownOpen] = useState(false);
  const workflowDropdownRef = useRef<HTMLDivElement>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

  // Attachment state
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  // Remove closed tabs from manualContextTabIds regardless of whether TabContextSelector is mounted
  useEffect(() => {
    const handleTabRemoved = (tabId: number) => {
      if (!manualContextTabIds.includes(tabId)) return;
      setManualContextTabIds(manualContextTabIds.filter((id: number) => id !== tabId));
    };
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    return () => chrome.tabs.onRemoved.removeListener(handleTabRemoved);
  }, []);

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

  useEffect(() => {
    if (!showPlusMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        if ((e.target as Element).closest?.('[data-tab-context-dropdown]')) return;
        setShowPlusMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPlusMenu]);

  const selectedOption = AGENT_OPTIONS.find(o => o.type === selectedAgent) || AGENT_OPTIONS[0];

  const slashItems = useMemo(
    () => [
      { label: '/chat – Switch to Chat', value: '/chat ', agent: 'chat' as AgentType },
      { label: '/search – Switch to Search', value: '/search ', agent: 'search' as AgentType },
      { label: '/agent – Switch to Agent', value: '/agent ', agent: 'agent' as AgentType },
      { label: '/magent – Switch to Multi-Agent', value: '/magent ', agent: 'multiagent' as AgentType },
    ],
    [],
  );

  const detectAgentFromText = (t: string): AgentType | null => {
    const trimmed = t.trim().toLowerCase();
    if (trimmed.startsWith('/chat')) return 'chat';
    if (trimmed.startsWith('/search')) return 'search';
    if (trimmed.startsWith('/magent')) return 'multiagent';
    if (trimmed.startsWith('/agent')) return 'agent';
    return null;
  };

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      setText(newText);
      const t = newText.trim().toLowerCase();
      const isCommandPrefix = t.startsWith('/') && !/^\/(chat|search|agent|magent)\b\s/.test(t);
      setShowSlashMenu(isCommandPrefix);
      if (isCommandPrefix) setSlashIndex(0);
      const detected = detectAgentFromText(newText);
      if (detected && detected !== selectedAgent) setSelectedAgent(detected);
    },
    [selectedAgent],
  );

  const isDisabled = useMemo(
    () =>
      disabled ||
      (text.trim() === '' && pendingAttachments.filter(a => a.status === 'ready').length === 0) ||
      isSubmitting,
    [disabled, text, isSubmitting, pendingAttachments],
  );

  const pendingAttachmentsRef = useRef(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;

  const handleFilesAdded = useCallback(async (files: File[]) => {
    const readyCount = pendingAttachmentsRef.current.filter(a => a.status !== 'error').length;
    const results = await processFiles(files, readyCount);
    setPendingAttachments(prev => [...prev, ...results]);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        handleFilesAdded(files);
      }
    },
    [handleFilesAdded],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      let cleanText = text.trim();
      const readyAttachments = pendingAttachments.filter(a => a.status === 'ready' && a.dataUrl).map(toAttachment);
      if ((!cleanText && readyAttachments.length === 0) || isSubmitting) return;

      // Slash command: if text is exactly a mode command, switch mode and stop
      if (/^\/chat\s*$/.test(cleanText)) {
        setSelectedAgent('chat');
        setText('');
        setShowSlashMenu(false);
        return;
      }
      if (/^\/search\s*$/.test(cleanText)) {
        setSelectedAgent('search');
        setText('');
        setShowSlashMenu(false);
        return;
      }
      if (/^\/agent\s*$/.test(cleanText)) {
        setSelectedAgent('agent');
        setText('');
        setShowSlashMenu(false);
        return;
      }
      if (/^\/magent\s*$/.test(cleanText)) {
        setSelectedAgent('multiagent');
        setText('');
        setShowSlashMenu(false);
        return;
      }
      // Strip leading mode prefix if followed by content
      cleanText = cleanText.replace(/^\/(chat|search|agent|magent)\b\s*/i, '');

      setIsSubmitting(true);
      try {
        let allContextTabIds: number[] = [];
        if (autoContextEnabled) {
          const effectiveAutoTabs = autoContextTabIds.filter(id => !excludedAutoTabIds.includes(id));
          allContextTabIds = [...new Set([...effectiveAutoTabs, ...manualContextTabIds])];
        } else {
          allContextTabIds = manualContextTabIds;
        }

        // Capture context tab metadata (mirrors side panel chat-input.tsx)
        const timestamp = Date.now();
        if (onContextTabsCapture && allContextTabIds.length > 0) {
          try {
            const allTabs = await chrome.tabs.query({ currentWindow: true });
            const contextTabsInfo: ContextTabInfo[] = [];
            for (const tabId of allContextTabIds) {
              const tab = allTabs.find(t => t.id === tabId);
              if (tab) {
                contextTabsInfo.push({
                  id: tabId,
                  title: tab.title || 'Untitled',
                  favIconUrl: tab.favIconUrl || undefined,
                  url: tab.url || undefined,
                });
              }
            }
            if (contextTabsInfo.length > 0) {
              onContextTabsCapture(timestamp, contextTabsInfo);
            }
          } catch {
            // Ignore errors in capturing tab info
          }
        }

        await onSendMessage(
          cleanText,
          selectedAgent,
          allContextTabIds.length > 0 ? allContextTabIds : undefined,
          readyAttachments.length > 0 ? readyAttachments : undefined,
        );
        setText('');
        setShowSlashMenu(false);
        // Don't reset context tabs — they persist across sends (mirrors side panel)
        setPendingAttachments([]);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      text,
      selectedAgent,
      isSubmitting,
      onSendMessage,
      onContextTabsCapture,
      manualContextTabIds,
      autoContextEnabled,
      autoContextTabIds,
      excludedAutoTabIds,
      pendingAttachments,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSlashMenu) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashIndex(i => (i + 1) % slashItems.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashIndex(i => (i - 1 + slashItems.length) % slashItems.length);
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          const item = slashItems[slashIndex];
          setText(item.value);
          setSelectedAgent(item.agent);
          setShowSlashMenu(false);
          return;
        }
        if (e.key === 'Escape') {
          setShowSlashMenu(false);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit, showSlashMenu, slashIndex, slashItems],
  );

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled && e.dataTransfer?.types.includes('Files')) setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled || !e.dataTransfer?.files.length) return;
      const files = Array.from(e.dataTransfer.files).filter(f => ACCEPTED_MIME_TYPES.includes(f.type));
      if (files.length > 0) handleFilesAdded(files);
    },
    [disabled, handleFilesAdded],
  );

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`overflow-visible rounded-xl border transition-colors ${
        isDragging ? 'border-violet-400 bg-violet-50/10' : ''
      } ${
        isDarkMode ? 'border-slate-600 bg-slate-800/50' : 'border-gray-200 bg-white'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'focus-within:border-violet-400 hover:border-violet-400'}`}>
      <textarea
        value={text}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        disabled={disabled}
        placeholder="What can I help you with?"
        rows={2}
        className={`w-full resize-none border-none p-3 focus:outline-none ${
          isDarkMode
            ? 'bg-transparent text-slate-200 placeholder-slate-400'
            : 'bg-transparent text-gray-800 placeholder-gray-400'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      />

      {/* Slash command menu */}
      {showSlashMenu && (
        <div
          role="menu"
          aria-label="Slash commands"
          className={`mx-3 mb-1 overflow-hidden rounded-md border text-sm shadow ${isDarkMode ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-gray-200 bg-white text-gray-800'}`}>
          {slashItems.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`block w-full px-2 py-1 text-left ${i === slashIndex ? (isDarkMode ? 'bg-slate-800' : 'bg-gray-100') : ''}`}
              onClick={() => {
                setText(it.value);
                setSelectedAgent(it.agent);
                setShowSlashMenu(false);
              }}>
              {it.label}
            </button>
          ))}
        </div>
      )}

      {/* Pending attachments */}
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-1.5">
          {pendingAttachments.map(a => (
            <span
              key={a.id}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] ${
                a.status === 'error'
                  ? isDarkMode
                    ? 'bg-red-900/40 text-red-300'
                    : 'bg-red-50 text-red-600'
                  : a.status === 'loading'
                    ? isDarkMode
                      ? 'bg-slate-700 text-slate-400'
                      : 'bg-gray-100 text-gray-400'
                    : isDarkMode
                      ? 'bg-slate-700 text-slate-200'
                      : 'bg-gray-100 text-gray-700'
              }`}>
              {a.status === 'loading' && (
                <span className="w-2 h-2 rounded-full border border-t-transparent animate-spin border-current" />
              )}
              <span className="truncate max-w-[80px]">{a.filename}</span>
              <span className="opacity-60">{formatFileSize(a.size)}</span>
              <button
                type="button"
                onClick={() => setPendingAttachments(prev => prev.filter(x => x.id !== a.id))}
                className="opacity-60 hover:opacity-100">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_MIME_TYPES.join(',')}
        className="hidden"
        onChange={e => {
          if (e.target.files?.length) {
            handleFilesAdded(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />

      <div
        className={`flex items-center justify-between gap-2 px-3 pb-2 ${isDarkMode ? 'border-slate-700' : 'border-gray-100'}`}>
        <div className="flex items-center gap-2">
          {/* Plus menu - Tabs + Files */}
          <div ref={plusMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowPlusMenu(!showPlusMenu)}
              disabled={disabled}
              title="Add context"
              className={`inline-flex items-center justify-center rounded-lg p-1 text-xs transition-colors ${
                isDarkMode
                  ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
              <FaPlus className="w-3 h-3" />
              {(manualContextTabIds.length > 0 ||
                pendingAttachments.length > 0 ||
                (autoContextEnabled &&
                  autoContextTabIds.filter(id => !excludedAutoTabIds.includes(id)).length > 0)) && (
                <span
                  className={`ml-1 rounded-full px-1 text-[9px] font-bold ${isDarkMode ? 'bg-violet-500 text-white' : 'bg-violet-400 text-white'}`}>
                  {(autoContextEnabled
                    ? autoContextTabIds.filter(id => !excludedAutoTabIds.includes(id)).length +
                      manualContextTabIds.filter(id => !autoContextTabIds.includes(id)).length
                    : manualContextTabIds.length) + pendingAttachments.filter(a => a.status === 'ready').length}
                </span>
              )}
            </button>
            {showPlusMenu && (
              <div
                className={`absolute left-0 bottom-full mb-1 z-50 w-48 rounded-lg border shadow-lg ${
                  isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'
                }`}>
                <div className="py-1">
                  <div
                    className={`px-1 py-0.5 ${isDarkMode ? 'border-b border-slate-700' : 'border-b border-gray-100'}`}>
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
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlusMenu(false);
                      fileInputRef.current?.click();
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      isDarkMode ? 'text-slate-200 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-50'
                    }`}>
                    <FiPaperclip className="w-3.5 h-3.5" />
                    <span>Add files and images</span>
                  </button>
                </div>
              </div>
            )}
          </div>

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
        </div>

        <div className="flex items-center gap-2">
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
                className={`absolute right-0 bottom-full z-50 mb-1 w-40 rounded-lg border shadow-lg ${
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

          <button
            type="submit"
            disabled={isDisabled}
            title="Send"
            aria-label="Send message"
            className={`rounded-lg p-1.5 text-white transition-colors ${
              isDisabled ? 'bg-rose-300 opacity-50 cursor-not-allowed' : 'bg-rose-400 hover:bg-rose-500'
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
