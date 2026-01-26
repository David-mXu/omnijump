import { DEFAULT_SETTINGS, Shortcut, ShortcutStore } from './types';

export const STORAGE_KEY = 'omnibarShortcuts';

export function normalizeKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function createDefaultStore(): ShortcutStore {
  return {
    shortcuts: {},
    settings: DEFAULT_SETTINGS,
  };
}

export async function getStore(): Promise<ShortcutStore> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const store = (result[STORAGE_KEY] ?? createDefaultStore()) as ShortcutStore;
  return {
    shortcuts: store.shortcuts ?? {},
    settings: store.settings ?? DEFAULT_SETTINGS,
  };
}

export async function setStore(store: ShortcutStore): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: store });
}

export async function upsertShortcut(shortcut: Shortcut): Promise<ShortcutStore> {
  const store = await getStore();
  const key = normalizeKey(shortcut.key);

  if (!key) {
    throw new Error('Shortcut key is empty after normalization.');
  }

  const existingCount = Object.keys(store.shortcuts).length;
  const isNew = !store.shortcuts[key];
  const max = store.settings.maxShortcuts ?? DEFAULT_SETTINGS.maxShortcuts;

  if (isNew && existingCount >= max) {
    throw new Error(`Shortcut limit reached (${max}).`);
  }

  store.shortcuts[key] = {
    ...shortcut,
    key,
  };

  await setStore(store);
  return store;
}

export async function deleteShortcut(key: string): Promise<ShortcutStore> {
  const store = await getStore();
  const normalized = normalizeKey(key);
  delete store.shortcuts[normalized];
  await setStore(store);
  return store;
}
