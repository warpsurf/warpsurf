import React, { useEffect, useRef, useState } from 'react';
import {
  FiChevronDown,
  FiCommand,
  FiMessageSquare,
  FiMoon,
  FiMoreHorizontal,
  FiPlus,
  FiSettings,
  FiSun,
} from 'react-icons/fi';
import { FaFish } from 'react-icons/fa';
import { generalSettingsStore } from '@extension/storage';
import { useHeaderOverflow } from '../../hooks/use-header-overflow';
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
  onClearDisplay: () => void;
  onRefreshHistoryContext?: () => Promise<void>;
  onEmergencyStopToggle?: (enabled: boolean) => void;
  hasAcceptedHistoryPrivacy?: boolean | null;
  promptHistoryPrivacy?: () => Promise<boolean>;
  resetHistoryPrivacy?: () => Promise<void>;
}

const HeaderActions: React.FC<HeaderActionsProps> = props => {
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [themeMode, setThemeMode] = useState<'auto' | 'light' | 'dark'>('auto');
  const pauseMenusOpen = props.feedbackMenuOpen || props.fishMenuOpen;
  const {
    actionsContainerRef,
    moreButtonMeasureRef,
    setActionRef,
    setMeasureRef,
    visibleActionsCount,
    moreMenuOpen,
    setMoreMenuOpen,
  } = useHeaderOverflow({ pauseRecalculation: pauseMenusOpen });

  type HeaderActionKey = 'newChat' | 'dashboard' | 'settings' | 'theme' | 'fish' | 'feedback';
  const actionOrder: HeaderActionKey[] = ['newChat', 'dashboard', 'settings', 'theme', 'fish', 'feedback'];
  const vCount = Math.max(0, Math.min(actionOrder.length, props.visibleActionsCountOverride ?? visibleActionsCount));
  const hiddenKeys = actionOrder.slice(vCount);

  useEffect(() => {
    (async () => {
      try {
        const s = await generalSettingsStore.getSettings();
        setThemeMode((s.themeMode as 'auto' | 'light' | 'dark') || 'auto');
      } catch {}
    })();
  }, []);

  const handleThemeToggle = async () => {
    const nextMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
    try {
      await generalSettingsStore.updateSettings({ themeMode: nextMode });
    } catch {}
  };

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

  const iconButtonClass = `header-icon rounded-md p-1 transition-colors ${
    props.isDarkMode
      ? 'text-slate-400 hover:text-slate-100 hover:bg-white/10'
      : 'text-gray-600 hover:text-gray-900 hover:bg-black/5'
  }`;

  return (
    <div ref={actionsContainerRef} className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-visible">
      <button
        ref={moreButtonMeasureRef}
        type="button"
        aria-hidden="true"
        className={`liquid-chip inline-flex items-center gap-2 rounded-md px-2 py-1 text-[12px] ${props.isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }}>
        <FiMoreHorizontal className="h-4 w-4" />
        <FiChevronDown className="h-3 w-3" />
      </button>

      <div aria-hidden="true" className="absolute -z-10 opacity-0 pointer-events-none" style={{ visibility: 'hidden' }}>
        <div ref={setMeasureRef('newChat')} className="inline-flex flex-shrink-0">
          <button type="button" className={iconButtonClass}>
            <FiPlus className="h-4 w-4" />
          </button>
        </div>
        <div ref={setMeasureRef('dashboard')} className="inline-flex flex-shrink-0">
          <button type="button" className={iconButtonClass}>
            <FiCommand className="h-4 w-4" />
          </button>
        </div>
        <div ref={setMeasureRef('settings')} className="inline-flex flex-shrink-0">
          <button type="button" className={iconButtonClass}>
            <FiSettings className="h-4 w-4" />
          </button>
        </div>
        <div ref={setMeasureRef('theme')} className="inline-flex flex-shrink-0">
          <button type="button" className={iconButtonClass}>
            <FiSun className="h-4 w-4" />
          </button>
        </div>
        <div ref={setMeasureRef('fish')} className="inline-flex flex-shrink-0">
          <button type="button" className={iconButtonClass}>
            <FaFish className="h-4 w-4" />
          </button>
        </div>
        <div ref={setMeasureRef('feedback')} className="inline-flex flex-shrink-0">
          <button type="button" className={iconButtonClass}>
            <FiMessageSquare className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={setActionRef('newChat')}
        className="inline-flex flex-shrink-0"
        style={{ display: vCount >= 1 ? 'inline-flex' : 'none' }}>
        <button
          type="button"
          onClick={props.onNewChat}
          title="New chat"
          aria-label="New chat"
          className={iconButtonClass}>
          <FiPlus className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={setActionRef('dashboard')}
        className="inline-flex flex-shrink-0"
        style={{ display: vCount >= 2 ? 'inline-flex' : 'none' }}>
        <button
          type="button"
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('agent-manager/index.html') })}
          title="Agent manager"
          aria-label="Agent manager"
          className={`${iconButtonClass} relative`}>
          <FiCommand className="h-4 w-4" />
          {(props.runningAgentsCount ?? 0) > 0 && (
            <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white">
              {props.runningAgentsCount}
            </span>
          )}
        </button>
      </div>

      <div
        ref={setActionRef('settings')}
        className="inline-flex flex-shrink-0"
        style={{ display: vCount >= 3 ? 'inline-flex' : 'none' }}>
        <button
          type="button"
          onClick={() => chrome.runtime.openOptionsPage()}
          title="Settings"
          aria-label="Settings"
          className={iconButtonClass}>
          <FiSettings className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={setActionRef('theme')}
        className="inline-flex flex-shrink-0"
        style={{ display: vCount >= 4 ? 'inline-flex' : 'none' }}>
        <button
          type="button"
          onClick={handleThemeToggle}
          title={`Theme: ${themeMode}`}
          aria-label="Theme"
          className={iconButtonClass}>
          {themeMode === 'dark' ? <FiMoon className="h-4 w-4" /> : <FiSun className="h-4 w-4" />}
        </button>
      </div>

      <div
        ref={setActionRef('fish')}
        className="relative inline-block flex-shrink-0"
        style={{ display: vCount >= 5 ? 'inline-block' : 'none' }}
        data-dropdown>
        <button
          type="button"
          onClick={() => props.setFishMenuOpen(!props.fishMenuOpen)}
          title="Fish"
          aria-label="Fish"
          aria-expanded={props.fishMenuOpen}
          className={iconButtonClass}>
          <FaFish className="h-4 w-4" />
        </button>
        {props.fishMenuOpen && (
          <div
            role="menu"
            aria-label="Fish menu"
            className={`absolute right-0 top-full z-50 mt-1 w-56 rounded-md border p-2 text-sm shadow-lg ${props.isDarkMode ? 'border-slate-700 bg-slate-800/95 text-slate-200' : 'border-gray-200 bg-white/95 text-gray-800'}`}>
            <button
              type="button"
              onClick={props.onFishAdd}
              className={`flex w-full rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              Add Fish
            </button>
            <button
              type="button"
              onClick={props.onSharkAdd}
              className={`mt-1 flex w-full rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              Add Shark
            </button>
            <button
              type="button"
              onClick={props.onFeedingTime}
              className={`mt-1 flex w-full rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              Feeding Time
            </button>
            <button
              type="button"
              onClick={props.onTriggerWave}
              className={`mt-1 flex w-full rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              Trigger Wave
            </button>
            <button
              type="button"
              onClick={props.onShowPopulations}
              className={`mt-1 flex w-full rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              Populations
            </button>
            <button
              type="button"
              onClick={props.onViewDisplay}
              className={`mt-1 flex w-full rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              View Display
            </button>
            <button
              type="button"
              onClick={props.onClearDisplay}
              className={`mt-1 flex w-full rounded px-3 py-2 ${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'}`}>
              Clear Display
            </button>
          </div>
        )}
      </div>

      <div
        ref={setActionRef('feedback')}
        className="relative inline-block flex-shrink-0"
        style={{ display: vCount >= 6 ? 'inline-block' : 'none' }}
        data-dropdown>
        <button
          type="button"
          onClick={() => props.setFeedbackMenuOpen(!props.feedbackMenuOpen)}
          title="Feedback"
          aria-label="Feedback"
          aria-expanded={props.feedbackMenuOpen}
          className={iconButtonClass}>
          <FiMessageSquare className="h-4 w-4" />
        </button>
        {props.feedbackMenuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1">
            <FeedbackMenu
              isDarkMode={props.isDarkMode}
              open={props.feedbackMenuOpen}
              onToggleOpen={() => props.setFeedbackMenuOpen(!props.feedbackMenuOpen)}
            />
          </div>
        )}
      </div>

      {vCount < actionOrder.length && (
        <div ref={moreMenuRef} className="relative flex-shrink-0" data-dropdown>
          <button
            type="button"
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            aria-haspopup="true"
            aria-expanded={moreMenuOpen}
            aria-label="More options"
            className={`liquid-chip flex items-center gap-1 rounded-md px-2 py-1 text-[12px] ${props.isDarkMode ? 'text-slate-200 hover:bg-white/10' : 'text-gray-700 hover:bg-black/5'}`}>
            <FiMoreHorizontal className="h-4 w-4" />
            <FiChevronDown className="h-3 w-3" />
          </button>
          {moreMenuOpen && (
            <div
              role="menu"
              aria-label="More menu"
              className={`absolute right-0 top-full z-50 mt-1 w-56 rounded-md border p-2 text-sm shadow-lg ${props.isDarkMode ? 'border-slate-700 bg-slate-800/95 text-slate-200' : 'border-gray-200 bg-white/95 text-gray-800'}`}>
              {hiddenKeys.includes('newChat') && (
                <button
                  type="button"
                  onClick={() => {
                    props.onNewChat();
                    setMoreMenuOpen(false);
                  }}
                  className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} flex w-full items-center gap-2 rounded px-3 py-2`}>
                  <FiPlus className="h-4 w-4" />
                  New chat
                </button>
              )}
              {hiddenKeys.includes('dashboard') && (
                <button
                  type="button"
                  onClick={() => {
                    chrome.tabs.create({ url: chrome.runtime.getURL('agent-manager/index.html') });
                    setMoreMenuOpen(false);
                  }}
                  className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center gap-2 rounded px-3 py-2`}>
                  <FiCommand className="h-4 w-4" />
                  Agent manager
                </button>
              )}
              {hiddenKeys.includes('settings') && (
                <button
                  type="button"
                  onClick={() => {
                    chrome.runtime.openOptionsPage();
                    setMoreMenuOpen(false);
                  }}
                  className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center gap-2 rounded px-3 py-2`}>
                  <FiSettings className="h-4 w-4" />
                  Settings
                </button>
              )}
              {hiddenKeys.includes('theme') && (
                <button
                  type="button"
                  onClick={() => {
                    handleThemeToggle();
                    setMoreMenuOpen(false);
                  }}
                  className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center gap-2 rounded px-3 py-2`}>
                  <FiSun className="h-4 w-4" />
                  Theme
                </button>
              )}
              {hiddenKeys.includes('fish') && (
                <button
                  type="button"
                  onClick={() => {
                    props.setFishMenuOpen(true);
                    setMoreMenuOpen(false);
                  }}
                  className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center gap-2 rounded px-3 py-2`}>
                  <FaFish className="h-4 w-4" />
                  Fish
                </button>
              )}
              {hiddenKeys.includes('feedback') && (
                <button
                  type="button"
                  onClick={() => {
                    props.setFeedbackMenuOpen(true);
                    setMoreMenuOpen(false);
                  }}
                  className={`${props.isDarkMode ? 'hover:bg-slate-700/70' : 'hover:bg-gray-100'} mt-1 flex w-full items-center gap-2 rounded px-3 py-2`}>
                  <FiMessageSquare className="h-4 w-4" />
                  Feedback
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HeaderActions;
