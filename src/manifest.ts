type BrowserTarget = 'chrome' | 'firefox';

type Manifest = chrome.runtime.ManifestV3;

const BASE_PERMISSIONS: Manifest['permissions'] = [
  'storage',
  'tabs',
  'contextMenus',
  'webNavigation',
  'declarativeNetRequest',
  'declarativeNetRequestWithHostAccess',
];

export default function createManifest(target: BrowserTarget): Manifest {
  const isFirefox = target === 'firefox';

  const manifest: Manifest = {
    manifest_version: 3,
    name: 'Omnibar Shortcuts',
    version: '0.1.0',
    description:
      'Instant address-bar shortcuts for redirects, bundles, and dynamic searches.',
    action: {
      default_title: 'Omnibar Shortcuts',
      default_popup: 'src/popup.html',
    },
    options_page: 'src/options.html',
    background: {
      service_worker: 'src/background.ts',
      type: 'module',
    },
    permissions: BASE_PERMISSIONS,
    host_permissions: ['<all_urls>'],
    minimum_chrome_version: '120',
  };

  if (isFirefox) {
    (manifest as Manifest & {
      browser_specific_settings?: {
        gecko?: { id: string; strict_min_version?: string };
      };
    }).browser_specific_settings = {
      gecko: {
        id: 'omnibar-shortcuts@example.com',
        strict_min_version: '128.0',
      },
    };
  }

  return manifest;
}
