/*
 * Web Settings Component
 * This component handles web-related settings, including firewall configuration
 * Extracted from the original FirewallSettings component
 */
import { useState, useEffect, useCallback } from 'react';
import { firewallStore } from '@extension/storage';
import { Button } from '@extension/ui';

interface WebSettingsProps {
  isDarkMode: boolean;
}

export const WebSettings = ({ isDarkMode }: WebSettingsProps) => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [allowList, setAllowList] = useState<string[]>([]);
  const [denyList, setDenyList] = useState<string[]>([]);
  const [newAllowUrl, setNewAllowUrl] = useState('');
  const [newDenyUrl, setNewDenyUrl] = useState('');

  const loadFirewallSettings = useCallback(async () => {
    const settings = await firewallStore.getFirewall();
    setIsEnabled(settings.enabled);
    setAllowList(settings.allowList);
    setDenyList(settings.denyList);
  }, []);

  useEffect(() => {
    loadFirewallSettings();
  }, [loadFirewallSettings]);

  const handleToggleFirewall = async () => {
    await firewallStore.updateFirewall({ enabled: !isEnabled });
    await loadFirewallSettings();
  };

  const handleAddToAllowList = async () => {
    const cleanUrl = newAllowUrl.trim().replace(/^https?:\/\//, '');
    if (!cleanUrl) return;
    await firewallStore.addToAllowList(cleanUrl);
    await loadFirewallSettings();
    setNewAllowUrl('');
  };

  const handleAddToDenyList = async () => {
    const cleanUrl = newDenyUrl.trim().replace(/^https?:\/\//, '');
    if (!cleanUrl) return;
    await firewallStore.addToDenyList(cleanUrl);
    await loadFirewallSettings();
    setNewDenyUrl('');
  };

  const handleRemoveUrl = async (url: string, listType: 'allow' | 'deny') => {
    if (listType === 'allow') {
      await firewallStore.removeFromAllowList(url);
    } else {
      await firewallStore.removeFromDenyList(url);
    }
    await loadFirewallSettings();
  };

  return (
    <section className="space-y-6">
      {/* Firewall Settings */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-2 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          🌐 Web Access Control
        </h2>

        {/* Concise explanation note */}
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Control which sites the warpsurf agents can access. Deny list blocks sites; allow list restricts to listed sites <strong>only</strong> when populated.
        </p>

        <div className="space-y-6">
          <div
            className={`rounded-lg border p-4 ${isDarkMode ? 'border-slate-700 bg-slate-700' : 'border-gray-200 bg-gray-100'}`}>
            <div className="flex items-center justify-between">
              <label
                htmlFor="toggle-firewall"
                className={`text-base font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                🔒 Enable Firewall
              </label>
              <div className="relative inline-block w-12 select-none">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={handleToggleFirewall}
                  className="sr-only"
                  id="toggle-firewall"
                />
                <label
                  htmlFor="toggle-firewall"
                  className={`block h-6 cursor-pointer overflow-hidden rounded-full ${
                    isEnabled ? 'bg-blue-500' : isDarkMode ? 'bg-gray-600' : 'bg-gray-300'
                  }`}>
                  <span className="sr-only">Toggle Firewall</span>
                  <span
                    className={`block size-6 rounded-full bg-white shadow transition-transform ${
                      isEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Allow List Section */}
          <div
            className={`rounded-lg border p-4 ${isDarkMode ? 'border-green-800 bg-slate-700/50' : 'border-green-200 bg-green-50'}`}>
            <h3 className={`mb-3 text-base font-medium ${isDarkMode ? 'text-green-400' : 'text-green-700'}`}>
              ✅ Allow List
            </h3>
            <p className={`mb-3 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              When empty: all non-denied sites allowed. When populated: <strong>only</strong> these sites allowed.
            </p>
            <div className="mb-3 flex space-x-2">
              <input
                id="allow-url-input"
                type="text"
                value={newAllowUrl}
                onChange={e => setNewAllowUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleAddToAllowList();
                  }
                }}
                placeholder="e.g. example.com, localhost"
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                  isDarkMode ? 'border-gray-600 bg-slate-700 text-white' : 'border-gray-300 bg-white text-gray-700'
                }`}
              />
              <Button
                onClick={handleAddToAllowList}
                className={`px-3 py-2 text-sm ${
                  isDarkMode ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-green-500 text-white hover:bg-green-600'
                }`}>
                ➕ Add
              </Button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {allowList.length > 0 ? (
                <ul className="space-y-2">
                  {allowList.map(url => (
                    <li
                      key={url}
                      className={`flex items-center justify-between rounded-md p-2 pr-0 ${
                        isDarkMode ? 'bg-slate-700' : 'bg-white'
                      }`}>
                      <span className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>🌍 {url}</span>
                      <Button
                        onClick={() => handleRemoveUrl(url, 'allow')}
                        className={`rounded-l-none px-2 py-1 text-xs ${
                          isDarkMode
                            ? 'bg-red-600 text-white hover:bg-red-700'
                            : 'bg-red-500 text-white hover:bg-red-600'
                        }`}>
                        🗑️
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`py-2 text-center text-xs italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Empty — all non-denied sites are allowed
                </p>
              )}
            </div>
          </div>

          {/* Deny List Section */}
          <div
            className={`rounded-lg border p-4 ${isDarkMode ? 'border-red-800 bg-slate-700/50' : 'border-red-200 bg-red-50'}`}>
            <h3 className={`mb-3 text-base font-medium ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>
              ❌ Deny List
            </h3>
            <p className={`mb-3 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Blocked sites. Takes priority over the allow list.
            </p>
            <div className="mb-3 flex space-x-2">
              <input
                id="deny-url-input"
                type="text"
                value={newDenyUrl}
                onChange={e => setNewDenyUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleAddToDenyList();
                  }
                }}
                placeholder="e.g. dangerous-site.com"
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                  isDarkMode ? 'border-gray-600 bg-slate-700 text-white' : 'border-gray-300 bg-white text-gray-700'
                }`}
              />
              <Button
                onClick={handleAddToDenyList}
                className={`px-3 py-2 text-sm ${
                  isDarkMode ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-red-500 text-white hover:bg-red-600'
                }`}>
                ➕ Add
              </Button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {denyList.length > 0 ? (
                <ul className="space-y-2">
                  {denyList.map(url => (
                    <li
                      key={url}
                      className={`flex items-center justify-between rounded-md p-2 pr-0 ${
                        isDarkMode ? 'bg-slate-700' : 'bg-white'
                      }`}>
                      <span className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>🚫 {url}</span>
                      <Button
                        onClick={() => handleRemoveUrl(url, 'deny')}
                        className={`rounded-l-none px-2 py-1 text-xs ${
                          isDarkMode ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-red-500 text-white hover:bg-red-600'
                        }`}>
                        🗑️
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`py-2 text-center text-xs italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Empty — no sites explicitly blocked
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Firewall Information */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          📚 How Web Access Control Works
        </h2>
        <ul className={`list-disc space-y-2 pl-5 text-left text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <li>🛡️ The firewall contains a deny list and an allow list.</li>
          <li>🌐 If both lists are empty, all URLs are allowed</li>
          <li>🚫 Deny list takes priority - if a URL matches any deny list entry, it&apos;s blocked</li>
          <li>✅ When allow list is empty, all non-denied URLs are allowed</li>
          <li className="font-bold">⚠️ When allow list is not empty, only matching URLs are allowed</li>
          <li>
            🔗 <strong>Domain matching:</strong> entries match the exact domain <em>and</em> all subdomains.
            For example, <code className={`rounded px-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>wikipedia.org</code> blocks{' '}
            <code className={`rounded px-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>en.wikipedia.org</code>,{' '}
            <code className={`rounded px-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>www.wikipedia.org</code>, etc.
            But <code className={`rounded px-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>en.wikipedia.org</code> only blocks that specific subdomain.
          </li>
          <li>🔍 Wildcards are NOT supported yet</li>
        </ul>
      </div>
    </section>
  );
};
