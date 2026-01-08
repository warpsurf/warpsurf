import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FaPlus, FaTimes, FaChevronDown, FaCheck, FaSpinner, FaBan } from 'react-icons/fa';

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
}

export default function TabContextSelector({
  selectedTabIds,
  onSelectionChange,
  isDarkMode = false,
  disabled = false,
}: TabContextSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [blockedTabIds, setBlockedTabIds] = useState<Set<number>>(new Set());
  const [extractingTabIds, setExtractingTabIds] = useState<Set<number>>(new Set());
  const [extractedTabIds, setExtractedTabIds] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadTabs = useCallback(async () => {
    try {
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const currentTab = allTabs.find(t => t.active);
      setCurrentTabId(currentTab?.id ?? null);

      const filteredTabs = allTabs
        .filter(t => t.id !== undefined && t.url && !t.url.startsWith('chrome://'))
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

  // Store selectedTabIds in a ref to avoid stale closures in event handlers
  const selectedTabIdsRef = useRef(selectedTabIds);
  selectedTabIdsRef.current = selectedTabIds;

  useEffect(() => {
    loadTabs();

    const handleTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      setCurrentTabId(activeInfo.tabId);
    };

    const handleTabUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl) {
        loadTabs();
      }
    };

    const handleTabRemoved = (tabId: number) => {
      // Use ref to get latest selectedTabIds to avoid stale closure
      const current = selectedTabIdsRef.current;
      if (current.includes(tabId)) {
        onSelectionChange(current.filter(id => id !== tabId));
      }
      loadTabs();
    };

    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    chrome.tabs.onRemoved.addListener(handleTabRemoved);

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
      chrome.tabs.onRemoved.removeListener(handleTabRemoved);
    };
  }, [loadTabs, onSelectionChange]);

  // Close dropdown when clicking outside (check both container and portal dropdown)
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
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        left: rect.left,
        bottom: window.innerHeight - rect.top + 4,
        zIndex: 99999,
      });
    }
  }, []);

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen) {
      loadTabs();
      updateDropdownPosition();
    }
    setIsOpen(prev => !prev);
  };

  const toggleTab = (tabId: number) => {
    // Don't allow selecting blocked tabs
    if (blockedTabIds.has(tabId)) return;

    if (selectedTabIds.includes(tabId)) {
      onSelectionChange(selectedTabIds.filter(id => id !== tabId));
      setExtractedTabIds(prev => {
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
    } else {
      const newSelection = [...selectedTabIds, tabId];
      onSelectionChange(newSelection);

      // Show extracting state and trigger extraction
      setExtractingTabIds(prev => new Set(prev).add(tabId));
      try {
        chrome.runtime.sendMessage({ type: 'extract_context_tabs', tabIds: [tabId] }, response => {
          setExtractingTabIds(prev => {
            const next = new Set(prev);
            next.delete(tabId);
            return next;
          });
          if (response?.success && response.tabIds?.includes(tabId)) {
            setExtractedTabIds(prev => new Set(prev).add(tabId));
          }
        });
      } catch {
        setExtractingTabIds(prev => {
          const next = new Set(prev);
          next.delete(tabId);
          return next;
        });
      }
    }
  };

  const removeTab = (tabId: number) => {
    onSelectionChange(selectedTabIds.filter(id => id !== tabId));
  };

  const selectedTabs = tabs.filter(t => selectedTabIds.includes(t.id));

  const truncateTitle = (title: string, maxLen = 20) =>
    title.length > maxLen ? title.slice(0, maxLen) + '...' : title;

  const dropdownContent = isOpen && (
    <div
      ref={dropdownRef}
      className={`w-64 max-h-48 overflow-y-auto rounded-lg border shadow-lg ${
        isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'
      }`}
      style={dropdownStyle}>
      {tabs.length === 0 ? (
        <div className={`p-3 text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>No tabs available</div>
      ) : (
        tabs.map(tab => {
          const isSelected = selectedTabIds.includes(tab.id);
          const isCurrent = tab.id === currentTabId;
          const isBlocked = blockedTabIds.has(tab.id);
          const isExtracting = extractingTabIds.has(tab.id);
          const isExtracted = extractedTabIds.has(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => toggleTab(tab.id)}
              disabled={isBlocked}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                isBlocked
                  ? 'cursor-not-allowed opacity-50'
                  : isSelected
                    ? isDarkMode
                      ? 'bg-violet-900/40'
                      : 'bg-violet-50'
                    : isDarkMode
                      ? 'hover:bg-slate-700'
                      : 'hover:bg-gray-50'
              }`}>
              {tab.favIconUrl ? (
                <img
                  src={tab.favIconUrl}
                  alt=""
                  className={`w-4 h-4 flex-shrink-0 rounded-sm ${isBlocked ? 'grayscale' : ''}`}
                />
              ) : (
                <div className={`w-4 h-4 flex-shrink-0 rounded-sm ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'}`} />
              )}
              <span
                className={`flex-1 truncate ${isBlocked ? (isDarkMode ? 'text-slate-500' : 'text-gray-400') : isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
                {tab.title}
              </span>
              {isBlocked ? (
                <span className="flex-shrink-0 flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-medium bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                  <FaBan className="w-2 h-2" />
                  Blocked
                </span>
              ) : isCurrent ? (
                <span
                  className={`flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${
                    isDarkMode ? 'bg-green-700 text-green-100' : 'bg-green-100 text-green-700'
                  }`}>
                  Current
                </span>
              ) : null}
              {isExtracting && <FaSpinner className="w-3 h-3 text-violet-500 flex-shrink-0 animate-spin" />}
              {isSelected && !isExtracting && (
                <FaCheck className={`w-3 h-3 flex-shrink-0 ${isExtracted ? 'text-green-500' : 'text-violet-500'}`} />
              )}
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Dropdown rendered via portal to escape overflow clipping */}
      {isOpen && createPortal(dropdownContent, document.body)}

      {/* Add Tab Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          disabled
            ? 'cursor-not-allowed opacity-50'
            : isDarkMode
              ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}>
        <FaPlus className="w-2.5 h-2.5" />
        <span>Add Tab</span>
        {selectedTabIds.length > 0 && (
          <span
            className={`ml-1 rounded-full px-1.5 text-[10px] ${
              isDarkMode ? 'bg-violet-500 text-white' : 'bg-violet-400 text-white'
            }`}>
            {selectedTabIds.length}
          </span>
        )}
        <FaChevronDown className={`w-2 h-2 ml-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Selected Tab Pills */}
      {selectedTabs.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selectedTabs.map(tab => {
            const isExtracting = extractingTabIds.has(tab.id);
            const isExtracted = extractedTabIds.has(tab.id);
            return (
              <div
                key={tab.id}
                className={`inline-flex items-center gap-1 rounded-full pl-1.5 pr-1 py-0.5 text-[11px] ${
                  isExtracted
                    ? isDarkMode
                      ? 'bg-green-900/40 text-green-200'
                      : 'bg-green-100 text-green-700'
                    : isDarkMode
                      ? 'bg-slate-700 text-slate-200'
                      : 'bg-gray-100 text-gray-700'
                }`}>
                {isExtracting ? (
                  <FaSpinner className="w-3 h-3 animate-spin text-violet-500" />
                ) : tab.favIconUrl ? (
                  <img src={tab.favIconUrl} alt="" className="w-3 h-3 rounded-sm" />
                ) : (
                  <div className={`w-3 h-3 rounded-sm ${isDarkMode ? 'bg-slate-500' : 'bg-gray-300'}`} />
                )}
                <span className="max-w-[80px] truncate">{truncateTitle(tab.title, 15)}</span>
                {isExtracted && <FaCheck className="w-2 h-2 text-green-500" />}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    removeTab(tab.id);
                  }}
                  className={`p-0.5 rounded-full transition-colors ${
                    isDarkMode
                      ? 'hover:bg-slate-600 text-slate-400 hover:text-slate-200'
                      : 'hover:bg-gray-200 text-gray-400 hover:text-gray-600'
                  }`}>
                  <FaTimes className="w-2 h-2" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
