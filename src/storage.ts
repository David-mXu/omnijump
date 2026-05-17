import { DEFAULT_SETTINGS, Shortcut, ShortcutStore, UserSettings } from './types';

export const SETTINGS_KEY = 'omnibar_settings';
export const SHORTCUT_PREFIX = 'omnibar_s_';

export function normalizeKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export async function getStore(): Promise<ShortcutStore> {
  const all = await chrome.storage.sync.get(null);
  const shortcuts: Record<string, Shortcut> = {};
  let settings: UserSettings = DEFAULT_SETTINGS;

  for (const [k, v] of Object.entries(all)) {
    if (k === SETTINGS_KEY) {
      settings = { ...DEFAULT_SETTINGS, ...(v as UserSettings) };
    } else if (k.startsWith(SHORTCUT_PREFIX)) {
      const shortcut = v as Shortcut;
      shortcuts[shortcut.key] = shortcut;
    }
  }

  return { shortcuts, settings };
}

export async function upsertShortcut(shortcut: Shortcut): Promise<ShortcutStore> {
  const store = await getStore();
  const key = normalizeKey(shortcut.key);

  if (!key) {
    throw new Error('Shortcut key is empty after normalization.');
  }

  const isNew = !store.shortcuts[key];
  const max = store.settings.maxShortcuts ?? DEFAULT_SETTINGS.maxShortcuts;

  if (isNew && Object.keys(store.shortcuts).length >= max) {
    throw new Error(`Shortcut limit reached (${max}).`);
  }

  const existing = store.shortcuts[key];
  let normalized: Shortcut = {
    ...shortcut,
    key,
    createdAt: isNew ? Date.now() : existing?.createdAt,
    lastUsed: isNew ? undefined : existing?.lastUsed,
  };
  if (normalized.type === 'bundle' && normalized.bundleUrls?.length) {
    normalized = { ...normalized, url: normalized.bundleUrls[0] };
  }

  try {
    await chrome.storage.sync.set({ [`${SHORTCUT_PREFIX}${key}`]: normalized });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('QUOTA_BYTES') || msg.toLowerCase().includes('quota')) {
      throw new Error('Storage quota exceeded. Delete some shortcuts to free up space.');
    }
    throw err;
  }

  store.shortcuts[key] = normalized;
  return store;
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

// One-time migration from the old single-key format (both sync and local) to per-key sync storage.
export async function migrateFromLegacyStorage(): Promise<void> {
  const LEGACY_KEY = 'omnibarShortcuts';

  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get(LEGACY_KEY),
    chrome.storage.local.get(LEGACY_KEY),
  ]);

  const legacyStore =
    (syncResult[LEGACY_KEY] ?? localResult[LEGACY_KEY]) as
    | { shortcuts?: Record<string, Shortcut>; settings?: UserSettings }
    | undefined;

  if (!legacyStore?.shortcuts) return;

  const writes: Record<string, Shortcut> = {};
  for (const shortcut of Object.values(legacyStore.shortcuts)) {
    const key = normalizeKey(shortcut.key);
    if (key) writes[`${SHORTCUT_PREFIX}${key}`] = { ...shortcut, key };
  }

  if (Object.keys(writes).length > 0) {
    await chrome.storage.sync.set(writes);
  }

  await Promise.all([
    chrome.storage.sync.remove(LEGACY_KEY),
    chrome.storage.local.remove(LEGACY_KEY),
  ]);
}

export async function deleteShortcut(key: string): Promise<ShortcutStore> {
  const store = await getStore();
  const normalized = normalizeKey(key);
  await chrome.storage.sync.remove(`${SHORTCUT_PREFIX}${normalized}`);
  delete store.shortcuts[normalized];
  return store;
}

export async function touchShortcut(key: string): Promise<void> {
  const normalized = normalizeKey(key);
  const storageKey = `${SHORTCUT_PREFIX}${normalized}`;
  const result = await chrome.storage.sync.get(storageKey);
  const shortcut = result[storageKey] as Shortcut | undefined;
  if (shortcut) {
    await chrome.storage.sync.set({ [storageKey]: { ...shortcut, lastUsed: Date.now() } });
  }
}

export async function cleanupStaleShortcuts(): Promise<void> {
  const store = await getStore();
  if (!store.settings.staleAutoDelete) return;

  const cutoff = Date.now() - store.settings.staleDays * 86_400_000;
  const toGrace: Record<string, Shortcut> = {};

  for (const [key, shortcut] of Object.entries(store.shortcuts)) {
    if (shortcut.lastUsed === undefined) {
      toGrace[`${SHORTCUT_PREFIX}${key}`] = { ...shortcut, lastUsed: Date.now() };
    } else if (shortcut.lastUsed < cutoff) {
      await deleteShortcut(key);
    }
  }

  if (Object.keys(toGrace).length) {
    await chrome.storage.sync.set(toGrace);
  }
}
