import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock } from './test/chrome-mock';
import {
  SETTINGS_KEY,
  SHORTCUT_PREFIX,
  DAILY_KEY,
  DISMISSED_KEY,
  SESSION_STORE_META_KEY,
  STORE_MIRROR_VERSION,
  bulkWriteShortcuts,
  clearSessionStore,
  getStore,
  mirrorSessionDelta,
  readSessionStore,
  writeSessionStore,
  upsertShortcut,
  deleteShortcut,
  deleteShortcuts,
  restoreShortcuts,
  touchShortcut,
  renameShortcut,
  clearAllStats,
  cleanupStaleShortcuts,
  saveSettings,
  migrateFromLegacyStorage,
  getDismissedHosts,
  addDismissedHost,
  seedStarterShortcuts,
} from './storage';
import { DEFAULT_SETTINGS, STARTER_SHORTCUTS } from './types';

let syncStore: Record<string, unknown>;
let localStore: Record<string, unknown>;
let sessionStore: Record<string, unknown>;

beforeEach(() => {
  const mock = createChromeMock();
  globalThis.chrome = mock.chrome;
  syncStore = mock.syncStore;
  localStore = mock.localStore;
  sessionStore = mock.sessionStore;
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

  it('sanitizes and normalizes corrupted shortcut.key values and skips empty or non-object records', async () => {
    syncStore[`${SHORTCUT_PREFIX}xss`] = {
      key: '<img src=x onerror=alert(1)>',
      url: 'https://example.com/xss',
      type: 'redirect',
    };
    syncStore[`${SHORTCUT_PREFIX}spaced`] = {
      key: '  My GitHub Repo  ',
      url: 'https://github.com/my-repo',
      type: 'redirect',
    };
    syncStore[`${SHORTCUT_PREFIX}!!!`] = {
      key: '!!!',
      url: 'https://example.com/invalid',
      type: 'redirect',
    };
    syncStore[`${SHORTCUT_PREFIX}nullval`] = null;
    syncStore[`${SHORTCUT_PREFIX}strval`] = 'not-an-object';

    const store = await getStore();
    expect(store.shortcuts['img-srcx-onerroralert1']).toMatchObject({
      key: 'img-srcx-onerroralert1',
      url: 'https://example.com/xss',
    });
    expect(store.shortcuts['my-github-repo']).toMatchObject({
      key: 'my-github-repo',
      url: 'https://github.com/my-repo',
    });
    expect(store.shortcuts['<img src=x onerror=alert(1)>']).toBeUndefined();
    expect(store.shortcuts['!!!']).toBeUndefined();
    expect(store.shortcuts['']).toBeUndefined();
    expect(Object.keys(store.shortcuts)).toHaveLength(2);
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

  it('preserves useCount, createdAt, and lastUsed when updating an existing shortcut', async () => {
    const originalTime = Date.now() - 10_000;
    const lastUsedTime = Date.now() - 2_000;
    syncStore[`${SHORTCUT_PREFIX}gh`] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
      createdAt: originalTime,
      lastUsed: lastUsedTime,
      useCount: 17,
    };
    await upsertShortcut({ key: 'gh', url: 'https://github.com/new', type: 'redirect' });
    const saved = syncStore[`${SHORTCUT_PREFIX}gh`] as {
      createdAt: number;
      lastUsed: number;
      useCount: number;
      url: string;
    };
    expect(saved.createdAt).toBe(originalTime);
    expect(saved.lastUsed).toBe(lastUsedTime);
    expect(saved.useCount).toBe(17);
    expect(saved.url).toBe('https://github.com/new');
  });

  it('translates MAX_WRITE_OPERATIONS_PER_MINUTE and QUOTA_BYTES errors into friendly messages', async () => {
    vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(
      new Error('MAX_WRITE_OPERATIONS_PER_MINUTE exceeded')
    );
    await expect(
      upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' })
    ).rejects.toThrow('Too many changes in a short time. Please wait a moment and try again.');

    vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(
      new Error('QUOTA_BYTES quota exceeded')
    );
    await expect(
      upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' })
    ).rejects.toThrow('Storage quota exceeded. Delete some shortcuts to free up space.');
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

describe('getDismissedHosts', () => {
  it('returns empty Set when nothing stored', async () => {
    expect((await getDismissedHosts()).size).toBe(0);
  });

  it('returns Set of stored hosts from local storage', async () => {
    localStore[DISMISSED_KEY] = { 'github.com': true, 'reddit.com': true };
    const hosts = await getDismissedHosts();
    expect(hosts.has('github.com')).toBe(true);
    expect(hosts.has('reddit.com')).toBe(true);
  });

  it('does not include unrelated keys', async () => {
    localStore[DISMISSED_KEY] = { 'example.com': true };
    syncStore[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
    const hosts = await getDismissedHosts();
    expect(hosts.size).toBe(1);
    expect(hosts.has('example.com')).toBe(true);
  });

  it('migrates legacy sync record to local storage on first access', async () => {
    syncStore[DISMISSED_KEY] = { 'legacy.com': true };
    localStore[DISMISSED_KEY] = { 'new.com': true };
    const hosts = await getDismissedHosts();
    expect(hosts.has('legacy.com')).toBe(true);
    expect(hosts.has('new.com')).toBe(true);
    // Merged into local, removed from sync so browsing-derived hosts no
    // longer travel to other devices.
    expect(syncStore[DISMISSED_KEY]).toBeUndefined();
    const stored = localStore[DISMISSED_KEY] as Record<string, true>;
    expect(stored['legacy.com']).toBe(true);
    expect(stored['new.com']).toBe(true);
  });
});

describe('addDismissedHost', () => {
  it('writes host under DISMISSED_KEY in local storage', async () => {
    await addDismissedHost('github.com');
    expect((localStore[DISMISSED_KEY] as Record<string, true>)['github.com']).toBe(true);
    expect(syncStore[DISMISSED_KEY]).toBeUndefined();
  });

  it('appends without overwriting existing hosts', async () => {
    localStore[DISMISSED_KEY] = { 'reddit.com': true };
    await addDismissedHost('github.com');
    const stored = localStore[DISMISSED_KEY] as Record<string, true>;
    expect(stored['reddit.com']).toBe(true);
    expect(stored['github.com']).toBe(true);
  });

  it('is idempotent', async () => {
    await addDismissedHost('github.com');
    await addDismissedHost('github.com');
    expect(Object.keys(localStore[DISMISSED_KEY] as object)).toHaveLength(1);
  });

  it('caps the stored dismissed hosts at 200 entries', async () => {
    const initial: Record<string, true> = {};
    for (let i = 0; i < 200; i++) {
      initial[`host-${i}.com`] = true;
    }
    localStore[DISMISSED_KEY] = initial;

    await addDismissedHost('host-200.com');
    const stored = localStore[DISMISSED_KEY] as Record<string, true>;
    expect(Object.keys(stored)).toHaveLength(200);
    expect(stored['host-0.com']).toBeUndefined();
    expect(stored['host-200.com']).toBe(true);
  });
});

describe('getStore coercion of malformed synced records', () => {
  it('drops garbage timestamps, clamps far-future ones, and fixes field types', async () => {
    const farFuture = Date.now() + 100_000_000_000;
    syncStore[`${SHORTCUT_PREFIX}weird`] = {
      key: 'weird',
      url: 'https://weird.example.com',
      type: 'redirect',
      lastUsed: 'not-a-number',
      createdAt: farFuture,
      useCount: 4.9,
    };
    syncStore[`${SHORTCUT_PREFIX}badbundle`] = {
      key: 'badbundle',
      url: 'https://b.example.com',
      type: 'bundle',
      bundleUrls: 'not-an-array',
      label: 42,
    };
    const store = await getStore();

    const weird = store.shortcuts['weird']!;
    // String timestamps are dropped (not trusted); far-future is clamped to now.
    expect(weird.lastUsed).toBeUndefined();
    expect(weird.createdAt).toBeLessThanOrEqual(Date.now());
    expect(weird.useCount).toBe(4);

    const badbundle = store.shortcuts['badbundle']!;
    expect(badbundle.bundleUrls).toBeUndefined();
    expect(badbundle.label).toBeUndefined();
  });

  it('grace-stamps records whose timestamps were garbage during stale cleanup', async () => {
    syncStore[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, staleAutoDelete: true, staleDays: 30 };
    syncStore[`${SHORTCUT_PREFIX}garbage`] = {
      key: 'garbage',
      url: 'https://g.example.com',
      type: 'redirect',
      lastUsed: 'abc',
    };
    await cleanupStaleShortcuts();
    const rec = syncStore[`${SHORTCUT_PREFIX}garbage`] as { createdAt?: unknown };
    expect(rec).toBeDefined();
    expect(typeof rec.createdAt).toBe('number');
    expect(rec.createdAt as number).toBeLessThanOrEqual(Date.now());
  });
});

describe('sanitize-on-write-boundary (legacy migration / delete-undo)', () => {
  it('skips legacy records with dangerous or invalid URLs during migration', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    syncStore['omnibarShortcuts'] = {
      shortcuts: {
        js: { key: 'js', url: 'javascript:alert(1)' },
        hostless: { key: 'hostless', url: 'https://' },
        ok: { key: 'ok', url: 'https://ok.example.com' },
      },
    };
    await migrateFromLegacyStorage();
    expect(syncStore[`${SHORTCUT_PREFIX}js`]).toBeUndefined();
    expect(syncStore[`${SHORTCUT_PREFIX}hostless`]).toBeUndefined();
    expect(syncStore[`${SHORTCUT_PREFIX}ok`]).toMatchObject({ key: 'ok', url: 'https://ok.example.com' });
    expect(syncStore['omnibarShortcuts']).toBeUndefined();
    warnSpy.mockRestore();
  });

  it('restoreShortcuts re-validates records instead of copying them verbatim', async () => {
    await restoreShortcuts([
      { key: 'bad', url: 'javascript:alert(1)', type: 'redirect' },
      { key: 'longkey' + 'x'.repeat(100), url: 'https://l.example.com', type: 'redirect' },
      { key: 'good', url: 'https://good.example.com', type: 'redirect', useCount: 3, lastUsed: 100 },
    ]);
    expect(syncStore[`${SHORTCUT_PREFIX}bad`]).toBeUndefined();
    expect(syncStore[`${SHORTCUT_PREFIX}${'longkey' + 'x'.repeat(100)}`]).toBeUndefined();
    expect(syncStore[`${SHORTCUT_PREFIX}good`]).toMatchObject({
      url: 'https://good.example.com',
      useCount: 3,
      lastUsed: 100,
    });
  });
});

describe('renameShortcut and deleteShortcuts', () => {
  it('moves key, removes old key, preserves stats, and syncs url = bundleUrls[0] on bundles', async () => {
    const createdAt = Date.now() - 50_000;
    const lastUsed = Date.now() - 10_000;
    syncStore[`${SHORTCUT_PREFIX}old-work`] = {
      key: 'old-work',
      url: 'https://mail.google.com',
      type: 'bundle',
      bundleUrls: ['https://mail.google.com', 'https://calendar.google.com'],
      createdAt,
      lastUsed,
      useCount: 9,
    };

    await renameShortcut('old-work', {
      key: 'new-work',
      url: '',
      type: 'bundle',
      bundleUrls: ['https://linear.app', 'https://slack.com'],
    });

    expect(syncStore[`${SHORTCUT_PREFIX}old-work`]).toBeUndefined();
    expect(syncStore[`${SHORTCUT_PREFIX}new-work`]).toMatchObject({
      key: 'new-work',
      url: 'https://linear.app',
      type: 'bundle',
      bundleUrls: ['https://linear.app', 'https://slack.com'],
      createdAt,
      lastUsed,
      useCount: 9,
    });
  });

  it('updates in place without deleting when newKey normalizes to oldKey', async () => {
    const createdAt = Date.now() - 20_000;
    syncStore[`${SHORTCUT_PREFIX}gh`] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
      createdAt,
      useCount: 4,
    };

    await renameShortcut('gh', {
      key: '  GH  ',
      url: 'https://github.com/trending',
      label: 'GitHub Trending',
      type: 'redirect',
    });

    expect(syncStore[`${SHORTCUT_PREFIX}gh`]).toMatchObject({
      key: 'gh',
      url: 'https://github.com/trending',
      label: 'GitHub Trending',
      createdAt,
      useCount: 4,
    });
  });

  it('refuses to rename onto an existing key', async () => {
    await upsertShortcut({ key: 'a', url: 'https://a.com', type: 'redirect' });
    await upsertShortcut({ key: 'b', url: 'https://b.com', type: 'redirect' });
    await expect(renameShortcut('a', { key: 'b', url: 'https://a.com', type: 'redirect' }))
      .rejects.toThrow('Keyword "b" already exists.');
    const store = await getStore();
    expect(store.shortcuts.b.url).toBe('https://b.com');
    expect(store.shortcuts.a).toBeDefined();
  });

  it('deleteShortcuts removes many keys in one call', async () => {
    await upsertShortcut({ key: 'a', url: 'https://a.com', type: 'redirect' });
    await upsertShortcut({ key: 'b', url: 'https://b.com', type: 'redirect' });
    await deleteShortcuts(['a', 'b']);
    expect(Object.keys((await getStore()).shortcuts)).toHaveLength(0);
  });
});

describe('touchShortcut', () => {
  const DAY = 86_400_000;

  it('increments useCount, updates lastUsed, increments today in omnibar_daily, and prunes entries older than 7 days', async () => {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const oldDate = new Date(now - 10 * DAY).toISOString().slice(0, 10);
    const recentDate = new Date(now - 2 * DAY).toISOString().slice(0, 10);

    syncStore[`${SHORTCUT_PREFIX}gh`] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
      useCount: 2,
    };
    localStore[DAILY_KEY] = {
      [oldDate]: 5,
      [recentDate]: 3,
      [today]: 1,
    };

    const before = Date.now();
    await touchShortcut('gh');

    const saved = syncStore[`${SHORTCUT_PREFIX}gh`] as { useCount: number; lastUsed: number };
    expect(saved.useCount).toBe(3);
    expect(saved.lastUsed).toBeGreaterThanOrEqual(before);

    const daily = localStore[DAILY_KEY] as Record<string, number>;
    expect(daily[today]).toBe(2);
    expect(daily[recentDate]).toBe(3);
    expect(daily[oldDate]).toBeUndefined();
  });

  it('does NOT increment omnibar_daily when the shortcut key does not exist in sync storage', async () => {
    await touchShortcut('nonexistent');
    expect(localStore[DAILY_KEY]).toBeUndefined();
  });

  it('serializes concurrent touchShortcut calls without lost updates', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
      useCount: 0,
    };

    await Promise.all([touchShortcut('gh'), touchShortcut('gh'), touchShortcut('gh')]);

    const saved = syncStore[`${SHORTCUT_PREFIX}gh`] as { useCount: number };
    expect(saved.useCount).toBe(3);

    const today = new Date().toISOString().slice(0, 10);
    const daily = localStore[DAILY_KEY] as Record<string, number>;
    expect(daily[today]).toBe(3);
  });
});

describe('restoreShortcuts and clearAllStats', () => {
  it('restoreShortcuts preserves useCount, lastUsed, and createdAt verbatim', async () => {
    const createdAt = Date.now() - 100_000;
    const lastUsed = Date.now() - 5_000;
    await restoreShortcuts([
      {
        key: '  GH  ',
        url: 'https://github.com',
        type: 'redirect',
        createdAt,
        lastUsed,
        useCount: 42,
      },
    ]);

    expect(syncStore[`${SHORTCUT_PREFIX}gh`]).toEqual({
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
      createdAt,
      lastUsed,
      useCount: 42,
    });
  });

  it('clearAllStats strips useCount and lastUsed from all shortcuts and removes omnibar_daily', async () => {
    const createdAt = Date.now() - 50_000;
    syncStore[`${SHORTCUT_PREFIX}gh`] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
      createdAt,
      lastUsed: Date.now(),
      useCount: 12,
    };
    localStore[DAILY_KEY] = { '2026-11-05': 8 };

    await clearAllStats();

    const gh = syncStore[`${SHORTCUT_PREFIX}gh`] as Record<string, unknown>;
    expect(gh.useCount).toBeUndefined();
    expect(gh.lastUsed).toBeUndefined();
    expect(gh.createdAt).toBe(createdAt);
    expect(localStore[DAILY_KEY]).toBeUndefined();
  });
});

describe('cleanupStaleShortcuts', () => {
  const DAY = 86_400_000;

  it('is a no-op when staleAutoDelete is false', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, staleAutoDelete: false, staleDays: 30 });
    await chrome.storage.sync.set({
      [`${SHORTCUT_PREFIX}old`]: { key: 'old', url: 'https://a.com', type: 'redirect', createdAt: Date.now() - 90 * DAY },
    });
    await cleanupStaleShortcuts();
    const store = await getStore();
    expect(store.shortcuts.old).toBeDefined();
  });

  it('keeps a shortcut with old createdAt if lastUsed is recent', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, staleAutoDelete: true, staleDays: 30 });
    await chrome.storage.sync.set({
      [`${SHORTCUT_PREFIX}active`]: {
        key: 'active',
        url: 'https://a.com',
        type: 'redirect',
        createdAt: Date.now() - 100 * DAY,
        lastUsed: Date.now() - 2 * DAY,
      },
    });
    await cleanupStaleShortcuts();
    const store = await getStore();
    expect(store.shortcuts.active).toBeDefined();
  });

  it('ages never-used shortcuts from createdAt instead of faking lastUsed, and stamps createdAt when missing both', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, staleAutoDelete: true, staleDays: 30 });
    await chrome.storage.sync.set({
      [`${SHORTCUT_PREFIX}old`]: { key: 'old', url: 'https://a.com', type: 'redirect', createdAt: Date.now() - 40 * DAY },
      [`${SHORTCUT_PREFIX}fresh`]: { key: 'fresh', url: 'https://b.com', type: 'redirect', createdAt: Date.now() - 5 * DAY },
      [`${SHORTCUT_PREFIX}legacy`]: { key: 'legacy', url: 'https://c.com', type: 'redirect' },
    });
    await cleanupStaleShortcuts();
    const store = await getStore();
    expect(store.shortcuts.old).toBeUndefined();
    expect(store.shortcuts.fresh.lastUsed).toBeUndefined();
    expect(store.shortcuts.legacy.lastUsed).toBeUndefined();
    expect(typeof store.shortcuts.legacy.createdAt).toBe('number');
  });
});

describe('seedStarterShortcuts', () => {
  it('seeds all starter shortcuts into an empty store', async () => {
    const added = await seedStarterShortcuts();
    expect(added).toBe(STARTER_SHORTCUTS.length);
    const store = await getStore();
    expect(Object.keys(store.shortcuts).length).toBe(STARTER_SHORTCUTS.length);
    expect(store.shortcuts.gh).toBeDefined();
    expect(store.shortcuts.yt).toBeDefined();
    expect(store.shortcuts.chat).toBeDefined();
    expect(store.shortcuts.claude).toBeDefined();
    expect(store.shortcuts.maps).toBeDefined();
  });

  it('does not overwrite existing shortcuts by default', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://custom-github.com', type: 'redirect' });
    const added = await seedStarterShortcuts(false);
    expect(added).toBe(STARTER_SHORTCUTS.length - 1);
    const store = await getStore();
    expect(store.shortcuts.gh.url).toBe('https://custom-github.com');
  });

  it('respects a low maxShortcuts setting', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, maxShortcuts: 5 });
    const added = await seedStarterShortcuts();
    expect(added).toBe(5);
    const store = await getStore();
    expect(Object.keys(store.shortcuts)).toHaveLength(5);
  });
});

describe('session mirror helpers (readSessionStore / writeSessionStore / mirrorSessionDelta)', () => {
  it('returns null when session mirror sentinel is absent or has a wrong version', async () => {
    expect(await readSessionStore()).toBeNull();

    sessionStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    expect(await readSessionStore()).toBeNull();

    sessionStore[SESSION_STORE_META_KEY] = { v: 999 };
    expect(await readSessionStore()).toBeNull();

    sessionStore[SESSION_STORE_META_KEY] = 'not-an-object';
    expect(await readSessionStore()).toBeNull();
  });

  it('writes full snapshots, purges removed keys, and ignores unrelated session state', async () => {
    sessionStore['bundleTriggers'] = { 7: 12345 };
    sessionStore[`${SHORTCUT_PREFIX}stale`] = {
      key: 'stale',
      url: 'https://stale.example.com',
      type: 'redirect',
    };

    await writeSessionStore({
      shortcuts: {
        gh: { key: 'gh', url: 'https://github.com', type: 'redirect' },
      },
      settings: { ...DEFAULT_SETTINGS, smartSuggestions: true },
    });

    expect(sessionStore['bundleTriggers']).toEqual({ 7: 12345 });
    expect(sessionStore[`${SHORTCUT_PREFIX}stale`]).toBeUndefined();
    expect(sessionStore[SESSION_STORE_META_KEY]).toEqual({ v: STORE_MIRROR_VERSION });

    const cached = await readSessionStore();
    expect(cached?.shortcuts.gh?.url).toBe('https://github.com');
    expect(cached?.settings.smartSuggestions).toBe(true);

    await clearSessionStore();
    expect(await readSessionStore()).toBeNull();
    expect(sessionStore['bundleTriggers']).toEqual({ 7: 12345 });
  });

  it('keeps the session mirror coherent across upsert, rename, bulkWrite, deleteShortcuts, restore, settings, and touch', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    expect((await readSessionStore())?.shortcuts.gh?.url).toBe('https://github.com');

    await renameShortcut('gh', { key: 'git', url: 'https://github.com/trending', type: 'redirect' });
    let snap = await readSessionStore();
    expect(snap?.shortcuts.gh).toBeUndefined();
    expect(snap?.shortcuts.git?.url).toBe('https://github.com/trending');

    await bulkWriteShortcuts({
      [`${SHORTCUT_PREFIX}docs`]: { key: 'docs', url: 'https://docs.example.com', type: 'redirect' },
    });
    expect((await readSessionStore())?.shortcuts.docs?.url).toBe('https://docs.example.com');

    await deleteShortcuts(['git', 'docs']);
    snap = await readSessionStore();
    expect(snap?.shortcuts.git).toBeUndefined();
    expect(snap?.shortcuts.docs).toBeUndefined();

    await restoreShortcuts([
      { key: 'gh', url: 'https://github.com', type: 'redirect', useCount: 9, lastUsed: 1234 },
    ]);
    expect((await readSessionStore())?.shortcuts.gh?.useCount).toBe(9);

    await saveSettings({ ...DEFAULT_SETTINGS, darkMode: true });
    expect((await readSessionStore())?.settings.darkMode).toBe(true);

    await touchShortcut('gh');
    expect((await readSessionStore())?.shortcuts.gh?.useCount).toBe(10);
  });

  it('preserves both shortcuts in the session mirror when concurrent upsertShortcut calls race', async () => {
    await upsertShortcut({ key: 'base', url: 'https://base.example.com', type: 'redirect' });

    await Promise.all([
      upsertShortcut({ key: 'first', url: 'https://first.example.com', type: 'redirect' }),
      upsertShortcut({ key: 'second', url: 'https://second.example.com', type: 'redirect' }),
    ]);

    const mirrored = await readSessionStore();
    expect(mirrored?.shortcuts.base?.url).toBe('https://base.example.com');
    expect(mirrored?.shortcuts.first?.url).toBe('https://first.example.com');
    expect(mirrored?.shortcuts.second?.url).toBe('https://second.example.com');
  });

  it('leaves sentinel unset when mirrorSessionDelta runs before initial hydration', async () => {
    await mirrorSessionDelta({
      [`${SHORTCUT_PREFIX}partial`]: {
        newValue: { key: 'partial', url: 'https://partial.example.com', type: 'redirect' },
      },
    });
    // Must not mark partial delta as an authoritative full snapshot
    expect(await readSessionStore()).toBeNull();
  });

  it('degrades gracefully when chrome.storage.session is unavailable or throws quota errors', async () => {
    vi.mocked(chrome.storage.session.set).mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'));
    await expect(
      upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' }),
    ).resolves.toBeDefined();

    // Simulate environment without storage.session
    (chrome.storage as unknown as Record<string, unknown>).session = undefined;
    expect(await readSessionStore()).toBeNull();
    await expect(
      upsertShortcut({ key: 'yt', url: 'https://youtube.com', type: 'redirect' }),
    ).resolves.toBeDefined();
  });
});

describe('audit regressions: settings coercion and write-boundary limits', () => {
  it('coerces malformed synced settings instead of letting them delete shortcuts', async () => {
    const now = Date.now();
    syncStore[SETTINGS_KEY] = {
      staleDays: null,
      maxShortcuts: 'many',
      filterThreshold: -5,
      staleAutoDelete: 'false',
      smartSuggestions: 'false',
      darkMode: 1,
    };
    syncStore[`${SHORTCUT_PREFIX}fresh`] = {
      key: 'fresh', url: 'https://fresh.example', type: 'redirect', createdAt: now,
    };

    const store = await getStore();
    expect(store.settings.staleDays).toBe(DEFAULT_SETTINGS.staleDays);
    expect(store.settings.maxShortcuts).toBe(DEFAULT_SETTINGS.maxShortcuts);
    expect(store.settings.filterThreshold).toBe(1);
    expect(store.settings.staleAutoDelete).toBe(DEFAULT_SETTINGS.staleAutoDelete);
    expect(store.settings.smartSuggestions).toBe(false);
    expect(store.settings.darkMode).toBe(false);

    await cleanupStaleShortcuts();
    expect(syncStore[`${SHORTCUT_PREFIX}fresh`]).toBeDefined();
  });

  it('clamps out-of-range numeric settings on read', async () => {
    syncStore[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, staleDays: -30, maxShortcuts: 9000, filterThreshold: 0 };
    const store = await getStore();
    expect(store.settings.staleDays).toBe(7);
    expect(store.settings.maxShortcuts).toBe(500);
    expect(store.settings.filterThreshold).toBe(1);
  });

  it('rejects over-cap fields at upsert instead of storing records undo/import cannot restore', async () => {
    await expect(
      upsertShortcut({ key: 'longurl', url: `https://example.com/${'a'.repeat(2100)}`, type: 'redirect' }),
    ).rejects.toThrow(/URL is too long/);
    await expect(
      upsertShortcut({ key: 'longlabel', url: 'https://example.com', type: 'redirect', label: 'x'.repeat(257) }),
    ).rejects.toThrow(/Label is too long/);
    await expect(
      upsertShortcut({ key: 'bigbundle', url: 'https://a.example', type: 'bundle', bundleUrls: Array.from({ length: 33 }, (_, i) => `https://e${i}.example`) }),
    ).rejects.toThrow(/at most 32 URLs/);
    await expect(
      upsertShortcut({ key: 'a'.repeat(41), url: 'https://example.com', type: 'redirect' }),
    ).rejects.toThrow(/Keyword is too long/);
    await expect(
      upsertShortcut({ key: 'p'.repeat(29), url: 'https://example.com', urlTemplate: 'https://example.com/?q=%s', type: 'parameterized' }),
    ).rejects.toThrow(/Keyword is too long/);
  });

  it('rejects a bundle whose per-item serialization exceeds the sync item budget', async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `https://e${i}.example/${'a'.repeat(1900)}`);
    await expect(
      upsertShortcut({ key: 'toobig', url: urls[0]!, type: 'bundle', bundleUrls: urls }),
    ).rejects.toThrow(/too large for Chrome Sync/);
  });

  it('restoreShortcuts skips a keyword re-created during the undo window', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    const original = (await getStore()).shortcuts['gh']!;
    await deleteShortcut('gh');
    await upsertShortcut({ key: 'gh', url: 'https://gitlab.com', type: 'redirect' });

    const result = await restoreShortcuts([original]);
    expect(result).toEqual({ restored: 0, skipped: ['gh'], invalid: [] });
    expect((await getStore()).shortcuts['gh']!.url).toBe('https://gitlab.com');
  });

  it('restores legacy over-cap keys and field sizes instead of dropping the undo batch', async () => {
    const legacyKey = 'l'.repeat(50);
    const urls = Array.from({ length: 33 }, (_, i) => `https://e${i}.example`);
    const legacyRecord = {
      key: legacyKey,
      url: urls[0]!,
      bundleUrls: urls,
      label: 'x'.repeat(300),
      type: 'bundle' as const,
    };
    const result = await restoreShortcuts([legacyRecord]);
    expect(result).toEqual({ restored: 1, skipped: [], invalid: [] });
    const restored = (await getStore()).shortcuts[legacyKey]!;
    expect(restored.bundleUrls).toHaveLength(33);
    expect(restored.label).toHaveLength(300);
  });

  it('restores a context-menu single-label intranet URL on undo', async () => {
    await upsertShortcut({ key: 'router', url: 'http://router/admin', type: 'redirect' });
    const original = (await getStore()).shortcuts['router']!;
    await deleteShortcut('router');
    const result = await restoreShortcuts([original]);
    expect(result).toEqual({ restored: 1, skipped: [], invalid: [] });
    expect((await getStore()).shortcuts['router']!.url).toBe('http://router/admin');
  });

  it('keeps single-label intranet URLs on read instead of blanking them', async () => {
    syncStore[`${SHORTCUT_PREFIX}router`] = {
      key: 'router', url: 'http://router/admin', type: 'redirect',
    };
    syncStore[`${SHORTCUT_PREFIX}wiki`] = {
      key: 'wiki', url: 'http://intranet/wiki/page', type: 'redirect',
    };
    const store = await getStore();
    expect(store.shortcuts['router']!.url).toBe('http://router/admin');
    expect(store.shortcuts['wiki']!.url).toBe('http://intranet/wiki/page');
  });

  it('serializes concurrent creates at the shortcut cap', async () => {
    syncStore[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, maxShortcuts: 1 };
    const results = await Promise.allSettled([
      upsertShortcut({ key: 'racea', url: 'https://a.example', type: 'redirect' }),
      upsertShortcut({ key: 'raceb', url: 'https://b.example', type: 'redirect' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(Object.keys((await getStore()).shortcuts)).toHaveLength(1);
  });

  it('rejects an over-cap key in an import but allows editing an existing legacy key', async () => {
    const legacyKey = 'l'.repeat(50);
    syncStore[`${SHORTCUT_PREFIX}${legacyKey}`] = {
      key: legacyKey, url: 'https://legacy.example', type: 'redirect',
    };
    await expect(
      upsertShortcut({ key: 'n'.repeat(41), url: 'https://new.example', type: 'redirect' }),
    ).rejects.toThrow(/Keyword is too long/);
    // Editing the legacy record in place is allowed so old data is not stranded.
    await expect(
      upsertShortcut({ key: legacyKey, url: 'https://legacy.example/updated', type: 'redirect' }),
    ).resolves.toBeDefined();
  });
});
