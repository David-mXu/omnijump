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
    name: 'OmniJump',
    version: '1.1.0',
    description:
      'Instant address-bar shortcuts for redirects, bundles, and dynamic searches.',
    icons: {
      '16': 'images/icon16.png',
      '32': 'images/icon32.png',
      '48': 'images/icon48.png',
      '128': 'images/icon128.png',
    },
    action: {
      default_title: 'OmniJump',
      default_popup: 'src/popup.html',
      default_icon: {
        '16': 'images/icon16.png',
        '32': 'images/icon32.png',
      },
    },
    options_page: 'src/options.html',
    background: isFirefox
      ? ({ scripts: ['src/background.ts'], type: 'module' } as unknown as Manifest['background'])
      : { service_worker: 'src/background.ts', type: 'module' },
    permissions: BASE_PERMISSIONS,
    host_permissions: ['<all_urls>'],
    commands: isFirefox
      ? {
          '_execute_sidebar_action': {
            suggested_key: {
              default: 'Ctrl+Shift+S',
              mac: 'MacCtrl+Shift+S',
            },
            description: 'Open OmniJump side panel',
          },
          '_execute_action': {
            description: 'Open OmniJump popup',
          },
        }
      : {
          'open-side-panel': {
            suggested_key: {
              default: 'Ctrl+Shift+S',
              mac: 'MacCtrl+Shift+S',
            },
            description: 'Open OmniJump side panel',
          },
        },
  };

  if (isFirefox) {
    (manifest as Manifest & {
      browser_specific_settings?: {
        gecko?: { id: string; strict_min_version?: string };
      };
      sidebar_action?: { default_panel: string; default_title: string };
    }).browser_specific_settings = {
      gecko: {
        id: 'omnijump@example.com',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none'],
          optional: [],
        },
      },
    };
    (manifest as Manifest & {
      sidebar_action?: { default_panel: string; default_title: string };
    }).sidebar_action = {
      default_panel: 'src/sidepanel.html',
      default_title: 'OmniJump',
    };
  } else {
    manifest.minimum_chrome_version = '120';
    manifest.permissions = [
      ...(manifest.permissions ?? []),
      'sidePanel' as chrome.runtime.ManifestPermissions,
    ];
    (manifest as Manifest & { side_panel?: { default_path: string } }).side_panel = {
      default_path: 'src/sidepanel.html',
    };
  }

  return manifest;
}
