import { describe, it, expect } from 'vitest';
import pkg from '../package.json';
import createManifest from './manifest';

describe('createManifest', () => {
  it.each(['chrome', 'firefox'] as const)(
    'sets version from package.json and enforces strict CSP for %s',
    (target) => {
      const manifest = createManifest(target);
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.version).toBe(pkg.version);
      expect(manifest.content_security_policy?.extension_pages).toContain("script-src 'self'");
      expect(manifest.content_security_policy?.extension_pages).toContain("object-src 'none'");
    }
  );

  it('generates Chrome-specific service_worker, sidePanel permission, side_panel, and open-side-panel command', () => {
    const manifest = createManifest('chrome') as chrome.runtime.ManifestV3 & {
      side_panel?: { default_path: string };
      sidebar_action?: unknown;
      browser_specific_settings?: unknown;
    };

    expect(manifest.background).toEqual({
      service_worker: 'src/background.ts',
      type: 'module',
    });
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.side_panel).toEqual({
      default_path: 'src/sidepanel.html',
    });
    expect(manifest.commands?.['open-side-panel']).toMatchObject({
      suggested_key: {
        default: 'Alt+Shift+A',
        mac: 'Alt+Shift+A',
      },
    });
    expect(manifest.commands?.['_execute_sidebar_action']).toBeUndefined();
    expect(manifest.sidebar_action).toBeUndefined();
    expect(manifest.browser_specific_settings).toBeUndefined();
  });

  it('generates Firefox-specific background.scripts, sidebar_action, gecko settings, and _execute_sidebar_action command', () => {
    const manifest = createManifest('firefox') as chrome.runtime.ManifestV3 & {
      side_panel?: unknown;
      sidebar_action?: { default_panel: string; default_title: string };
      browser_specific_settings?: {
        gecko?: {
          id: string;
          strict_min_version?: string;
          data_collection_permissions?: { required: string[]; optional: string[] };
        };
      };
    };

    expect(manifest.background).toEqual({
      scripts: ['src/background.ts'],
      type: 'module',
    });
    expect(manifest.permissions).not.toContain('sidePanel');
    expect(manifest.sidebar_action).toEqual({
      default_panel: 'src/sidepanel.html',
      default_title: 'OmniJump',
    });
    expect(manifest.browser_specific_settings?.gecko).toMatchObject({
      id: 'omnijump@example.com',
      strict_min_version: '140.0',
    });
    expect(manifest.commands?.['_execute_sidebar_action']).toMatchObject({
      suggested_key: {
        default: 'Alt+Shift+A',
        mac: 'Alt+Shift+A',
      },
    });
    expect(manifest.commands?.['open-side-panel']).toBeUndefined();
    expect(manifest.side_panel).toBeUndefined();
  });
});
