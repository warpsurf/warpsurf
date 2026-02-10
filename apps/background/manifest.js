import fs from 'node:fs';
import deepmerge from 'deepmerge';

const packageJson = JSON.parse(fs.readFileSync('../../package.json', 'utf8'));

/** @type {chrome.runtime.ManifestV3} */
const manifest = deepmerge(
  {
    manifest_version: 3,
    default_locale: 'en',
    name: '__MSG_extensionName__',
    version: packageJson.version,
    description: '__MSG_extensionDescription__',
    host_permissions: ['<all_urls>'],
    permissions: [
      'storage',
      'scripting',
      'tabs',
      'activeTab',
      'debugger',
      'unlimitedStorage',
      'tabGroups',
      'history',
      'contextMenus',
    ],
    options_page: 'settings/index.html',
    background: {
      service_worker: 'background.iife.js',
      type: 'module',
    },
    action: {
      default_icon: 'warpsurf_logo.png',
    },
    icons: {
      128: 'warpsurf_logo.png',
    },
    web_accessible_resources: [
      {
        resources: ['permission/index.html', 'permission/permission.js'],
        matches: ['<all_urls>'],
      },
    ],
  },
  {
    side_panel: {
      default_path: 'panel/index.html',
    },
    permissions: ['sidePanel'],
  },
);

export default manifest;
