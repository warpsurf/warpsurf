import React, { useState, useEffect, useRef } from 'react';
import { FiChevronDown, FiMoreHorizontal, FiSettings, FiHelpCircle } from 'react-icons/fi';
import { FaFish, FaRobot, FaHistory, FaChrome } from 'react-icons/fa';
import { RxGithubLogo } from 'react-icons/rx';
import { useHeaderOverflow } from '../../hooks/use-header-overflow';
import { generalSettingsStore } from '@extension/storage';
import FeedbackMenu from './feedback-menu';

interface HeaderActionsProps {
  isDarkMode: boolean;
  visibleActionsCountOverride?: number;
  onNewChat: () => void;
  onLoadHistory: () => void;
  onLoadDashboard: () => void;
  runningAgentsCount?: number;
  agentSettingsOpen: boolean;
  setAgentSettingsOpen: (v: boolean) => void;
  feedbackMenuOpen: boolean;
  setFeedbackMenuOpen: (v: boolean) => void;
  fishMenuOpen: boolean;
  setFishMenuOpen: (v: boolean) => void;
  onFishAdd: () => void;
  onSharkAdd: () => void;
  onFeedingTime: () => void;
  onTriggerWave: () => void;
  onShowPopulations: () => void;
  feedOnClick: boolean;
  setFeedOnClick: (v: boolean) => void;
  onViewDisplay: () => void;
  onRefreshHistoryContext?: () => Promise<void>;
  onEmergencyStopToggle?: (enabled: boolean) => void;
  hasAcceptedHistoryPrivacy?: boolean | null;
  promptHistoryPrivacy?: () => Promise<boolean>;
  resetHistoryPrivacy?: () => Promise<void>;
}

const HeaderActions: React.FC<HeaderActionsProps> = props => {
  const [useVision, setUseVision] = useState(false);
  const [showTabPreviews, setShowTabPreviews] = useState(true);
  const [enableHistoryContext, setEnableHistoryContext] = useState(false);
  const [enableWorkflowEstimation, setEnableWorkflowEstimation] = useState(false);
  const [showEmergencyStop, setShowEmergencyStop] = useState(true);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const getFn: any = (generalSettingsStore as any)?.getSettings;
        const s = typeof getFn === 'function' ? await getFn.call(generalSettingsStore) : null;
        if (s) {
          setUseVision(!!s.useVision);
          setShowTabPreviews(!!(s.showTabPreviews ?? true));
          setEnableHistoryContext(!!(s.enableHistoryContext ?? false));
          setEnableWorkflowEstimation(!!(s.enableWorkflowEstimation ?? false));
          setShowEmergencyStop(!!(s.showEmergencyStop ?? true));
        }
      } catch {}
    })();
  }, []);
  const pauseMenusOpen = props.agentSettingsOpen || props.feedbackMenuOpen || props.fishMenuOpen;
  const {
    actionsContainerRef,
    moreButtonMeasureRef,
    setActionRef,
    setMeasureRef,
    visibleActionsCount,
    moreMenuOpen,
    setMoreMenuOpen,
  } = useHeaderOverflow({ pauseRecalculation: pauseMenusOpen });

  const vCount = Math.max(0, Math.min(6, props.visibleActionsCountOverride ?? visibleActionsCount));

  type ActionKey = 'newChat' | 'dashboard' | 'agentSettings' | 'feedback' | 'fish' | 'settings';
  const actionOrder: ActionKey[] = ['settings', 'newChat', 'dashboard', 'agentSettings', 'feedback', 'fish'];
  const hiddenKeys: ActionKey[] = actionOrder.slice(vCount);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!moreMenuRef.current?.contains(t)) setMoreMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreMenuOpen, setMoreMenuOpen]);

  return (
    <div ref={actionsContainerRef} className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-visible">
      {/* Hidden measure for More button */}
      <button
        ref={moreButtonMeasureRef}
        type="button"
        aria-hidden="true"
        className={`liquid-chip inline-flex items-center gap-2 rounded-md px-2.5 py-0.5 text-[12px] font-medium ${props.isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }}>
        <FiMoreHorizontal className="h-4 w-4" />
        <span>More</span>
        <FiChevronDown className="h-3.5 w-3.5" />
      </button>

      {/* Hidden measurement clones */}
      <div aria-hidden="true" className="absolute -z-10 opacity-0 pointer-events-none" style={{ visibility: 'hidden' }}>
        <div ref={setMeasureRef('settings')} className="inline-flex flex-shrink-0">
          <button
            type="button"
            className={`header-icon ${props.isDarkMode ? 'text-gray-400 rounded-md p-1' : 'text-gray-600 rounded-md p-1'}`}>
            <FiSettings size={20} />
          </button>
        </div>
        <div ref={setMeasureRef('newChat')} className="inline-flex flex-shrink-0">
          <button
            type="button"
            className={`rounded-md px-2.5 py-0.5 text-[12px] font-medium ${props.isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            New Chat
          </button>
        </div>
        <div ref={setMeasureRef('dashboard')} className="inline-flex flex-shrink-0">
          <button
            type="button"
            className={`rounded-md px-2.5 py-0.5 text-[12px] font-medium ${props.isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            Agent Manager
          </button>
        </div>
        <div ref={setMeasureRef('agentSettings')} className="inline-flex flex-shrink-0">
          <button
            type="button"
            className={`liquid-chip flex items-center gap-2 rounded-md px-2.5 py-0.5 text-[12px] font-medium ${props.isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            <FaRobot className="h-4 w-4" />
            <span>Agent Settings</span>
            <FiChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <div ref={setMeasureRef('feedback')} className="inline-flex flex-shrink-0">
          <button
            type="button"
            className={`liquid-chip flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[12px] font-medium ${props.isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            <span>Feedback</span>
            <FiChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <div ref={setMeasureRef('fish')} className="inline-flex flex-shrink-0">
          <button
            type="button"
            className={`liquid-chip flex items-center gap-2 rounded-md px-2.5 py-0.5 text-[12px] font-medium ${props.isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            <FaFish className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Settings */}
      <div
        ref={setActionRef('settings')}
        className="inline-flex flex-shrink-0"
        style={{ display: vCount >= 1 ? 'inline-flex' : 'none' }}>
        <button
          type="button"
          onClick={() => chrome.runtime.openOptionsPage()}
          className={`header-icon transition-colors ${props.isDarkMode ? 'text-gray-400 hover:text-white hover:bg-white/10 rounded-md p-1' : 'text-gray-600 hover:text-gray-900 hover:bg-black/5 rounded-md p-1'} cursor-pointer`}>
          <FiSettings size={20} />
        </button>
      </div>

      {/* New Chat */}
      <div
        ref={setActionRef('newChat')}
        className="inline-flex flex-shrink-0"
        style={{ display: vCount >= 2 ? 'inline-flex' : 'none' }}>
        <button
          type="button"
          onClick={() => props.onNewChat()}
          className={`rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${props.isDarkMode ? 'text-gray-200 hover:text-white hover:bg-white/10' : 'text-gray-700 hover:text-gray-900 hover:bg-black/5'}`}>
          New Chat
        </button>
      </div>

      {/* Agent Dashboard */}
      <div
        ref={setActionRef('dashboard')}
        className="inline-flex flex-shrink-0"
        style={{ display: vCount >= 3 ? 'inline-flex' : 'none' }}>
        <button
          type="button"
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('agent-manager/index.html') })}
          className={`relative rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${props.isDarkMode ? 'text-gray-200 hover:text-white hover:bg-white/10' : 'text-gray-700 hover:text-gray-900 hover:bg-black/5'}`}>
          Agent Manager
          {(props.runningAgentsCount ?? 0) > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-500 px-1 text-[10px] font-bold text-white">
              {props.runningAgentsCount}
            </span>
          )}
        </button>
      </div>

      {/* Agent settings dropdown */}
      <div
        ref={setActionRef('agentSettings')}
        className="relative inline-block flex-shrink-0 group"
        style={{ display: vCount >= 4 ? 'inline-block' : 'none' }}
        data-dropdown>
        <button
          type="button"
          onClick={() => props.setAgentSettingsOpen(!props.agentSettingsOpen)}
          className={`liquid-chip flex items-center gap-2 rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${props.isDarkMode ? 'text-gray-200 hover:text-white hover:bg-white/10' : 'text-gray-700 hover:text-gray-900 hover:bg-black/5'}`}
          aria-haspopup="true"
          aria-expanded={props.agentSettingsOpen}>
          <FaRobot className="h-4 w-4" />
          <span>Agent Settings</span>
          <FiChevronDown className="h-3.5 w-3.5" />
        </button>
        {props.agentSettingsOpen && (
          <div
            role="menu"
            aria-label="Agent settings menu"
            className={`absolute right-0 top-full mt-1 w-64 rounded-md border p-2 text-sm shadow-lg z-50 ${props.isDarkMode ? 'border-slate-700 bg-slate-800/95 text-slate-200' : 'border-gray-200 bg-white/95 text-gray-800'}`}>
            <button
              type="button"
              onClick={async () => {
                const next = !useVision;
                setUseVision(next);
                try {
                  await generalSettingsStore.updateSettings({ useVision: next });
                } catch {}
              }}
              className={`flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <div className="flex flex-col items-start">
                <span>Use vision</span>
                <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                  Provide agents with screenshots of current tab
                </span>
              </div>
              <span className={`ml-2 toggle-slider ${useVision ? 'toggle-on' : 'toggle-off'}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              type="button"
              onClick={async () => {
                const next = !showTabPreviews;
                setShowTabPreviews(next);
                try {
                  await generalSettingsStore.updateSettings({ showTabPreviews: next });
                } catch {}
              }}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <div className="flex flex-col items-start">
                <span>Show tab previews</span>
                <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                  Show screenshots of agent tabs
                </span>
              </div>
              <span className={`ml-2 toggle-slider ${showTabPreviews ? 'toggle-on' : 'toggle-off'}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              type="button"
              onClick={async () => {
                // If enabling, always prompt privacy warning
                if (!enableHistoryContext && props.promptHistoryPrivacy) {
                  const accepted = await props.promptHistoryPrivacy();
                  if (!accepted) return;
                }
                // If disabling, reset privacy acceptance so warning shows again next time
                if (enableHistoryContext && props.resetHistoryPrivacy) {
                  await props.resetHistoryPrivacy();
                }
                const next = !enableHistoryContext;
                setEnableHistoryContext(next);
                try {
                  await generalSettingsStore.updateSettings({ enableHistoryContext: next });
                } catch {}
              }}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <div className="flex flex-col items-start">
                <span>Use history context</span>
                <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                  Use browser history to help the agents
                </span>
              </div>
              <span className={`ml-2 toggle-slider ${enableHistoryContext ? 'toggle-on' : 'toggle-off'}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              type="button"
              onClick={async () => {
                const next = !enableWorkflowEstimation;
                setEnableWorkflowEstimation(next);
                try {
                  await generalSettingsStore.updateSettings({ enableWorkflowEstimation: next });
                } catch {}
              }}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <div className="flex flex-col items-start">
                <span>Task estimation</span>
                <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                  Estimate the time and cost of a task
                </span>
              </div>
              <span className={`ml-2 toggle-slider ${enableWorkflowEstimation ? 'toggle-on' : 'toggle-off'}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <button
              type="button"
              onClick={async () => {
                const next = !showEmergencyStop;
                setShowEmergencyStop(next);
                try {
                  await generalSettingsStore.updateSettings({ showEmergencyStop: next });
                } catch {}
                // Also update parent state if callback provided
                if (props.onEmergencyStopToggle) props.onEmergencyStopToggle(next);
              }}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <div className="flex flex-col items-start">
                <span>Emergency stop button</span>
                <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                  Instantly terminate all workflows
                </span>
              </div>
              <span className={`ml-2 toggle-slider ${showEmergencyStop ? 'toggle-on' : 'toggle-off'}`}>
                <span className="toggle-knob" />
              </span>
            </button>

            <div className={`my-2 border-t ${props.isDarkMode ? 'border-slate-700' : 'border-gray-200'}`} />

            <button
              type="button"
              onClick={() => {
                props.setAgentSettingsOpen(false);
                if (props.onRefreshHistoryContext) {
                  props.onRefreshHistoryContext().catch(e => {
                    console.error('[HeaderActions] Handler error:', e);
                  });
                } else {
                  console.error('[HeaderActions] Handler NOT provided!');
                }
              }}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <div className="flex flex-col items-start">
                <span>Refresh history context</span>
                <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                  Refresh browser history context
                </span>
              </div>
              <FaHistory className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Feedback */}
      <div
        ref={setActionRef('feedback')}
        className="relative inline-block flex-shrink-0 group"
        style={{ display: vCount >= 5 ? 'inline-block' : 'none' }}
        data-dropdown>
        <button
          type="button"
          onClick={() => props.setFeedbackMenuOpen(!props.feedbackMenuOpen)}
          className={`liquid-chip flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${props.isDarkMode ? 'text-gray-200 hover:text-white hover:bg-white/10' : 'text-gray-700 hover:text-gray-900 hover:bg-black/5'}`}
          aria-haspopup="true"
          aria-expanded={props.feedbackMenuOpen}>
          <span>Feedback</span>
          <FiChevronDown className="h-3.5 w-3.5" />
        </button>
        {props.feedbackMenuOpen && (
          <div className="absolute right-0 top-full mt-1 z-50">
            <FeedbackMenu
              isDarkMode={props.isDarkMode}
              open={props.feedbackMenuOpen}
              onToggleOpen={() => props.setFeedbackMenuOpen(!props.feedbackMenuOpen)}
            />
          </div>
        )}
      </div>

      {/* Fish */}
      <div
        ref={setActionRef('fish')}
        className="relative inline-block flex-shrink-0 group"
        style={{ display: vCount >= 6 ? 'inline-block' : 'none' }}
        data-dropdown>
        <button
          type="button"
          onClick={() => props.setFishMenuOpen(!props.fishMenuOpen)}
          className={`liquid-chip flex items-center gap-2 rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${props.isDarkMode ? 'text-gray-200 hover:text-white hover:bg-white/10' : 'text-gray-700 hover:text-gray-900 hover:bg-black/5'}`}
          aria-haspopup="true"
          aria-expanded={props.fishMenuOpen}>
          <FaFish className="h-3.5 w-3.5" />
        </button>
        {props.fishMenuOpen && (
          <div
            role="menu"
            aria-label="Fish menu"
            className={`absolute right-0 top-full mt-1 w-60 rounded-md border p-2 text-sm shadow-lg z-50 ${props.isDarkMode ? 'border-slate-700 bg-slate-800/95 text-slate-200' : 'border-gray-200 bg-white/95 text-gray-800'}`}>
            <button
              type="button"
              onClick={props.onFishAdd}
              className={`flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <span>Add Fish</span>
            </button>
            <button
              type="button"
              onClick={props.onSharkAdd}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <span>Add Shark</span>
            </button>
            <button
              type="button"
              onClick={props.onFeedingTime}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <span>Feeding Time</span>
            </button>
            <button
              type="button"
              onClick={props.onTriggerWave}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <span>Trigger Wave</span>
            </button>
            <button
              type="button"
              onClick={props.onShowPopulations}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <span>Populations</span>
            </button>
            <button
              type="button"
              onClick={props.onViewDisplay}
              className={`mt-1 flex w-full items-center justify-between rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              <span>View Display</span>
            </button>
            <div className="mt-2 flex items-center justify-between rounded px-3 py-2">
              <span>Feed on Click</span>
              <button
                type="button"
                onClick={() => props.setFeedOnClick(!props.feedOnClick)}
                className={`toggle-slider ${props.feedOnClick ? 'toggle-on' : 'toggle-off'}`}
                aria-pressed={props.feedOnClick}
                aria-label="Feed on Click toggle">
                <span className="toggle-knob" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* More menu trigger and menu stub (items still rendered in SidePanel for now) */}
      {vCount < 6 && (
        <div ref={moreMenuRef} className="relative flex-shrink-0 group" data-dropdown>
          <button
            type="button"
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            className={`liquid-chip flex items-center gap-2 rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${props.isDarkMode ? 'text-gray-200 hover:text-white hover:bg-white/10' : 'text-gray-700 hover:text-gray-900 hover:bg-black/5'}`}
            aria-haspopup="true"
            aria-expanded={moreMenuOpen}
            aria-label="More options"
            title="More options">
            <FiMoreHorizontal className="h-4 w-4" />
            <span>More</span>
            <FiChevronDown className="h-3.5 w-3.5" />
          </button>

          {moreMenuOpen && (
            <div
              role="menu"
              aria-label="More menu"
              className={`absolute right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto rounded-md border p-2 text-sm shadow-lg z-50 ${props.isDarkMode ? 'border-slate-700 bg-slate-800/95 text-slate-200' : 'border-gray-200 bg-white/95 text-gray-800'}`}>
              {hiddenKeys.includes('settings') && (
                <button
                  type="button"
                  onClick={() => {
                    chrome.runtime.openOptionsPage();
                    setMoreMenuOpen(false);
                  }}
                  className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} flex w-full items-center rounded px-3 py-2`}>
                  Settings
                </button>
              )}
              {hiddenKeys.includes('newChat') && (
                <button
                  type="button"
                  onClick={() => {
                    props.onNewChat();
                    setMoreMenuOpen(false);
                  }}
                  className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} flex w-full items-center rounded px-3 py-2`}>
                  New Chat
                </button>
              )}
              {hiddenKeys.includes('dashboard') && (
                <button
                  type="button"
                  onClick={() => {
                    chrome.tabs.create({ url: chrome.runtime.getURL('agent-manager/index.html') });
                    setMoreMenuOpen(false);
                  }}
                  className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center justify-between rounded px-3 py-2`}>
                  <span>Agent Manager</span>
                  {(props.runningAgentsCount ?? 0) > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-green-500 px-1 text-[10px] font-bold text-white">
                      {props.runningAgentsCount}
                    </span>
                  )}
                </button>
              )}

              {hiddenKeys.includes('agentSettings') && (
                <div className="mt-2 border-t pt-2">
                  <div className="px-3 pb-1 font-medium opacity-80">Agent Settings</div>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !useVision;
                      setUseVision(next);
                      try {
                        await generalSettingsStore.updateSettings({ useVision: next });
                      } catch {}
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} flex w-full items-center justify-between rounded px-3 py-2`}>
                    <div className="flex flex-col items-start">
                      <span>Use vision</span>
                      <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        Provide agents with screenshots of current tab
                      </span>
                    </div>
                    <span className={`ml-2 toggle-slider ${useVision ? 'toggle-on' : 'toggle-off'}`}>
                      <span className="toggle-knob" />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !showTabPreviews;
                      setShowTabPreviews(next);
                      try {
                        await generalSettingsStore.updateSettings({ showTabPreviews: next });
                      } catch {}
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center justify-between rounded px-3 py-2`}>
                    <div className="flex flex-col items-start">
                      <span>Show tab previews</span>
                      <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        Show screenshots of agent tabs
                      </span>
                    </div>
                    <span className={`ml-2 toggle-slider ${showTabPreviews ? 'toggle-on' : 'toggle-off'}`}>
                      <span className="toggle-knob" />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!enableHistoryContext && props.promptHistoryPrivacy) {
                        const accepted = await props.promptHistoryPrivacy();
                        if (!accepted) return;
                      }
                      if (enableHistoryContext && props.resetHistoryPrivacy) {
                        await props.resetHistoryPrivacy();
                      }
                      const next = !enableHistoryContext;
                      setEnableHistoryContext(next);
                      try {
                        await generalSettingsStore.updateSettings({ enableHistoryContext: next });
                      } catch {}
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center justify-between rounded px-3 py-2`}>
                    <div className="flex flex-col items-start">
                      <span>Use history context</span>
                      <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        Use browser history to help the agents
                      </span>
                    </div>
                    <span className={`ml-2 toggle-slider ${enableHistoryContext ? 'toggle-on' : 'toggle-off'}`}>
                      <span className="toggle-knob" />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !enableWorkflowEstimation;
                      setEnableWorkflowEstimation(next);
                      try {
                        await generalSettingsStore.updateSettings({ enableWorkflowEstimation: next });
                      } catch {}
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center justify-between rounded px-3 py-2`}>
                    <div className="flex flex-col items-start">
                      <span>Task estimation</span>
                      <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        Estimate the time and cost of a task
                      </span>
                    </div>
                    <span className={`ml-2 toggle-slider ${enableWorkflowEstimation ? 'toggle-on' : 'toggle-off'}`}>
                      <span className="toggle-knob" />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !showEmergencyStop;
                      setShowEmergencyStop(next);
                      try {
                        await generalSettingsStore.updateSettings({ showEmergencyStop: next });
                      } catch {}
                      if (props.onEmergencyStopToggle) props.onEmergencyStopToggle(next);
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center justify-between rounded px-3 py-2`}>
                    <div className="flex flex-col items-start">
                      <span>Emergency stop button</span>
                      <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        Instantly terminate all workflows
                      </span>
                    </div>
                    <span className={`ml-2 toggle-slider ${showEmergencyStop ? 'toggle-on' : 'toggle-off'}`}>
                      <span className="toggle-knob" />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      if (props.onRefreshHistoryContext) {
                        props.onRefreshHistoryContext().catch(e => console.error('[HeaderActions] Handler error:', e));
                      }
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center justify-between rounded px-3 py-2`}>
                    <div className="flex flex-col items-start">
                      <span>Refresh history context</span>
                      <span className={`text-[10px] ${props.isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        Refresh browser history context
                      </span>
                    </div>
                    <FaHistory className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {hiddenKeys.includes('feedback') && (
                <div className="mt-2 border-t pt-2">
                  <div className="px-3 pb-1 font-medium opacity-80">Feedback</div>
                  <div className="px-3 py-1 text-xs opacity-70">Feedback is greatly appreciated</div>
                  <a
                    href="https://chromewebstore.google.com/detail/warpsurf/ekmohjijmhcdpgficcolmennloeljhod"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} flex items-center gap-2 rounded px-3 py-2`}>
                    <FaChrome className="h-3.5 w-3.5" />
                    <span>Chrome store</span>
                  </a>
                  <a
                    href="https://github.com/warpsurf/warpsurf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex items-center gap-2 rounded px-3 py-2`}>
                    <RxGithubLogo className="h-3.5 w-3.5" />
                    <span>GitHub</span>
                  </a>
                </div>
              )}

              {hiddenKeys.includes('fish') && (
                <div className="mt-2 border-t pt-2">
                  <div className="px-3 pb-1 font-medium opacity-80">Marine</div>
                  <button
                    type="button"
                    onClick={() => {
                      props.onFishAdd();
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} flex w-full items-center rounded px-3 py-2`}>
                    Add Fish
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      props.onSharkAdd();
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center rounded px-3 py-2`}>
                    Add Shark
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      props.onFeedingTime();
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center rounded px-3 py-2`}>
                    Feeding Time
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      props.onTriggerWave();
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center rounded px-3 py-2`}>
                    Trigger Wave
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      props.onShowPopulations();
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center rounded px-3 py-2`}>
                    Populations
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      props.onViewDisplay();
                    }}
                    className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center rounded px-3 py-2`}>
                    View Display
                  </button>
                  <div className="mt-2 flex items-center justify-between rounded px-3 py-2">
                    <span>Feed on Click</span>
                    <button
                      type="button"
                      onClick={() => props.setFeedOnClick(!props.feedOnClick)}
                      className={`toggle-slider ${props.feedOnClick ? 'toggle-on' : 'toggle-off'}`}
                      aria-pressed={props.feedOnClick}
                      aria-label="Feed on Click toggle">
                      <span className="toggle-knob" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HeaderActions;
