import { useEffect, useState } from 'react';
import '@src/options.css';
import { withErrorBoundary, withSuspense, FIRST_RUN_DISCLAIMER_MESSAGE } from '@extension/shared';
import { generalSettingsStore, warningsSettingsStore } from '@extension/storage';
import {
  FiChevronDown,
  FiChevronRight,
  FiGlobe,
  FiHelpCircle,
  FiKey,
  FiLayers,
  FiMic,
  FiSettings,
  FiShield,
  FiTool,
} from 'react-icons/fi';
import { ApiKeysSettings } from './components/api-keys-settings';
import { AgentSettings } from './components/agent-settings';
import { BasicWorkflowSettings } from './components/basic-workflow-settings';
import { Help } from './components/help';
import { PricingDataSettings } from './components/pricing-data-settings';
import { VoiceSettings } from './components/voice-settings';
import { WarpSurfLauncher } from './components/warpsurf-launcher';
import { Warnings } from './components/warnings';
import { WebSettings } from './components/web-settings';

type TabTypes =
  | 'warpsurf'
  | 'api-keys'
  | 'workflow-settings'
  | 'web-settings'
  | 'voice'
  | 'help'
  | 'workflow-advanced'
  | 'pricing-data'
  | 'warnings';

type TabDef = { id: TabTypes; label: string; icon: JSX.Element; isLogo?: boolean };

const STANDARD_TABS: TabDef[] = [
  { id: 'warpsurf', label: 'warpsurf', icon: <FiSettings className="h-4 w-4" />, isLogo: true },
  { id: 'api-keys', label: 'API Keys', icon: <FiKey className="h-4 w-4" /> },
  { id: 'workflow-settings', label: 'Workflow', icon: <FiTool className="h-4 w-4" /> },
  { id: 'web-settings', label: 'Web', icon: <FiGlobe className="h-4 w-4" /> },
  { id: 'voice', label: 'Voice', icon: <FiMic className="h-4 w-4" /> },
  { id: 'help', label: 'Help', icon: <FiHelpCircle className="h-4 w-4" /> },
];

const ADVANCED_TABS: TabDef[] = [
  { id: 'workflow-advanced', label: 'Workflow (Advanced)', icon: <FiLayers className="h-4 w-4" /> },
  { id: 'pricing-data', label: 'Pricing & Model Data', icon: <FiSettings className="h-4 w-4" /> },
  { id: 'warnings', label: 'Warnings', icon: <FiShield className="h-4 w-4" /> },
];

const ALL_TABS = [...STANDARD_TABS, ...ADVANCED_TABS];
const isAdvancedTab = (tabId: TabTypes) => ADVANCED_TABS.some(t => t.id === tabId);

const Options = () => {
  const [activeTab, setActiveTab] = useState<TabTypes>(() => {
    try {
      const v = localStorage.getItem('settings.activeTab') as TabTypes | null;
      return v && ALL_TABS.some(t => t.id === v) ? v : 'warpsurf';
    } catch {
      return 'warpsurf';
    }
  });
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [firstRunAccepted, setFirstRunAccepted] = useState<boolean | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (isAdvancedTab(activeTab)) setShowAdvanced(true);
  }, [activeTab]);

  useEffect(() => {
    const checkPendingTab = () => {
      chrome.storage.local
        .get('settings.pendingTab')
        .then(result => {
          const pending = result['settings.pendingTab'] as TabTypes | undefined;
          if (pending && ALL_TABS.some(t => t.id === pending)) {
            setActiveTab(pending);
            chrome.storage.local.remove('settings.pendingTab');
          }
        })
        .catch(() => {});
    };
    checkPendingTab();
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes['settings.pendingTab']?.newValue) checkPendingTab();
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    const getSystemPreference = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
    const checkDarkMode = async () => {
      try {
        const settings = await generalSettingsStore.getSettings();
        const themeMode = settings.themeMode || 'auto';
        setIsDarkMode(themeMode === 'dark' ? true : themeMode === 'light' ? false : getSystemPreference());
      } catch {
        setIsDarkMode(getSystemPreference());
      }
    };
    checkDarkMode();
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = generalSettingsStore.subscribe(checkDarkMode);
    } catch {}
    return () => {
      mediaQuery.removeEventListener('change', checkDarkMode);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const w = await warningsSettingsStore.getWarnings();
        if (mounted) setFirstRunAccepted(!!w.hasAcceptedFirstRun);
      } catch {}
    };
    load();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = warningsSettingsStore.subscribe(load);
    } catch {}
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const handleTabClick = (tabId: TabTypes) => {
    if (isAdvancedTab(tabId)) setShowAdvanced(true);
    setActiveTab(tabId);
    try {
      localStorage.setItem('settings.activeTab', tabId);
    } catch {}
  };

  const renderTabContent = () => {
    const map: Record<TabTypes, JSX.Element> = {
      warpsurf: <WarpSurfLauncher isDarkMode={isDarkMode} />,
      'api-keys': <ApiKeysSettings isDarkMode={isDarkMode} />,
      'workflow-settings': <BasicWorkflowSettings isDarkMode={isDarkMode} />,
      'web-settings': <WebSettings isDarkMode={isDarkMode} />,
      voice: <VoiceSettings isDarkMode={isDarkMode} />,
      help: <Help isDarkMode={isDarkMode} />,
      'workflow-advanced': <AgentSettings isDarkMode={isDarkMode} />,
      'pricing-data': <PricingDataSettings isDarkMode={isDarkMode} />,
      warnings: <Warnings isDarkMode={isDarkMode} />,
    };
    return map[activeTab] || null;
  };

  const navButtonClass = (tabId: TabTypes) =>
    `font-sans flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
      activeTab === tabId
        ? isDarkMode
          ? 'bg-[#2a2a26] text-gray-100'
          : 'bg-[#ecebe5] text-gray-900'
        : isDarkMode
          ? 'text-gray-300 hover:bg-[#22221f]'
          : 'text-gray-700 hover:bg-[#efeee8]'
    }`;

  if (firstRunAccepted === false) {
    return (
      <div
        className={`flex min-h-screen min-w-[768px] items-center justify-center ${isDarkMode ? 'bg-slate-900 text-gray-200' : 'bg-white text-gray-900'}`}>
        <div
          className={`max-w-lg rounded-lg border p-6 text-center shadow ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'}`}>
          <img src="/warpsurflogo_tagline.png" alt="warpsurf Logo" className="mx-auto mb-3 h-16 w-auto" />
          <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {FIRST_RUN_DISCLAIMER_MESSAGE}
          </p>
          <button
            type="button"
            onClick={async () => {
              try {
                await warningsSettingsStore.updateWarnings({ hasAcceptedFirstRun: true });
              } catch {}
              setFirstRunAccepted(true);
            }}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">
            Accept
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-screen min-w-[768px] font-sans ${isDarkMode ? 'bg-[#10100f]' : 'bg-[#f6f6f3]'} ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
      <nav
        className={`w-56 border-r ${isDarkMode ? 'border-[#2c2c28] bg-[#171715]' : 'border-[#dddcd5] bg-[#fbfbf8]'}`}>
        <div className="p-4">
          <h1 className={`mb-5 text-lg font-semibold tracking-tight ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
            Settings
          </h1>
          <p className="mb-2 px-2 text-[11px] uppercase tracking-wider text-gray-500">Standard</p>
          <ul className="space-y-1">
            {STANDARD_TABS.map(item => (
              <li key={item.id}>
                <button type="button" onClick={() => handleTabClick(item.id)} className={navButtonClass(item.id)}>
                  {item.isLogo ? <img src="/warpsurf_logo.png" alt="warpsurf" className="h-5 w-5" /> : item.icon}
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className={`my-4 border-t ${isDarkMode ? 'border-[#2c2c28]' : 'border-[#dddcd5]'}`} />
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className={`font-sans flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] uppercase tracking-wider ${
              isDarkMode ? 'text-gray-500 hover:bg-[#22221f]' : 'text-gray-500 hover:bg-[#efeee8]'
            }`}>
            <span>Advanced</span>
            {showAdvanced ? <FiChevronDown className="h-4 w-4" /> : <FiChevronRight className="h-4 w-4" />}
          </button>
          {showAdvanced && (
            <ul className="mt-1 space-y-1">
              {ADVANCED_TABS.map(item => (
                <li key={item.id}>
                  <button type="button" onClick={() => handleTabClick(item.id)} className={navButtonClass(item.id)}>
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>

      <main className={`flex-1 p-8 ${isDarkMode ? 'bg-[#131311]' : 'bg-[#f3f2ee]'}`}>
        <div
          className={`mx-auto min-w-[512px] max-w-screen-lg rounded-xl border p-6 ${
            isDarkMode ? 'border-[#2f2f29] bg-[#171715]' : 'border-[#dddcd5] bg-[#fbfbf8]'
          }`}>
          {renderTabContent()}
        </div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
