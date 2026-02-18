import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FaPlus, FaTimes, FaChevronDown, FaCheck, FaBan, FaBolt } from 'react-icons/fa';

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

interface TabContextSelectorProps {
  selectedTabIds: number[];
  onSelectionChange: (tabIds: number[]) => void;
  isDarkMode?: boolean;
  disabled?: boolean;
  // Auto-context mode props
  autoContextEnabled?: boolean;
  autoContextTabIds?: number[];
  excludedAutoTabIds?: number[];
  onExcludedAutoTabIdsChange?: (tabIds: number[]) => void;
  // Auto-context toggle
  onAutoContextToggle?: (enabled: boolean) => Promise<void>;
  // Compact mode - just plus icon with dropdown indicator
  compact?: boolean;
}

export function TabContextSelector({
  selectedTabIds,
  onSelectionChange,
  isDarkMode = false,
  disabled = false,
  autoContextEnabled = false,
  autoContextTabIds = [],
  excludedAutoTabIds = [],
  onExcludedAutoTabIdsChange,
  onAutoContextToggle,
  compact = false,
}: TabContextSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [blockedTabIds, setBlockedTabIds] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Compute effective auto tabs (auto - excluded - blocked)
  const effectiveAutoTabIds = autoContextEnabled
    ? autoContextTabIds.filter(id => !excludedAutoTabIds.includes(id) && !blockedTabIds.has(id))
    : [];

  const loadTabs = useCallback(async () => {
    try {
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const currentTab = allTabs.find(t => t.active);
      setCurrentTabId(currentTab?.id ?? null);

      const filteredTabs = allTabs
        .filter(
          t =>
            t.id !== undefined && t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'),
        )
        .map(t => ({
          id: t.id!,
          title: t.title || 'Untitled',
          url: t.url || '',
          favIconUrl: t.favIconUrl,
        }));

      setTabs(filteredTabs);

      // Check firewall status for all tabs
      const urlsToCheck = filteredTabs.map(t => ({ tabId: t.id, url: t.url }));
      if (urlsToCheck.length > 0) {
        try {
          chrome.runtime.sendMessage({ type: 'check_urls_firewall', urls: urlsToCheck }, response => {
            if (response?.results) {
              const blocked = new Set<number>();
              for (const { tabId, allowed } of response.results) {
                if (!allowed) blocked.add(tabId);
              }
              setBlockedTabIds(blocked);
            }
          });
        } catch {
          // Ignore firewall check errors
        }
      }
    } catch {
      setTabs([]);
    }
  }, []);

  useEffect(() => {
    loadTabs();
  }, [loadTabs]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideContainer = containerRef.current?.contains(target);
      const isInsideDropdown = dropdownRef.current?.contains(target);
      if (!isInsideContainer && !isInsideDropdown) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const updateDropdownPosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const dropdownWidth = 320;
    const gap = 4;

    setDropdownStyle({
      position: 'fixed',
      left: Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8)),
      top: rect.bottom + gap,
      zIndex: 99999,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(updateDropdownPosition);
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [isOpen, updateDropdownPosition]);

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen) {
      loadTabs();
      updateDropdownPosition();
    }
    setIsOpen(prev => !prev);
  };

  const toggleTab = (tabId: number) => {
    if (blockedTabIds.has(tabId)) return;

    const isAutoTab = autoContextEnabled && autoContextTabIds.includes(tabId);

    if (isAutoTab) {
      // Toggle exclusion for auto-included tabs
      if (excludedAutoTabIds.includes(tabId)) {
        onExcludedAutoTabIdsChange?.(excludedAutoTabIds.filter(id => id !== tabId));
      } else {
        onExcludedAutoTabIdsChange?.([...excludedAutoTabIds, tabId]);
      }
    } else {
      // Manual tab selection
      if (selectedTabIds.includes(tabId)) {
        onSelectionChange(selectedTabIds.filter(id => id !== tabId));
      } else {
        onSelectionChange([...selectedTabIds, tabId]);
      }
    }
  };

  const removeTab = (tabId: number, isAuto: boolean) => {
    if (isAuto) {
      onExcludedAutoTabIdsChange?.([...excludedAutoTabIds, tabId]);
    } else {
      onSelectionChange(selectedTabIds.filter(id => id !== tabId));
    }
  };

  const truncateTitle = (title: string, maxLen = 20) =>
    title.length > maxLen ? title.slice(0, maxLen) + '...' : title;

  // Determine which tabs to show as pills
  const autoTabsForPills = autoContextEnabled ? tabs.filter(t => effectiveAutoTabIds.includes(t.id)) : [];
  const manualTabsForPills = tabs.filter(t => selectedTabIds.includes(t.id) && !autoContextTabIds.includes(t.id));

  const dropdownContent = isOpen && (
    <div
      ref={dropdownRef}
      className={`w-80 max-h-64 overflow-y-auto rounded-lg border shadow-lg ${
        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'
      }`}
      style={dropdownStyle}>
      {/* Auto-context toggle at top */}
      {onAutoContextToggle && (
        <button
          type="button"
          onClick={async e => {
            e.stopPropagation();
            await onAutoContextToggle(!autoContextEnabled);
          }}
          className={`w-full flex items-center justify-between px-3 py-2 border-b text-xs ${
            isDarkMode ? 'border-slate-700 hover:bg-slate-700/50' : 'border-gray-200 hover:bg-gray-50'
          }`}>
          <div className="flex items-center gap-1.5">
            <FaBolt
              className={`w-3 h-3 ${autoContextEnabled ? 'text-purple-500' : isDarkMode ? 'text-slate-400' : 'text-gray-400'}`}
            />
            <span className={`font-medium ${isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}>Auto Tab Context</span>
          </div>
          <span className={`toggle-slider-sm ${autoContextEnabled ? 'toggle-on' : 'toggle-off'}`}>
            <span className="toggle-knob-sm" />
          </span>
        </button>
      )}
      {/* Info when auto mode enabled */}
      {autoContextEnabled && (
        <div
          className={`px-3 py-1.5 text-[10px] ${isDarkMode ? 'bg-purple-900/20 text-purple-300' : 'bg-purple-50 text-purple-600'}`}>
          {effectiveAutoTabIds.length} of {autoContextTabIds.length} tabs included • Click to exclude
        </div>
      )}
      {tabs.length === 0 ? (
        <div className={`p-3 text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>No tabs available</div>
      ) : (
        tabs.map(tab => {
          const isAutoTab = autoContextEnabled && autoContextTabIds.includes(tab.id);
          const isExcluded = excludedAutoTabIds.includes(tab.id);
          const isManualSelected = selectedTabIds.includes(tab.id);
          const isEffectivelySelected = isAutoTab ? !isExcluded : isManualSelected;
          const isCurrent = tab.id === currentTabId;
          const isBlocked = blockedTabIds.has(tab.id);

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => toggleTab(tab.id)}
              disabled={isBlocked}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                isBlocked
                  ? 'cursor-not-allowed opacity-50'
                  : isEffectivelySelected
                    ? isDarkMode
                      ? isAutoTab
                        ? 'bg-purple-900/40'
                        : 'bg-violet-900/40'
                      : isAutoTab
                        ? 'bg-purple-50'
                        : 'bg-violet-50'
                    : isDarkMode
                      ? 'hover:bg-slate-700'
                      : 'hover:bg-gray-50'
              }`}>
              {/* Auto indicator */}
              {isAutoTab && !isBlocked && (
                <FaBolt className={`w-2.5 h-2.5 flex-shrink-0 ${isExcluded ? 'text-slate-400' : 'text-purple-500'}`} />
              )}
              {tab.favIconUrl ? (
                <img
                  src={tab.favIconUrl}
                  alt=""
                  className={`w-4 h-4 flex-shrink-0 rounded-sm ${isBlocked || isExcluded ? 'grayscale opacity-50' : ''}`}
                />
              ) : (
                <div className={`w-4 h-4 flex-shrink-0 rounded-sm ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'}`} />
              )}
              <span
                className={`flex-1 truncate ${
                  isBlocked || isExcluded
                    ? isDarkMode
                      ? 'text-slate-500 line-through'
                      : 'text-gray-400 line-through'
                    : isDarkMode
                      ? 'text-slate-200'
                      : 'text-gray-800'
                }`}>
                {tab.title}
              </span>
              {isBlocked ? (
                <span className="flex-shrink-0 flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-medium bg-red-100 text-red-700">
                  <FaBan className="w-2 h-2" />
                  Blocked
                </span>
              ) : isExcluded ? (
                <span
                  className={`flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${isDarkMode ? 'bg-slate-600 text-slate-300' : 'bg-gray-200 text-gray-500'}`}>
                  Excluded
                </span>
              ) : isCurrent ? (
                <span
                  className={`flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${isDarkMode ? 'bg-green-700 text-green-100' : 'bg-green-100 text-green-700'}`}>
                  Current
                </span>
              ) : null}
              {isEffectivelySelected && !isBlocked && (
                <FaCheck className={`w-3 h-3 flex-shrink-0 ${isAutoTab ? 'text-purple-500' : 'text-violet-500'}`} />
              )}
            </button>
          );
        })
      )}
    </div>
  );

  // Button text based on mode
  const buttonLabel = autoContextEnabled ? `Auto context: ${effectiveAutoTabIds.length} tabs` : 'Tabs';
  const ButtonIcon = autoContextEnabled ? FaBolt : FaPlus;

  // Total count for badge
  const totalSelectedCount = autoContextEnabled
    ? effectiveAutoTabIds.length + manualTabsForPills.length
    : selectedTabIds.length;

  return (
    <div ref={containerRef} className="relative">
      {isOpen && createPortal(dropdownContent, document.body)}

      {compact ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          title={autoContextEnabled ? `Auto context: ${effectiveAutoTabIds.length} tabs` : 'Add tab context'}
          className={`relative inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
            disabled
              ? 'cursor-not-allowed opacity-50'
              : autoContextEnabled
                ? isDarkMode
                  ? 'bg-purple-900/50 text-purple-200 hover:bg-purple-800/60'
                  : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                : isDarkMode
                  ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}>
          <ButtonIcon className="w-3 h-3" />
          {totalSelectedCount > 0 && (
            <span
              className={`ml-0.5 rounded-full px-1 text-[9px] font-bold ${
                autoContextEnabled
                  ? 'bg-purple-500 text-white'
                  : isDarkMode
                    ? 'bg-violet-500 text-white'
                    : 'bg-violet-400 text-white'
              }`}>
              {totalSelectedCount}
            </span>
          )}
          <FaChevronDown className={`w-2 h-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            disabled
              ? 'cursor-not-allowed opacity-50'
              : autoContextEnabled
                ? isDarkMode
                  ? 'bg-purple-900/50 text-purple-200 hover:bg-purple-800/60'
                  : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                : isDarkMode
                  ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}>
          <ButtonIcon className="w-2.5 h-2.5" />
          <span>{buttonLabel}</span>
          {!autoContextEnabled && selectedTabIds.length > 0 && (
            <span
              className={`ml-1 rounded-full px-1.5 text-[10px] ${isDarkMode ? 'bg-violet-500 text-white' : 'bg-violet-400 text-white'}`}>
              {selectedTabIds.length}
            </span>
          )}
          {autoContextEnabled && manualTabsForPills.length > 0 && (
            <span
              className={`ml-1 rounded-full px-1.5 text-[10px] ${isDarkMode ? 'bg-violet-500 text-white' : 'bg-violet-400 text-white'}`}>
              +{manualTabsForPills.length}
            </span>
          )}
          <FaChevronDown className={`w-2 h-2 ml-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}

      {/* Selected Tab Pills - hidden in compact mode */}
      {!compact && (autoTabsForPills.length > 0 || manualTabsForPills.length > 0) && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {/* Auto tabs pills */}
          {autoTabsForPills.map(tab => (
            <div
              key={`auto-${tab.id}`}
              className={`inline-flex items-center gap-1 rounded-full pl-1.5 pr-1 py-0.5 text-[11px] ${
                isDarkMode ? 'bg-purple-900/40 text-purple-200' : 'bg-purple-100 text-purple-700'
              }`}>
              <FaBolt className="w-2.5 h-2.5 text-purple-500" />
              {tab.favIconUrl ? (
                <img src={tab.favIconUrl} alt="" className="w-3 h-3 rounded-sm" />
              ) : (
                <div className={`w-3 h-3 rounded-sm ${isDarkMode ? 'bg-slate-500' : 'bg-gray-300'}`} />
              )}
              <span className="max-w-[80px] truncate">{truncateTitle(tab.title, 15)}</span>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  removeTab(tab.id, true);
                }}
                className={`p-0.5 rounded-full transition-colors ${isDarkMode ? 'hover:bg-purple-700 text-purple-400 hover:text-purple-200' : 'hover:bg-purple-200 text-purple-400 hover:text-purple-600'}`}>
                <FaTimes className="w-2 h-2" />
              </button>
            </div>
          ))}
          {/* Manual tabs pills */}
          {manualTabsForPills.map(tab => (
            <div
              key={`manual-${tab.id}`}
              className={`inline-flex items-center gap-1 rounded-full pl-1.5 pr-1 py-0.5 text-[11px] ${
                isDarkMode ? 'bg-slate-700 text-slate-200' : 'bg-gray-100 text-gray-700'
              }`}>
              {tab.favIconUrl ? (
                <img src={tab.favIconUrl} alt="" className="w-3 h-3 rounded-sm" />
              ) : (
                <div className={`w-3 h-3 rounded-sm ${isDarkMode ? 'bg-slate-500' : 'bg-gray-300'}`} />
              )}
              <span className="max-w-[80px] truncate">{truncateTitle(tab.title, 15)}</span>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  removeTab(tab.id, false);
                }}
                className={`p-0.5 rounded-full transition-colors ${isDarkMode ? 'hover:bg-slate-600 text-slate-400 hover:text-slate-200' : 'hover:bg-gray-200 text-gray-400 hover:text-gray-600'}`}>
                <FaTimes className="w-2 h-2" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
