import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FaBrain,
  FaSearch,
  FaRobot,
  FaRandom,
  FaChevronDown,
  FaArrowUp,
  FaStop,
  FaPause,
  FaPlay,
} from 'react-icons/fa';
import { FiAlertOctagon } from 'react-icons/fi';
import { WorkflowType, WORKFLOW_DISPLAY_NAMES, WORKFLOW_DESCRIPTIONS, MicrophoneButton } from '@extension/shared';
import TabContextSelector from './tab-context-selector';
import SessionStatsBar from '../footer/session-stats-bar';
import { DebugButtons } from '../footer/debug-buttons';
import CloseTabsButton from '../footer/close-tabs-button';
import type { ContextTabInfo } from './types';

// Re-export for backward compatibility within this file
export { WorkflowType as AgentType };

export interface AgentSelection {
  type: WorkflowType;
  name: string;
  icon: React.ReactNode;
  description: string;
}

export const AGENT_OPTIONS: AgentSelection[] = [
  {
    type: WorkflowType.AUTO,
    name: WORKFLOW_DISPLAY_NAMES[WorkflowType.AUTO],
    icon: <FaRandom className="w-3.5 h-3.5" />,
    description: WORKFLOW_DESCRIPTIONS[WorkflowType.AUTO],
  },
  {
    type: WorkflowType.CHAT,
    name: WORKFLOW_DISPLAY_NAMES[WorkflowType.CHAT],
    icon: <FaBrain className="w-3.5 h-3.5" />,
    description: WORKFLOW_DESCRIPTIONS[WorkflowType.CHAT],
  },
  {
    type: WorkflowType.SEARCH,
    name: WORKFLOW_DISPLAY_NAMES[WorkflowType.SEARCH],
    icon: <FaSearch className="w-3.5 h-3.5" />,
    description: WORKFLOW_DESCRIPTIONS[WorkflowType.SEARCH],
  },
  {
    type: WorkflowType.AGENT,
    name: WORKFLOW_DISPLAY_NAMES[WorkflowType.AGENT],
    icon: <FaRobot className="w-3.5 h-3.5" />,
    description: WORKFLOW_DESCRIPTIONS[WorkflowType.AGENT],
  },
  {
    type: WorkflowType.MULTIAGENT,
    name: WORKFLOW_DISPLAY_NAMES[WorkflowType.MULTIAGENT],
    icon: (
      <span className="inline-flex">
        <FaRobot className="w-3.5 h-3.5" />
        <FaRobot className="w-3.5 h-3.5 -ml-1.5" />
      </span>
    ),
    description: WORKFLOW_DESCRIPTIONS[WorkflowType.MULTIAGENT],
  },
];

interface ChatInputProps {
  onSendMessage: (
    text: string,
    agentType?: WorkflowType,
    contextTabIds?: number[],
    contextMenuAction?: string,
    skipAutoContext?: boolean,
  ) => void;
  onStopTask: () => void;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
  // Historical session ID - if provided, shows replay button instead of send button
  historicalSessionId?: string | null;
  onReplay?: (sessionId: string) => void;
  // Pause/Resume controls
  isPaused?: boolean;
  onPauseTask?: () => void;
  onResumeTask?: () => void;
  onHandBackControl?: (instructions?: string) => void;
  // Informational badge for auto routing decision
  lastAutoDecision?: 'Chat' | 'Search' | 'Agent' | null;
  // Allow parent to control the selected agent programmatically
  setAgentSelector?: (setter: (agent: WorkflowType) => void) => void;
  isJobActive?: boolean;
  // Whether a stop request is pending confirmation
  isStopping?: boolean;
  // Context tabs - lifted state from parent for persistence across renders
  contextTabIds?: number[];
  onContextTabsChange?: (tabIds: number[]) => void;
  // Auto-context mode
  autoContextEnabled?: boolean;
  autoContextTabIds?: number[];
  excludedAutoTabIds?: number[];
  onExcludedAutoTabIdsChange?: (tabIds: number[]) => void;
  onAutoContextToggle?: (enabled: boolean) => Promise<void>;
  // Callback to store context tabs metadata when sending a message
  onContextTabsCapture?: (timestamp: number, contextTabs: ContextTabInfo[]) => void;
  // Speech-to-text props
  onMicClick?: () => void;
  onMicStop?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  recordingDurationMs?: number;
  audioLevel?: number;
  sttConfigured?: boolean;
  onOpenVoiceSettings?: () => void;
  expandedComposer?: boolean;
  // Session stats props (for stats tooltip)
  sessionStats?: {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalLatency: number;
    totalCost: number;
    avgLatencyPerRequest: number;
  };
  formatUsd?: (cost: number) => string;
  // Debug buttons props
  currentSessionId?: string | null;
  agentTraceRootIdRef?: React.RefObject<string | null>;
  currentTaskAgentType?: string | null;
  messageMetadata?: any;
  portRef?: React.RefObject<chrome.runtime.Port | null>;
  // Emergency stop props
  showEmergencyStop?: boolean;
  onEmergencyStop?: () => void;
  // Close tabs props
  showCloseTabs?: boolean;
  workerTabGroups?: { taskId: string; groupId?: number }[];
  sessionIdForCleanup?: string | null;
  onClosedTabs?: () => void;
}

const MIN_HEIGHT = 40;
const MAX_HEIGHT = 200;
const DEFAULT_HEIGHT = 56;

export default function ChatInput({
  onSendMessage,
  onStopTask,
  disabled,
  showStopButton,
  setContent,
  isDarkMode = false,
  historicalSessionId,
  onReplay,
  isPaused = false,
  onPauseTask,
  onResumeTask,
  onHandBackControl,
  lastAutoDecision = null,
  setAgentSelector,
  isJobActive = false,
  isStopping = false,
  contextTabIds: externalContextTabIds,
  onContextTabsChange,
  autoContextEnabled = false,
  autoContextTabIds = [],
  excludedAutoTabIds = [],
  onExcludedAutoTabIdsChange,
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
  expandedComposer = false,
  // Session stats
  sessionStats,
  formatUsd,
  // Debug buttons
  currentSessionId,
  agentTraceRootIdRef,
  currentTaskAgentType,
  messageMetadata,
  portRef,
  // Emergency stop
  showEmergencyStop,
  onEmergencyStop,
  // Close tabs
  showCloseTabs,
  workerTabGroups = [],
  sessionIdForCleanup,
  onClosedTabs,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [handbackText, setHandbackText] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<WorkflowType>(WorkflowType.AUTO);
  // Use external state if provided (for persistence), otherwise local state
  const [localContextTabIds, setLocalContextTabIds] = useState<number[]>([]);
  const contextTabIds = externalContextTabIds ?? localContextTabIds;
  const setContextTabIds = onContextTabsChange ?? setLocalContextTabIds;
  const [textareaHeight, setTextareaHeight] = useState(expandedComposer ? 220 : DEFAULT_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const isSendButtonDisabled = useMemo(() => disabled || text.trim() === '', [disabled, text]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [workflowDropdownOpen, setWorkflowDropdownOpen] = useState(false);
  const [workflowDropdownPosition, setWorkflowDropdownPosition] = useState({ top: 0, right: 0 });
  const workflowDropdownRef = useRef<HTMLDivElement>(null);
  const workflowButtonRef = useRef<HTMLButtonElement>(null);

  // Close workflow dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        workflowDropdownRef.current &&
        !workflowDropdownRef.current.contains(e.target as Node) &&
        workflowButtonRef.current &&
        !workflowButtonRef.current.contains(e.target as Node)
      ) {
        setWorkflowDropdownOpen(false);
      }
    };
    if (workflowDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [workflowDropdownOpen]);

  // Update dropdown position when opened
  useEffect(() => {
    if (workflowDropdownOpen && workflowButtonRef.current) {
      const rect = workflowButtonRef.current.getBoundingClientRect();
      setWorkflowDropdownPosition({
        top: rect.top - 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [workflowDropdownOpen]);

  const selectedOption = AGENT_OPTIONS.find(o => o.type === selectedAgent) || AGENT_OPTIONS[0];
  const slashItems = useMemo(
    () => [
      { label: '/chat – Switch to Chat', value: '/chat ' },
      { label: '/search – Switch to Search', value: '/search ' },
      { label: '/agent – Switch to Agent', value: '/agent ' },
      { label: '/magent – Switch to Multi-Agent', value: '/magent ' },
    ],
    [],
  );

  // Close tabs functionality moved to status bar

  // Auto-detect agent type from text prefixes
  const detectAgentFromText = (text: string): WorkflowType | null => {
    const trimmed = text.trim().toLowerCase();
    if (trimmed.startsWith('/chat')) return WorkflowType.CHAT;
    if (trimmed.startsWith('/search')) return WorkflowType.SEARCH;
    if (trimmed.startsWith('/agent')) return WorkflowType.AGENT;
    if (trimmed.startsWith('/magent')) return WorkflowType.MULTIAGENT;
    return null;
  };

  // Handle text changes and resize textarea
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    const t = newText.trim().toLowerCase();
    const isCommandPrefix = t.startsWith('/') && !/^\/(chat|search|agent|magent)\b\s/.test(t);
    setShowSlashMenu(isCommandPrefix);

    // Auto-detect agent type from prefixes
    const detectedAgent = detectAgentFromText(newText);
    if (detectedAgent && detectedAgent !== selectedAgent) {
      setSelectedAgent(detectedAgent);
    }
  };

  // Expose a method to set content from outside
  useEffect(() => {
    if (setContent) {
      setContent(setText);
    }
  }, [setContent]);

  // Expose a method to set selected agent from parent
  useEffect(() => {
    if (setAgentSelector) {
      setAgentSelector(setSelectedAgent);
    }
  }, [setAgentSelector]);

  // Resize handle drag handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      resizeStartY.current = e.clientY;
      resizeStartHeight.current = textareaHeight;
    },
    [textareaHeight],
  );

  useEffect(() => {
    setTextareaHeight(expandedComposer ? 220 : DEFAULT_HEIGHT);
  }, [expandedComposer]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeStartY.current - e.clientY;
      const maxHeight = expandedComposer ? 420 : MAX_HEIGHT;
      const minHeight = expandedComposer ? 140 : MIN_HEIGHT;
      const newHeight = Math.min(maxHeight, Math.max(minHeight, resizeStartHeight.current + delta));
      setTextareaHeight(newHeight);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [expandedComposer, isResizing]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (text.trim()) {
        // Clean up text by removing prefixes if present
        let cleanText = text.trim();
        // If it's exactly a mode command (with or without trailing space), switch mode and stop
        if (/^\/chat\s*$/.test(cleanText)) {
          setSelectedAgent(WorkflowType.CHAT);
          setText('');
          return;
        }
        if (/^\/search\s*$/.test(cleanText)) {
          setSelectedAgent(WorkflowType.SEARCH);
          setText('');
          return;
        }
        if (/^\/agent\s*$/.test(cleanText)) {
          setSelectedAgent(WorkflowType.AGENT);
          setText('');
          return;
        }
        if (/^\/magent\s*$/.test(cleanText)) {
          setSelectedAgent(WorkflowType.MULTIAGENT);
          setText('');
          return;
        }
        // Remove leading mode command if followed by content
        cleanText = cleanText.replace(/^\/(chat|search|agent|magent)\b\s*/i, '');

        // Compute final context tab IDs: merge auto-context (minus excluded) with manual tabs
        let finalContextTabIds: number[] = contextTabIds;
        let skipAutoContext = false;
        if (autoContextEnabled) {
          // Compute effective auto tabs (auto - excluded)
          const effectiveAutoTabs = autoContextTabIds.filter(id => !excludedAutoTabIds.includes(id));
          // Merge with manual tabs (deduplicate)
          finalContextTabIds = [...new Set([...effectiveAutoTabs, ...contextTabIds])];
          // Tell background to skip auto-merging since we've already done it
          skipAutoContext = true;
        }

        // Capture full tab info for context tabs metadata BEFORE sending
        // This will be associated with the user message
        const timestamp = Date.now();
        if (onContextTabsCapture && finalContextTabIds.length > 0) {
          try {
            const allTabs = await chrome.tabs.query({ currentWindow: true });
            const contextTabsInfo: ContextTabInfo[] = [];
            for (const tabId of finalContextTabIds) {
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

        onSendMessage(
          cleanText || text,
          selectedAgent,
          finalContextTabIds.length ? finalContextTabIds : undefined,
          undefined,
          skipAutoContext,
        );
        setText('');
        // Don't clear context tabs - they persist until user removes them
        // Remember last manual choice; only reset if Auto
        setSelectedAgent(prev => (prev === WorkflowType.AUTO ? WorkflowType.AUTO : prev));
      }
    },
    [
      text,
      onSendMessage,
      selectedAgent,
      contextTabIds,
      autoContextEnabled,
      autoContextTabIds,
      excludedAutoTabIds,
      onContextTabsCapture,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSlashMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setSlashIndex(i => Math.max(0, Math.min(slashItems.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
        return;
      }
      if (showSlashMenu && e.key === 'Tab') {
        e.preventDefault();
        const chosen = slashItems[slashIndex];
        if (chosen) setText(chosen.value);
        setShowSlashMenu(false);
        return;
      }
      if (showSlashMenu && e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit, showSlashMenu, slashItems, slashIndex],
  );

  const handleReplay = useCallback(() => {
    if (historicalSessionId && onReplay) {
      onReplay(historicalSessionId);
    }
  }, [historicalSessionId, onReplay]);

  return (
    <form
      onSubmit={handleSubmit}
      className={`overflow-visible rounded-xl border transition-colors liquid-glass ${disabled ? 'cursor-not-allowed' : 'focus-within:border-violet-400 hover:border-violet-400'} ${isDarkMode ? '' : ''}`}
      aria-label="Chat input form">
      <div className="flex flex-col overflow-hidden rounded-xl">
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className={`flex justify-center py-1 cursor-ns-resize group ${isDarkMode ? 'hover:bg-slate-700/50' : 'hover:bg-gray-100'}`}>
          <div
            className={`w-8 h-1 rounded-full transition-colors ${
              isResizing
                ? 'bg-violet-400'
                : isDarkMode
                  ? 'bg-slate-600 group-hover:bg-slate-500'
                  : 'bg-gray-300 group-hover:bg-gray-400'
            }`}
          />
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-disabled={disabled}
          style={{ height: textareaHeight }}
          className={`w-full resize-none border-none p-2 focus:outline-none ${
            disabled
              ? isDarkMode
                ? 'cursor-not-allowed bg-slate-800 text-gray-400'
                : 'cursor-not-allowed bg-gray-100 text-gray-500'
              : isDarkMode
                ? 'bg-slate-800 text-gray-200'
                : 'bg-white'
          }`}
          placeholder="What can I help you with? Enter / for workflow commands."
          aria-label="Message input"
        />
        {showSlashMenu && (
          <div
            role="menu"
            aria-label="Slash commands"
            className={`z-10 mt-1 w-full overflow-hidden rounded-md border text-sm shadow ${isDarkMode ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-gray-200 bg-white text-gray-800'}`}>
            {slashItems.map((it, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`block w-full px-2 py-1 text-left ${i === slashIndex ? (isDarkMode ? 'bg-slate-800' : 'bg-gray-100') : ''}`}
                onClick={() => {
                  setText(it.value);
                  setShowSlashMenu(false);
                }}>
                {it.label}
              </button>
            ))}
          </div>
        )}

        <div className={`flex items-center justify-between px-3 py-1.5`}>
          <div className="flex gap-1.5 text-gray-500 items-center">
            {/* Tab Context Selector - available for all workflows */}
            {!showStopButton && !historicalSessionId && (
              <TabContextSelector
                selectedTabIds={contextTabIds}
                onSelectionChange={setContextTabIds}
                isDarkMode={isDarkMode}
                disabled={disabled}
                autoContextEnabled={autoContextEnabled}
                autoContextTabIds={autoContextTabIds}
                excludedAutoTabIds={excludedAutoTabIds}
                onExcludedAutoTabIdsChange={onExcludedAutoTabIdsChange}
                onAutoContextToggle={onAutoContextToggle}
              />
            )}
            {/* Microphone button for voice input */}
            {onMicClick && !showStopButton && (
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
            {/* Session stats tooltip */}
            {sessionStats && formatUsd && sessionStats.totalRequests > 0 && (
              <SessionStatsBar isDarkMode={isDarkMode} sessionStats={sessionStats} formatUsd={formatUsd} />
            )}
            {/* Debug dropdown */}
            {currentSessionId && portRef && agentTraceRootIdRef && (
              <DebugButtons
                currentSessionId={currentSessionId}
                agentTraceRootIdRef={agentTraceRootIdRef}
                currentTaskAgentType={currentTaskAgentType || null}
                messageMetadata={messageMetadata}
                portRef={portRef}
                isDarkMode={isDarkMode}
                setErrorLogEntries={() => {}}
              />
            )}
            {/* Close Tabs button */}
            {(showCloseTabs || workerTabGroups.length > 0) && (
              <CloseTabsButton
                isDarkMode={isDarkMode}
                workerTabGroups={workerTabGroups}
                sessionIdForCleanup={sessionIdForCleanup}
                onCompleted={onClosedTabs}
              />
            )}
            {/* Emergency Stop button */}
            {showEmergencyStop && onEmergencyStop && (
              <button
                type="button"
                onClick={onEmergencyStop}
                title="Emergency Stop - Immediately terminate ALL extension activity"
                aria-label="Emergency stop"
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition-colors ${
                  isDarkMode
                    ? 'text-red-400 hover:text-red-300 hover:bg-red-950/50'
                    : 'text-red-500 hover:text-red-600 hover:bg-red-50'
                }`}>
                <FiAlertOctagon className="h-3.5 w-3.5" />
                <span>Stop</span>
              </button>
            )}
          </div>

          {showStopButton ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onStopTask}
                disabled={isStopping}
                title="Stop"
                aria-label="Stop"
                className={`rounded-md p-1.5 text-white transition-colors flex items-center justify-center ${
                  isStopping ? 'bg-red-400 cursor-wait' : 'bg-red-500 hover:bg-red-600'
                }`}>
                {isStopping ? (
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                ) : (
                  <FaStop className="h-3 w-3" />
                )}
              </button>
              {onPauseTask && !isPaused && (
                <button
                  type="button"
                  onClick={onPauseTask}
                  title="Pause"
                  aria-label="Pause"
                  className={`rounded-md p-1.5 text-white transition-colors ${isDarkMode ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-yellow-500 hover:bg-yellow-600'}`}>
                  <FaPause className="h-3 w-3" />
                </button>
              )}
              {isPaused && onHandBackControl && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={handbackText}
                    onChange={e => setHandbackText(e.target.value)}
                    placeholder="Optional instructions"
                    className={`rounded border px-2 py-1 text-xs w-32 ${isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-600' : 'bg-white text-gray-800 border-gray-300'}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        onHandBackControl(handbackText.trim() || undefined);
                        setHandbackText('');
                      } catch {}
                    }}
                    title="Resume"
                    aria-label="Resume"
                    className={`rounded-md p-1.5 text-white transition-colors ${isDarkMode ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'}`}>
                    <FaPlay className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          ) : historicalSessionId ? (
            <button
              type="button"
              onClick={handleReplay}
              disabled={!historicalSessionId}
              aria-disabled={!historicalSessionId}
              className={`rounded-md bg-green-500 px-3 py-1 text-white transition-colors hover:enabled:bg-green-600 ${!historicalSessionId ? 'cursor-not-allowed opacity-50' : ''}`}>
              Replay
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Workflow dropdown selector */}
              <div className="relative">
                <button
                  ref={workflowButtonRef}
                  type="button"
                  onClick={() => setWorkflowDropdownOpen(!workflowDropdownOpen)}
                  disabled={disabled}
                  title={selectedOption.name}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                    isDarkMode
                      ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                  {selectedOption.icon}
                  <FaChevronDown
                    className={`w-2 h-2 transition-transform ${workflowDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {workflowDropdownOpen &&
                  createPortal(
                    <div
                      ref={workflowDropdownRef}
                      style={{
                        position: 'fixed',
                        top: workflowDropdownPosition.top,
                        right: workflowDropdownPosition.right,
                        transform: 'translateY(-100%)',
                      }}
                      className={`w-40 rounded-lg border shadow-lg z-[9999] ${
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
                    </div>,
                    document.body,
                  )}
              </div>

              {/* Send Button */}
              <button
                type="submit"
                disabled={isSendButtonDisabled}
                aria-disabled={isSendButtonDisabled}
                title="Send"
                aria-label="Send message"
                className={`rounded-md bg-violet-500 p-1.5 text-white transition-colors hover:enabled:bg-violet-600 shadow ${isSendButtonDisabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                <FaArrowUp className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
