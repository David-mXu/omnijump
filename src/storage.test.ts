import { describe, it, expect, beforeEach } from 'vitest';
import { createChromeMock } from './test/chrome-mock';
import {
  SETTINGS_KEY,
  SHORTCUT_PREFIX,
  getStore,
  upsertShortcut,
  deleteShortcut,
  saveSettings,
  migrateFromLegacyStorage,
} from './storage';
import { DEFAULT_SETTINGS } from './types';

let syncStore: Record<string, unknown>;
let localStore: Record<string, unknown>;

beforeEach(() => {
  const mock = createChromeMock();
  globalThis.chrome = mock.chrome;
  syncStore = mock.syncStore;
  localStore = mock.localStore;
});

describe('getStore', () => {
  it('returns defaults when storage is empty', async () => {
    const store = await getStore();
    expect(store.shortcuts).toEqual({});
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('reads shortcuts from omnibar_s_ prefixed keys', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    const store = await getStore();
    expect(store.shortcuts['gh']).toMatchObject({ key: 'gh', url: 'https://github.com' });
  });

  it('reads settings from omnibar_settings key', async () => {
    syncStore[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, maxShortcuts: 100 };
    const store = await getStore();
    expect(store.settings.maxShortcuts).toBe(100);
  });

  it('merges partial settings with defaults', async () => {
    syncStore[SETTINGS_KEY] = { maxShortcuts: 50 };
    const store = await getStore();
    expect(store.settings.maxShortcuts).toBe(50);
    expect(store.settings.staleDays).toBe(DEFAULT_SETTINGS.staleDays);
  });

  it('ignores unrelated storage keys', async () => {
    syncStore['some_other_extension_key'] = { data: 'irrelevant' };
    const store = await getStore();
    expect(Object.keys(store.shortcuts)).toHaveLength(0);
  });
});

describe('upsertShortcut', () => {
  it('writes to the correct omnibar_s_ sync key', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    expect(syncStore[`${SHORTCUT_PREFIX}gh`]).toMatchObject({ key: 'gh', url: 'https://github.com' });
  });

  it('normalizes the key before writing', async () => {
    await upsertShortcut({ key: '  GitHub  ', url: 'https://github.com', type: 'redirect' });
    expect(syncStore[`${SHORTCUT_PREFIX}github`]).toMatchObject({ key: 'github' });
    expect(syncStore[`${SHORTCUT_PREFIX}  GitHub  `]).toBeUndefined();
  });

  it('sets createdAt on a new shortcut', async () => {
    const before = Date.now();
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    const saved = syncStore[`${SHORTCUT_PREFIX}gh`] as { createdAt: number };
    expect(saved.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('preserves createdAt when updating an existing shortcut', async () => {
    const originalTime = Date.now() - 10_000;
    syncStore[`${SHORTCUT_PREFIX}gh`] = {
      key: 'gh', url: 'https://github.com', type: 'redirect', createdAt: originalTime,
    };
    await upsertShortcut({ key: 'gh', url: 'https://github.com/new', type: 'redirect' });
    const saved = syncStore[`${SHORTCUT_PREFIX}gh`] as { createdAt: number; url: string };
    expect(saved.createdAt).toBe(originalTime);
    expect(saved.url).toBe('https://github.com/new');
  });

  it('sets url to bundleUrls[0] for bundle shortcuts', async () => {
    await upsertShortcut({
      key: 'work', url: '', type: 'bundle',
      bundleUrls: ['https://gmail.com', 'https://calendar.google.com'],
    });
    const saved = syncStore[`${SHORTCUT_PREFIX}work`] as { url: string };
    expect(saved.url).toBe('https://gmail.com');
  });

  it('throws when the shortcut limit is reached', async () => {
    syncStore[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, maxShortcuts: 1 };
    syncStore[`${SHORTCUT_PREFIX}existing`] = { key: 'existing', url: 'https://example.com', type: 'redirect' };
    await expect(
      upsertShortcut({ key: 'new', url: 'https://new.com', type: 'redirect' })
    ).rejects.toThrow('Shortcut limit reached (1)');
  });

  it('allows updating an existing shortcut even when at the limit', async () => {
    syncStore[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, maxShortcuts: 1 };
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    await expect(
      upsertShortcut({ key: 'gh', url: 'https://github.com/updated', type: 'redirect' })
    ).resolves.not.toThrow();
  });

  it('throws for a key that normalizes to empty', async () => {
    await expect(
      upsertShortcut({ key: '!!!', url: 'https://example.com', type: 'redirect' })
    ).rejects.toThrow('empty after normalization');
  });
});

describe('deleteShortcut', () => {
  it('removes the correct sync key', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    await deleteShortcut('gh');
    expect(syncStore[`${SHORTCUT_PREFIX}gh`]).toBeUndefined();
  });

  it('normalizes the key before removing', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    await deleteShortcut('  GH  ');
    expect(syncStore[`${SHORTCUT_PREFIX}gh`]).toBeUndefined();
  });

  it('returns the updated store without the deleted shortcut', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    syncStore[`${SHORTCUT_PREFIX}yt`] = { key: 'yt', url: 'https://youtube.com', type: 'redirect' };
    const store = await deleteShortcut('gh');
    expect(store.shortcuts['gh']).toBeUndefined();
    expect(store.shortcuts['yt']).toBeDefined();
  });
});

describe('saveSettings', () => {
  it('writes the settings object to the omnibar_settings key', async () => {
    const settings = { ...DEFAULT_SETTINGS, maxShortcuts: 42 };
    await saveSettings(settings);
    expect(syncStore[SETTINGS_KEY]).toEqual(settings);
  });
});

describe('migrateFromLegacyStorage', () => {
  it('migrates shortcuts from the old sync single-key format', async () => {
    syncStore['omnibarShortcuts'] = {
      shortcuts: { gh: { key: 'gh', url: 'https://github.com', type: 'redirect' } },
    };
    await migrateFromLegacyStorage();
    expect(syncStore[`${SHORTCUT_PREFIX}gh`]).toMatchObject({ key: 'gh' });
    expect(syncStore['omnibarShortcuts']).toBeUndefined();
  });

  it('migrates from the old local key when sync has no legacy data', async () => {
    localStore['omnibarShortcuts'] = {
      shortcuts: { yt: { key: 'yt', url: 'https://youtube.com', type: 'redirect' } },
    };
    await migrateFromLegacyStorage();
    expect(syncStore[`${SHORTCUT_PREFIX}yt`]).toMatchObject({ key: 'yt' });
    expect(localStore['omnibarShortcuts']).toBeUndefined();
  });

  it('does nothing when no legacy data exists', async () => {
    await migrateFromLegacyStorage();
    const shortcutKeys = Object.keys(syncStore).filter(k => k.startsWith(SHORTCUT_PREFIX));
    expect(shortcutKeys).toHaveLength(0);
  });
});
