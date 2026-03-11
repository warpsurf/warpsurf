import { useState, useEffect, useCallback } from 'react';
import { firewallStore, generalSettingsStore } from '@extension/storage';
import { FiGlobe, FiShield, FiPlus, FiTrash2, FiSearch } from 'react-icons/fi';
import { useStorageConfirmation, SectionApplyButton } from './primitives';

const SEARCH_ENGINE_OPTIONS = [
  { value: 'google', label: 'Google' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'bing', label: 'Bing' },
  { value: 'ecosia', label: 'Ecosia' },
  { value: 'qwant', label: 'Qwant' },
  { value: 'yahoo', label: 'Yahoo' },
  { value: 'startpage', label: 'Startpage' },
  { value: 'brave', label: 'Brave Search' },
];

const REGION_OPTIONS = [
  { value: '', label: 'Select a region...' },
  { value: 'com', label: 'United States (.com)' },
  { value: 'ca', label: 'Canada (.ca)' },
  { value: 'com.mx', label: 'Mexico (.com.mx)' },
  { value: 'com.br', label: 'Brazil (.com.br)' },
  { value: 'com.ar', label: 'Argentina (.com.ar)' },
  { value: 'com.co', label: 'Colombia (.com.co)' },
  { value: 'co.uk', label: 'United Kingdom (.co.uk)' },
  { value: 'ie', label: 'Ireland (.ie)' },
  { value: 'fr', label: 'France (.fr)' },
  { value: 'de', label: 'Germany (.de)' },
  { value: 'at', label: 'Austria (.at)' },
  { value: 'ch', label: 'Switzerland (.ch)' },
  { value: 'nl', label: 'Netherlands (.nl)' },
  { value: 'be', label: 'Belgium (.be)' },
  { value: 'es', label: 'Spain (.es)' },
  { value: 'pt', label: 'Portugal (.pt)' },
  { value: 'it', label: 'Italy (.it)' },
  { value: 'se', label: 'Sweden (.se)' },
  { value: 'no', label: 'Norway (.no)' },
  { value: 'dk', label: 'Denmark (.dk)' },
  { value: 'fi', label: 'Finland (.fi)' },
  { value: 'pl', label: 'Poland (.pl)' },
  { value: 'cz', label: 'Czech Republic (.cz)' },
  { value: 'com.tr', label: 'Turkey (.com.tr)' },
  { value: 'ae', label: 'United Arab Emirates (.ae)' },
  { value: 'com.sa', label: 'Saudi Arabia (.com.sa)' },
  { value: 'co.il', label: 'Israel (.co.il)' },
  { value: 'co.za', label: 'South Africa (.co.za)' },
  { value: 'cn', label: 'China (.cn)' },
  { value: 'co.jp', label: 'Japan (.co.jp)' },
  { value: 'co.kr', label: 'South Korea (.co.kr)' },
  { value: 'com.tw', label: 'Taiwan (.com.tw)' },
  { value: 'com.hk', label: 'Hong Kong (.com.hk)' },
  { value: 'in', label: 'India (.in)' },
  { value: 'com.sg', label: 'Singapore (.com.sg)' },
  { value: 'co.id', label: 'Indonesia (.co.id)' },
  { value: 'co.th', label: 'Thailand (.co.th)' },
  { value: 'com.my', label: 'Malaysia (.com.my)' },
  { value: 'com.ph', label: 'Philippines (.com.ph)' },
  { value: 'com.vn', label: 'Vietnam (.com.vn)' },
  { value: 'com.au', label: 'Australia (.com.au)' },
  { value: 'co.nz', label: 'New Zealand (.co.nz)' },
];

interface WebSettingsProps {
  isDarkMode: boolean;
}

export const WebSettings = ({ isDarkMode }: WebSettingsProps) => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [allowList, setAllowList] = useState<string[]>([]);
  const [denyList, setDenyList] = useState<string[]>([]);
  const [newAllowUrl, setNewAllowUrl] = useState('');
  const [newDenyUrl, setNewDenyUrl] = useState('');
  const [preferredRegion, setPreferredRegion] = useState<string>('');
  const [defaultSearchEngine, setDefaultSearchEngine] = useState<string>('google');

  // Saved snapshots for dirty detection
  const [savedRegion, setSavedRegion] = useState<string>('');
  const [savedSearchEngine, setSavedSearchEngine] = useState<string>('google');
  const [savedFirewall, setSavedFirewall] = useState({
    enabled: true,
    allowList: [] as string[],
    denyList: [] as string[],
  });

  const regionConfirmation = useStorageConfirmation('general-settings');
  const searchEngineConfirmation = useStorageConfirmation('general-settings');
  const firewallConfirmation = useStorageConfirmation('firewall-settings');

  const regionDirty = preferredRegion !== savedRegion;
  const searchEngineDirty = defaultSearchEngine !== savedSearchEngine;
  const firewallDirty =
    isEnabled !== savedFirewall.enabled ||
    JSON.stringify(allowList) !== JSON.stringify(savedFirewall.allowList) ||
    JSON.stringify(denyList) !== JSON.stringify(savedFirewall.denyList);

  const loadFirewallSettings = useCallback(async () => {
    const settings = await firewallStore.getFirewall();
    setIsEnabled(settings.enabled);
    setAllowList(settings.allowList);
    setDenyList(settings.denyList);
    setSavedFirewall({ enabled: settings.enabled, allowList: settings.allowList, denyList: settings.denyList });
  }, []);

  const loadGeneralSettings = useCallback(async () => {
    const settings = await generalSettingsStore.getSettings();
    const region = settings.preferredRegion || '';
    const engine = settings.defaultSearchEngine || 'google';
    setPreferredRegion(region);
    setDefaultSearchEngine(engine);
    setSavedRegion(region);
    setSavedSearchEngine(engine);
  }, []);

  useEffect(() => {
    loadFirewallSettings();
    loadGeneralSettings();
  }, [loadFirewallSettings, loadGeneralSettings]);

  const applyRegion = async () => {
    regionConfirmation.markPending();
    await generalSettingsStore.updateSettings({ preferredRegion: preferredRegion || undefined });
    setSavedRegion(preferredRegion);
  };

  const applySearchEngine = async () => {
    searchEngineConfirmation.markPending();
    await generalSettingsStore.updateSettings({ defaultSearchEngine: defaultSearchEngine });
    setSavedSearchEngine(defaultSearchEngine);
  };

  const applyFirewall = async () => {
    firewallConfirmation.markPending();
    await firewallStore.updateFirewall({ enabled: isEnabled, allowList, denyList });
    setSavedFirewall({ enabled: isEnabled, allowList: [...allowList], denyList: [...denyList] });
  };

  const handleAddToAllowList = () => {
    const cleanUrl = newAllowUrl
      .trim()
      .replace(/^https?:\/\//, '')
      .toLowerCase();
    if (!cleanUrl || allowList.includes(cleanUrl)) return;
    setAllowList(prev => [...prev, cleanUrl]);
    setDenyList(prev => prev.filter(u => u !== cleanUrl));
    setNewAllowUrl('');
  };

  const handleAddToDenyList = () => {
    const cleanUrl = newDenyUrl
      .trim()
      .replace(/^https?:\/\//, '')
      .toLowerCase();
    if (!cleanUrl || denyList.includes(cleanUrl)) return;
    setDenyList(prev => [...prev, cleanUrl]);
    setAllowList(prev => prev.filter(u => u !== cleanUrl));
    setNewDenyUrl('');
  };

  const handleRemoveUrl = (url: string, listType: 'allow' | 'deny') => {
    if (listType === 'allow') {
      setAllowList(prev => prev.filter(u => u !== url));
    } else {
      setDenyList(prev => prev.filter(u => u !== url));
    }
  };

  const cardClass = `rounded-xl border p-5 text-left ${isDarkMode ? 'border-[#2f2f29] bg-[#1d1d1a]' : 'border-[#dddcd5] bg-[#fbfbf8]'}`;
  const innerCardClass = `rounded-lg border p-4 ${isDarkMode ? 'border-[#3a3a34] bg-[#252522]' : 'border-[#e5e4de] bg-[#f3f2ee]'}`;
  const inputClass = `flex-1 rounded-lg border px-3 py-2 text-sm outline-none ${
    isDarkMode ? 'border-[#3a3a34] bg-[#1d1d1a] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'
  }`;
  const btnClass = `rounded-lg px-3 py-2 text-sm font-medium ${
    isDarkMode ? 'bg-[#2a2a26] text-gray-100 hover:bg-[#33332e]' : 'bg-[#ecebe5] text-gray-800 hover:bg-[#dfddd4]'
  }`;

  return (
    <section className="space-y-5">
      <div className={cardClass}>
        <h2
          className={`mb-2 flex items-center gap-2 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          <FiGlobe className="h-4 w-4" /> Region Preference
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Set your preferred region for websites. The agent will prefer regional versions of sites (e.g., amazon.de
          instead of amazon.com) when available.
        </p>

        <div className={innerCardClass}>
          <div className="flex items-center justify-between">
            <label
              htmlFor="region-select"
              className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Preferred Region
            </label>
            <select
              id="region-select"
              value={preferredRegion}
              onChange={e => setPreferredRegion(e.target.value)}
              className={`w-72 rounded-lg border px-3 py-2 text-sm ${
                isDarkMode ? 'border-[#3a3a34] bg-[#1d1d1a] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'
              }`}>
              {REGION_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {!preferredRegion && (
            <p className={`mt-2 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              No region selected. The agent will use default (.com) versions of websites.
            </p>
          )}
        </div>
        <SectionApplyButton
          isDarkMode={isDarkMode}
          isDirty={regionDirty}
          confirmed={regionConfirmation.confirmed}
          onApply={applyRegion}
        />
      </div>

      <div className={cardClass}>
        <h2
          className={`mb-2 flex items-center gap-2 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          <FiSearch className="h-4 w-4" /> Search Engine Preference
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Choose the default search engine for agent web search actions.
        </p>

        <div className={innerCardClass}>
          <div className="flex items-center justify-between">
            <label
              htmlFor="search-engine-select"
              className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Default Search Engine
            </label>
            <select
              id="search-engine-select"
              value={defaultSearchEngine}
              onChange={e => setDefaultSearchEngine(e.target.value)}
              className={`w-72 rounded-lg border px-3 py-2 text-sm ${
                isDarkMode ? 'border-[#3a3a34] bg-[#1d1d1a] text-gray-200' : 'border-[#dddcd5] bg-white text-gray-700'
              }`}>
              {SEARCH_ENGINE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <SectionApplyButton
          isDarkMode={isDarkMode}
          isDirty={searchEngineDirty}
          confirmed={searchEngineConfirmation.confirmed}
          onApply={applySearchEngine}
        />
      </div>

      <div className={cardClass}>
        <h2
          className={`mb-2 flex items-center gap-2 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          <FiShield className="h-4 w-4" /> Web Access Control
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Control which sites the warpsurf agents can access. Deny list blocks sites; allow list restricts to listed
          sites <strong>only</strong> when populated.
        </p>

        <div className="space-y-4">
          <div className={innerCardClass}>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Enable Firewall
              </span>
              <button
                type="button"
                onClick={() => setIsEnabled(prev => !prev)}
                className={`toggle-slider ${isEnabled ? 'toggle-on' : 'toggle-off'}`}
                aria-pressed={isEnabled}>
                <span className="toggle-knob" />
              </button>
            </div>
          </div>

          <div
            className={`rounded-lg border p-4 ${isDarkMode ? 'border-[#3a4a3a] bg-[#1d251d]' : 'border-[#d5ddd5] bg-[#f5fbf5]'}`}>
            <h3 className={`mb-2 text-sm font-medium ${isDarkMode ? 'text-green-400' : 'text-green-700'}`}>
              Allow List
            </h3>
            <p className={`mb-3 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              When empty: all non-denied sites allowed. When populated: <strong>only</strong> these sites allowed.
            </p>
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={newAllowUrl}
                onChange={e => setNewAllowUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddToAllowList()}
                placeholder="e.g. example.com, localhost"
                className={inputClass}
              />
              <button type="button" onClick={handleAddToAllowList} className={btnClass}>
                <FiPlus className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {allowList.length > 0 ? (
                <ul className="space-y-1">
                  {allowList.map(url => (
                    <li
                      key={url}
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                        isDarkMode ? 'bg-[#252522]' : 'bg-white'
                      }`}>
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>{url}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveUrl(url, 'allow')}
                        className={`p-1 rounded ${isDarkMode ? 'hover:bg-[#33332e]' : 'hover:bg-[#e5e4de]'}`}>
                        <FiTrash2 className={`h-3.5 w-3.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`py-2 text-xs italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Empty — all non-denied sites are allowed
                </p>
              )}
            </div>
          </div>

          <div
            className={`rounded-lg border p-4 ${isDarkMode ? 'border-[#4a3a3a] bg-[#251d1d]' : 'border-[#ddd5d5] bg-[#fbf5f5]'}`}>
            <h3 className={`mb-2 text-sm font-medium ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>Deny List</h3>
            <p className={`mb-3 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Blocked sites. Takes priority over the allow list.
            </p>
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={newDenyUrl}
                onChange={e => setNewDenyUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddToDenyList()}
                placeholder="e.g. dangerous-site.com"
                className={inputClass}
              />
              <button type="button" onClick={handleAddToDenyList} className={btnClass}>
                <FiPlus className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {denyList.length > 0 ? (
                <ul className="space-y-1">
                  {denyList.map(url => (
                    <li
                      key={url}
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                        isDarkMode ? 'bg-[#252522]' : 'bg-white'
                      }`}>
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>{url}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveUrl(url, 'deny')}
                        className={`p-1 rounded ${isDarkMode ? 'hover:bg-[#33332e]' : 'hover:bg-[#e5e4de]'}`}>
                        <FiTrash2 className={`h-3.5 w-3.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`py-2 text-xs italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Empty — no sites explicitly blocked
                </p>
              )}
            </div>
          </div>
        </div>
        <SectionApplyButton
          isDarkMode={isDarkMode}
          isDirty={firewallDirty}
          confirmed={firewallConfirmation.confirmed}
          onApply={applyFirewall}
        />
      </div>

      <div className={cardClass}>
        <h2 className={`mb-4 text-base font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          How Web Access Control Works
        </h2>
        <ul className={`list-disc space-y-2 pl-5 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          <li>The firewall contains a deny list and an allow list.</li>
          <li>If both lists are empty, all URLs are allowed</li>
          <li>Deny list takes priority - if a URL matches any deny list entry, it's blocked</li>
          <li>When allow list is empty, all non-denied URLs are allowed</li>
          <li className="font-medium">When allow list is not empty, only matching URLs are allowed</li>
          <li>
            <strong>Domain matching:</strong> entries match the exact domain <em>and</em> all subdomains. For example,{' '}
            <code className={`rounded px-1 ${isDarkMode ? 'bg-[#252522]' : 'bg-[#e5e4de]'}`}>wikipedia.org</code> blocks{' '}
            <code className={`rounded px-1 ${isDarkMode ? 'bg-[#252522]' : 'bg-[#e5e4de]'}`}>en.wikipedia.org</code>,{' '}
            <code className={`rounded px-1 ${isDarkMode ? 'bg-[#252522]' : 'bg-[#e5e4de]'}`}>www.wikipedia.org</code>,
            etc. But{' '}
            <code className={`rounded px-1 ${isDarkMode ? 'bg-[#252522]' : 'bg-[#e5e4de]'}`}>en.wikipedia.org</code>{' '}
            only blocks that specific subdomain.
          </li>
          <li>Wildcards are NOT supported yet</li>
        </ul>
      </div>
    </section>
  );
};
