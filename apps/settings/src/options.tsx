import { useState, useEffect } from 'react';
import '@src/options.css';
import { Button } from '@extension/ui';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { FIRST_RUN_DISCLAIMER_MESSAGE } from '@extension/shared';
import { ApiKeysSettings } from './components/api-keys-settings';
import { AgentSettings } from './components/agent-settings';
import { WebSettings } from './components/web-settings';
import { Help } from './components/help';
import { Warnings } from './components/warnings';
import { PricingDataSettings } from './components/pricing-data-settings';
import { WarpSurfLauncher } from './components/warpsurf-launcher';
import { warningsSettingsStore } from '@extension/storage';

type TabTypes = 'warpsurf' | 'api-keys' | 'workflow-settings' | 'web-settings' | 'pricing-data' | 'warnings' | 'help';

const TABS: { id: TabTypes; icon: string; label: string; isLogo?: boolean }[] = [
  { id: 'warpsurf', icon: '', label: 'warpsurf', isLogo: true },
  { id: 'api-keys', icon: '🔑', label: 'API Keys' },
  { id: 'workflow-settings', icon: '🤖', label: 'Workflow Settings' },
  { id: 'web-settings', icon: '🌐', label: 'Web Settings' },
  { id: 'pricing-data', icon: '💰', label: 'Pricing & Model Data' },
  { id: 'warnings', icon: '⚠️', label: 'Warnings' },
  { id: 'help', icon: '📚', label: 'Help & Information' },
];

const Options = () => {
  const [activeTab, setActiveTab] = useState<TabTypes>(() => {
    try {
      const v = localStorage.getItem('settings.activeTab') as TabTypes | null;
      return (v && (TABS as any).some((t: any) => t.id === v)) ? v : 'warpsurf';
    } catch { return 'warpsurf'; }
  });
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [firstRunAccepted, setFirstRunAccepted] = useState<boolean | null>(null);

  // Check for pending tab navigation from panel (on mount and on storage change)
  useEffect(() => {
    const checkPendingTab = () => {
      chrome.storage.local.get('settings.pendingTab').then(result => {
        const pending = result['settings.pendingTab'] as TabTypes | undefined;
        if (pending && TABS.some(t => t.id === pending)) {
          setActiveTab(pending);
          chrome.storage.local.remove('settings.pendingTab');
        }
      }).catch(() => {});
    };
    checkPendingTab();
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes['settings.pendingTab']?.newValue) checkPendingTab();
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Check for dark mode preference
  useEffect(() => {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(darkModeMediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    darkModeMediaQuery.addEventListener('change', handleChange);
    return () => darkModeMediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Load first-run acceptance to gate the entire settings UI
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try { const w = await warningsSettingsStore.getWarnings(); if (mounted) setFirstRunAccepted(!!w.hasAcceptedFirstRun); } catch {}
    };
    load();
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = warningsSettingsStore.subscribe(load); } catch {}
    return () => { mounted = false; try { unsubscribe && unsubscribe(); } catch {} };
  }, []);

  const handleTabClick = (tabId: TabTypes) => {
    setActiveTab(tabId);
    try { localStorage.setItem('settings.activeTab', tabId); } catch {}
  };

  const renderTabContent = () => {
    const map: Record<TabTypes, JSX.Element> = {
      'warpsurf': <WarpSurfLauncher isDarkMode={isDarkMode} />,
      'api-keys': <ApiKeysSettings isDarkMode={isDarkMode} />,
      'workflow-settings': <AgentSettings isDarkMode={isDarkMode} />,
      'web-settings': <WebSettings isDarkMode={isDarkMode} />,
      'pricing-data': <PricingDataSettings isDarkMode={isDarkMode} />,
      'warnings': <Warnings isDarkMode={isDarkMode} />,
      'help': <Help isDarkMode={isDarkMode} />,
    };
    return map[activeTab] || null;
  };

  if (firstRunAccepted === false) {
    return (
      <div className={`flex min-h-screen min-w-[768px] items-center justify-center ${isDarkMode ? 'bg-slate-900 text-gray-200' : 'bg-white text-gray-900'}`}>
        <div className={`max-w-lg rounded-lg border p-6 shadow text-center ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'}`}>
          <img src="/warpsurflogo_tagline.png" alt="warpsurf Logo" className="mx-auto mb-3 h-16 w-auto" />
          <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{FIRST_RUN_DISCLAIMER_MESSAGE}</p>
          <button
            type="button"
            onClick={async () => { try { await warningsSettingsStore.updateWarnings({ hasAcceptedFirstRun: true }); } catch {}; setFirstRunAccepted(true); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${isDarkMode ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
          >Accept</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-screen min-w-[768px] ${isDarkMode ? 'bg-slate-900' : 'bg-gradient-to-br from-white via-sky-50 to-sky-100'} ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
      {/* Vertical Navigation Bar */}
      <nav
        className={`w-48 border-r ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-white/20 bg-[#0EA5E9]/10'} backdrop-blur-sm`}>
        <div className="p-4">
          <h1 className={`mb-6 text-xl font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Settings</h1>
          <ul className="space-y-2">
            {TABS.map(item => (
              <li key={item.id}>
                <Button
                  onClick={() => handleTabClick(item.id)}
                  className={`flex w-full items-center space-x-2 rounded-lg px-4 py-2 text-left text-base 
                    ${
                      activeTab !== item.id
                        ? `${isDarkMode ? 'bg-slate-700/70 text-gray-300 hover:text-white' : 'bg-[#0EA5E9]/15 font-medium text-gray-700 hover:text-white'} backdrop-blur-sm`
                        : `${isDarkMode ? 'bg-sky-800/50' : ''} text-white backdrop-blur-sm`
                    }`}>
                  {item.isLogo ? (
                    <img src="/warpsurf_logo.png" alt="warpsurf" className="h-5 w-5" />
                  ) : (
                    <span>{item.icon}</span>
                  )}
                  <span>{item.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className={`flex-1 ${isDarkMode ? 'bg-slate-800/50' : 'bg-white/10'} p-8 backdrop-blur-sm`}>
        <div className="mx-auto min-w-[512px] max-w-screen-lg">{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
