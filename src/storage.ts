import {
  DEFAULT_SETTINGS,
  MAX_BUNDLE_URLS,
  MAX_KEY_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_URL_LENGTH,
  STARTER_SHORTCUTS,
  Shortcut,
  ShortcutStore,
  UserSettings,
} from './types';
import { normalizeUrl, deriveSearchFallbackUrl } from './url';

export const SETTINGS_KEY = 'omnibar_settings';
export const SHORTCUT_PREFIX = 'omnibar_s_';
export const DAILY_KEY = 'omnibar_daily';
export const DISMISSED_KEY = 'omnibar_dismissed';
export const SESSION_STORE_META_KEY = 'omnibar_store_meta';
export const STORE_MIRROR_VERSION = 1 as const;

export interface SessionStoreMeta {
  v: typeof STORE_MIRROR_VERSION;
}

export interface StorageChangeLike {
  oldValue?: unknown;
  newValue?: unknown;
}

// Dismissed suggestion hosts are browsing-derived data, so they live in
// storage.local instead of storage.sync — they should not travel to every
// device through the user's sync account. Records stored under the previous
// location (sync) are migrated on first access.
async function loadDismissedMap(): Promise<Record<string, true>> {
  const [localRes, syncRes] = await Promise.all([
    chrome.storage.local.get(DISMISSED_KEY),
    chrome.storage.sync.get(DISMISSED_KEY),
  ]);
  const fromLocal = (localRes[DISMISSED_KEY] ?? {}) as Record<string, true>;
  const fromSync = (syncRes[DISMISSED_KEY] ?? {}) as Record<string, true>;
  if (Object.keys(fromSync).length > 0) {
    const merged = { ...fromSync, ...fromLocal };
    await Promise.all([
      chrome.storage.local.set({ [DISMISSED_KEY]: merged }),
      chrome.storage.sync.remove(DISMISSED_KEY),
    ]);
    return merged;
  }
  return fromLocal;
}

export async function getDismissedHosts(): Promise<Set<string>> {
  return new Set(Object.keys(await loadDismissedMap()));
}

export async function addDismissedHost(host: string): Promise<void> {
  if (typeof host !== 'string' || !host.trim()) return;
  const existing = await loadDismissedMap();
  const next = [...Object.keys(existing).filter((h) => h !== host), host];
  const capped = Object.fromEntries(next.slice(-200).map((h) => [h, true as const]));
  await chrome.storage.local.set({ [DISMISSED_KEY]: capped });
}

export function normalizeKey(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

const VALID_TYPES: ReadonlySet<string> = new Set(['redirect', 'bundle', 'parameterized']);

function clampTimestamp(value: unknown, now: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, now)
    : undefined;
}

// Records can arrive via cross-device sync, older extension versions, or
// hand-edited storage, bypassing import validation. Coerce (never drop) them
// so downstream consumers only ever see well-typed fields: garbage timestamps
// become undefined (the stale-cleanup grace-stamp path then self-heals them)
// and far-future timestamps are clamped to now.
function coerceStoredShortcut(raw: Shortcut, key: string, now: number): Shortcut {
  const s: Shortcut = { ...raw, key };
  if (typeof s.url !== 'string') s.url = '';
  if (!VALID_TYPES.has(s.type)) s.type = 'redirect';
  if (s.label !== undefined && (typeof s.label !== 'string' || !s.label.trim())) {
    delete s.label;
  }
  if (s.urlTemplate !== undefined && typeof s.urlTemplate !== 'string') {
    delete s.urlTemplate;
  }
  if (s.bundleUrls !== undefined) {
    if (Array.isArray(s.bundleUrls)) {
      const urls = s.bundleUrls.filter((u): u is string => typeof u === 'string');
      if (urls.length > 0) {
        s.bundleUrls = urls;
      } else {
        delete s.bundleUrls;
      }
    } else {
      delete s.bundleUrls;
    }
  }
  const createdAt = clampTimestamp(s.createdAt, now);
  if (createdAt === undefined) {
    delete s.createdAt;
  } else {
    s.createdAt = createdAt;
  }
  const lastUsed = clampTimestamp(s.lastUsed, now);
  if (lastUsed === undefined) {
    delete s.lastUsed;
  } else {
    s.lastUsed = lastUsed;
  }
  if (typeof s.useCount === 'number' && Number.isFinite(s.useCount) && s.useCount >= 0) {
    s.useCount = Math.floor(s.useCount);
  } else {
    delete s.useCount;
  }
  return s;
}

export type SanitizeResult =
  | { ok: true; shortcut: Shortcut }
  | { ok: false; reason: string };

// Strict validation used at every untrusted write boundary (JSON import,
// legacy migration, delete-undo restore). Normalizes URLs, clamps timestamps
// to now (imported far-future records would otherwise evade stale cleanup),
// caps field lengths, and derives the parameterized fallback URL. Interactive
// forms do their own field-by-field validation and call upsertShortcut.
export function sanitizeShortcut(raw: unknown, now: number): SanitizeResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'entry is not an object' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.key !== 'string') {
    return { ok: false, reason: 'missing string key' };
  }
  const key = normalizeKey(r.key);
  if (!key) {
    return { ok: false, reason: 'empty key after normalization' };
  }
  if (key.length > MAX_KEY_LENGTH) {
    return { ok: false, reason: `keyword longer than ${MAX_KEY_LENGTH} characters` };
  }

  const rawType = typeof r.type === 'string' ? r.type : 'redirect';
  if (!VALID_TYPES.has(rawType)) {
    return { ok: false, reason: `unknown type "${rawType}"` };
  }
  const type = rawType as Shortcut['type'];

  let label: string | undefined;
  if (typeof r.label === 'string' && r.label.trim()) {
    label = r.label.trim().slice(0, MAX_LABEL_LENGTH);
  }

  const createdAt = clampTimestamp(r.createdAt, now);
  const lastUsed = clampTimestamp(r.lastUsed, now);
  const useCount =
    typeof r.useCount === 'number' && Number.isFinite(r.useCount) && r.useCount >= 0
      ? Math.floor(r.useCount)
      : undefined;

  if (type === 'bundle') {
    if (!Array.isArray(r.bundleUrls)) {
      return { ok: false, reason: 'missing bundleUrls array' };
    }
    const bundleUrls = r.bundleUrls
      .slice(0, MAX_BUNDLE_URLS)
      .map((u) => (typeof u === 'string' && u.length <= MAX_URL_LENGTH ? normalizeUrl(u) : ''))
      .filter(Boolean);
    if (bundleUrls.length < 2) {
      return { ok: false, reason: 'fewer than 2 valid URLs' };
    }
    return {
      ok: true,
      shortcut: { key, type, url: bundleUrls[0]!, bundleUrls, label, createdAt, lastUsed, useCount },
    };
  }

  if (type === 'parameterized') {
    if (typeof r.urlTemplate !== 'string' || !r.urlTemplate.includes('%s')) {
      return { ok: false, reason: 'missing %s in urlTemplate' };
    }
    if (r.urlTemplate.length > MAX_URL_LENGTH) {
      return { ok: false, reason: 'urlTemplate too long' };
    }
    const urlTemplate = normalizeUrl(r.urlTemplate);
    const rawFallback = typeof r.url === 'string' ? r.url : undefined;
    const url = urlTemplate ? deriveSearchFallbackUrl(urlTemplate, rawFallback) : '';
    if (!urlTemplate || !url) {
      return { ok: false, reason: 'invalid urlTemplate or fallback URL' };
    }
    return {
      ok: true,
      shortcut: { key, type, url, urlTemplate, label, createdAt, lastUsed, useCount },
    };
  }

  if (typeof r.url !== 'string' || r.url.length > MAX_URL_LENGTH) {
    return { ok: false, reason: 'missing or too-long URL' };
  }
  const url = normalizeUrl(r.url);
  if (!url) {
    return { ok: false, reason: 'invalid or empty URL' };
  }
  return { ok: true, shortcut: { key, type, url, label, createdAt, lastUsed, useCount } };
}

export function coerceShortcutRecord(
  raw: unknown,
  fallbackKey: string,
  now = Date.now(),
): Shortcut | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Shortcut;
  const key = normalizeKey(candidate.key || fallbackKey);
  if (!key) return null;
  return coerceStoredShortcut(candidate, key, now);
}

export function parseStoreFromRecords(
  all: Record<string, unknown>,
  now = Date.now(),
): ShortcutStore {
  const shortcuts: Record<string, Shortcut> = {};
  let settings: UserSettings = DEFAULT_SETTINGS;

  for (const [k, v] of Object.entries(all)) {
    if (k === SETTINGS_KEY) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        settings = { ...DEFAULT_SETTINGS, ...(v as UserSettings) };
      }
    } else if (k.startsWith(SHORTCUT_PREFIX)) {
      const coerced = coerceShortcutRecord(v, k.slice(SHORTCUT_PREFIX.length), now);
      if (coerced) {
        shortcuts[coerced.key] = coerced;
      }
    }
  }

  return { shortcuts, settings };
}

function hasSessionStorage(): boolean {
  return Boolean(
    globalThis.chrome?.storage?.session &&
      typeof globalThis.chrome.storage.session.get === 'function' &&
      typeof globalThis.chrome.storage.session.set === 'function' &&
      typeof globalThis.chrome.storage.session.remove === 'function',
  );
}

let sessionMirrorQueue: Promise<void> = Promise.resolve();

function enqueueSessionOp(task: () => Promise<void>): Promise<void> {
  const next = sessionMirrorQueue.then(task, task).catch(() => {});
  sessionMirrorQueue = next;
  return next;
}

// Reads the RAM-backed session mirror when valid, or null on cold browser
// startup / missing sentinel / corrupted metadata so callers fall back to sync.
export async function readSessionStore(): Promise<ShortcutStore | null> {
  if (!hasSessionStorage()) return null;
  try {
    const all = (await chrome.storage.session.get(null)) as Record<string, unknown>;
    const meta = all[SESSION_STORE_META_KEY] as SessionStoreMeta | undefined;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.v !== STORE_MIRROR_VERSION) {
      return null;
    }
    return parseStoreFromRecords(all);
  } catch {
    return null;
  }
}

// Writes a complete authoritative store snapshot to chrome.storage.session,
// purging any deleted/renamed shortcut keys before stamping the sentinel.
export function writeSessionStore(store: ShortcutStore): Promise<void> {
  if (!hasSessionStorage()) return Promise.resolve();
  const desired: Record<string, unknown> = {
    [SETTINGS_KEY]: store.settings,
  };
  for (const [key, shortcut] of Object.entries(store.shortcuts)) {
    if (!Object.prototype.hasOwnProperty.call(store.shortcuts, key)) continue;
    desired[`${SHORTCUT_PREFIX}${key}`] = shortcut;
  }

  return enqueueSessionOp(async () => {
    const prevAll = (await chrome.storage.session.get(null)) as Record<string, unknown>;
    const staleKeys = Object.keys(prevAll).filter(
      (k) => (k.startsWith(SHORTCUT_PREFIX) || k === SETTINGS_KEY) && !(k in desired),
    );
    if (staleKeys.length > 0) {
      await chrome.storage.session.remove(staleKeys);
    }
    await chrome.storage.session.set({
      ...desired,
      [SESSION_STORE_META_KEY]: { v: STORE_MIRROR_VERSION } satisfies SessionStoreMeta,
    });
  });
}

// Applies an idempotent per-key delta to the session mirror. When the mirror
// has not been initialized yet and `hydrateIfMissing` is true, hydrates from a
// fresh post-write `getStore()` read inside the serialized queue so concurrent
// saves can never purge each other's keys via a stale pre-write snapshot.
export function mirrorSessionDelta(
  changes: Record<string, StorageChangeLike>,
  options: { hydrateIfMissing?: boolean } = {},
): Promise<void> {
  if (!hasSessionStorage()) return Promise.resolve();
  const sets: Record<string, unknown> = {};
  const removes: string[] = [];

  for (const [key, change] of Object.entries(changes)) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    if (key !== SETTINGS_KEY && !key.startsWith(SHORTCUT_PREFIX)) continue;
    if (change?.newValue !== undefined) {
      sets[key] = change.newValue;
    } else {
      removes.push(key);
    }
  }

  if (Object.keys(sets).length === 0 && removes.length === 0) {
    return Promise.resolve();
  }

  return enqueueSessionOp(async () => {
    const metaRes = await chrome.storage.session.get(SESSION_STORE_META_KEY);
    const meta = metaRes[SESSION_STORE_META_KEY] as SessionStoreMeta | undefined;
    if (!meta || typeof meta !== 'object' || meta.v !== STORE_MIRROR_VERSION) {
      if (!options.hydrateIfMissing) {
        return;
      }
      const fresh = await getStore();
      const desired: Record<string, unknown> = {
        [SETTINGS_KEY]: fresh.settings,
        [SESSION_STORE_META_KEY]: { v: STORE_MIRROR_VERSION } satisfies SessionStoreMeta,
      };
      for (const [k, s] of Object.entries(fresh.shortcuts)) {
        if (Object.prototype.hasOwnProperty.call(fresh.shortcuts, k)) {
          desired[`${SHORTCUT_PREFIX}${k}`] = s;
        }
      }
      await chrome.storage.session.set(desired);
      return;
    }
    if (removes.length > 0) {
      await chrome.storage.session.remove(removes);
    }
    if (Object.keys(sets).length > 0) {
      await chrome.storage.session.set(sets);
    }
  });
}

// Clears the session mirror sentinel and cached shortcut/settings keys without
// disturbing unrelated session state (bundleTriggers, smart-tip visit counts).
export function clearSessionStore(): Promise<void> {
  if (!hasSessionStorage()) return Promise.resolve();
  return enqueueSessionOp(async () => {
    const prevAll = (await chrome.storage.session.get(null)) as Record<string, unknown>;
    const toRemove = Object.keys(prevAll).filter(
      (k) =>
        k === SESSION_STORE_META_KEY ||
        k === SETTINGS_KEY ||
        k.startsWith(SHORTCUT_PREFIX),
    );
    if (toRemove.length > 0) {
      await chrome.storage.session.remove(toRemove);
    }
  });
}

export async function getStore(): Promise<ShortcutStore> {
  const all = await chrome.storage.sync.get(null);
  return parseStoreFromRecords(all);
}

export async function upsertShortcut(shortcut: Shortcut): Promise<ShortcutStore> {
  const store = await getStore();
  const key = normalizeKey(shortcut.key);

  if (!key) {
    throw new Error('Shortcut key is empty after normalization.');
  }

  const isNew = !Object.prototype.hasOwnProperty.call(store.shortcuts, key);
  const max = store.settings.maxShortcuts ?? DEFAULT_SETTINGS.maxShortcuts;

  if (isNew && Object.keys(store.shortcuts).length >= max) {
    throw new Error(`Shortcut limit reached (${max}).`);
  }

  const existing = isNew ? undefined : store.shortcuts[key];
  let normalized: Shortcut = {
    ...shortcut,
    key,
    useCount: isNew ? shortcut.useCount : (shortcut.useCount ?? existing?.useCount),
    createdAt: isNew ? (shortcut.createdAt ?? Date.now()) : (existing?.createdAt ?? shortcut.createdAt ?? Date.now()),
    lastUsed: isNew ? shortcut.lastUsed : (shortcut.lastUsed ?? existing?.lastUsed),
  };
  if (normalized.type === 'bundle' && normalized.bundleUrls?.length) {
    normalized = { ...normalized, url: normalized.bundleUrls[0] };
  }

  try {
    await chrome.storage.sync.set({ [`${SHORTCUT_PREFIX}${key}`]: normalized });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('MAX_WRITE_OPERATIONS_PER_MINUTE')) {
      throw new Error('Too many changes in a short time. Please wait a moment and try again.');
    }
    if (msg.includes('quota') || msg.includes('QUOTA_BYTES') || msg.toLowerCase().includes('quota')) {
      throw new Error('Storage quota exceeded. Delete some shortcuts to free up space.');
    }
    throw err;
  }

  store.shortcuts[key] = normalized;
  await mirrorSessionDelta(
    { [`${SHORTCUT_PREFIX}${key}`]: { newValue: normalized } },
    { hydrateIfMissing: true },
  );
  return store;
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  await mirrorSessionDelta({ [SETTINGS_KEY]: { newValue: settings } });
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

  // Re-validate legacy records instead of copying them verbatim: only http(s)
  // URLs and well-typed fields are allowed into the new per-key storage.
  const now = Date.now();
  const writes: Record<string, Shortcut> = {};
  let skipped = 0;
  for (const candidate of Object.values(legacyStore.shortcuts)) {
    const result = sanitizeShortcut(candidate, now);
    if (result.ok) {
      writes[`${SHORTCUT_PREFIX}${result.shortcut.key}`] = result.shortcut;
    } else {
      skipped++;
    }
  }
  if (skipped > 0) {
    console.warn(`OmniJump: skipped ${skipped} invalid legacy shortcut(s) during migration.`);
  }

  if (Object.keys(writes).length > 0) {
    await chrome.storage.sync.set(writes);
    await mirrorSessionDelta(
      Object.fromEntries(Object.entries(writes).map(([k, v]) => [k, { newValue: v }])),
    );
  }

  await Promise.all([
    chrome.storage.sync.remove(LEGACY_KEY),
    chrome.storage.local.remove(LEGACY_KEY),
  ]);
}

export async function deleteShortcut(key: string): Promise<ShortcutStore> {
  const normalized = normalizeKey(key);
  if (normalized) {
    const storageKey = `${SHORTCUT_PREFIX}${normalized}`;
    await chrome.storage.sync.remove(storageKey);
    await mirrorSessionDelta({ [storageKey]: { newValue: undefined } });
  }
  return getStore();
}

// Removes many shortcuts in a single storage write so bulk deletes don't
// exhaust chrome.storage.sync's per-minute write quota.
export async function deleteShortcuts(keys: string[]): Promise<void> {
  const storageKeys = keys
    .map((k) => normalizeKey(k))
    .filter(Boolean)
    .map((k) => `${SHORTCUT_PREFIX}${k}`);
  if (storageKeys.length > 0) {
    await chrome.storage.sync.remove(storageKeys);
    await mirrorSessionDelta(
      Object.fromEntries(storageKeys.map((k) => [k, { newValue: undefined }])),
    );
  }
}

// Writes a pre-validated batch of shortcut records in one storage operation
// (used by JSON import to respect chrome.storage.sync per-minute write quotas)
// while keeping the session mirror coherent.
export async function bulkWriteShortcuts(writes: Record<string, Shortcut>): Promise<void> {
  if (Object.keys(writes).length === 0) return;
  await chrome.storage.sync.set(writes);
  await mirrorSessionDelta(
    Object.fromEntries(Object.entries(writes).map(([k, v]) => [k, { newValue: v }])),
  );
}

// Restores deleted shortcuts (keeping stats and timestamps), in one
// batched write. Used by delete-undo; upsertShortcut would reset lastUsed.
// Records pass through sanitizeShortcut so the undo path maintains the same
// "only validated data enters storage" invariant as import and migration;
// for shortcuts deleted by the current version this is a no-op.
export async function restoreShortcuts(shortcuts: Shortcut[]): Promise<void> {
  const now = Date.now();
  const writes: Record<string, Shortcut> = {};
  for (const s of shortcuts) {
    const result = sanitizeShortcut(s, now);
    if (result.ok) writes[`${SHORTCUT_PREFIX}${result.shortcut.key}`] = result.shortcut;
  }
  if (Object.keys(writes).length > 0) {
    await bulkWriteShortcuts(writes);
  }
}

let touchQueue: Promise<void> = Promise.resolve();

export function touchShortcut(key: string): Promise<void> {
  const run = async (): Promise<void> => {
    const normalized = normalizeKey(key);
    if (!normalized) return;
    const storageKey = `${SHORTCUT_PREFIX}${normalized}`;
    const now = Date.now();

    try {
      const [syncResult, localResult] = await Promise.all([
        chrome.storage.sync.get(storageKey),
        chrome.storage.local.get(DAILY_KEY),
      ]);

      const shortcut = syncResult[storageKey] as Shortcut | undefined;
      if (!shortcut) return;

      // Rolling 7-day usage counter
      const today = new Date(now).toISOString().slice(0, 10);
      const cutoff = new Date(now - 7 * 86_400_000).toISOString().slice(0, 10);
      const counts = (localResult[DAILY_KEY] ?? {}) as Record<string, number>;
      counts[today] = (counts[today] ?? 0) + 1;
      for (const k of Object.keys(counts)) {
        if (k < cutoff) delete counts[k];
      }

      const updated: Shortcut = {
        ...shortcut,
        key: normalized,
        lastUsed: now,
        useCount: (shortcut.useCount ?? 0) + 1,
      };
      await Promise.all([
        chrome.storage.sync.set({ [storageKey]: updated }),
        chrome.storage.local.set({ [DAILY_KEY]: counts }),
      ]);
      await mirrorSessionDelta({ [storageKey]: { newValue: updated } });
    } catch {
      // Ignore quota / rate-limit errors during usage tracking
    }
  };

  touchQueue = touchQueue.then(run, run);
  return touchQueue;
}

export async function renameShortcut(originalKey: string, updated: Shortcut): Promise<void> {
  const oldKey = normalizeKey(originalKey);
  const newKey = normalizeKey(updated.key);
  if (!newKey) throw new Error('Keyword cannot be empty.');

  const oldStorageKey = `${SHORTCUT_PREFIX}${oldKey}`;
  const newStorageKey = `${SHORTCUT_PREFIX}${newKey}`;
  const keysToFetch = newKey !== oldKey ? [oldStorageKey, newStorageKey] : [oldStorageKey];
  const existing = await chrome.storage.sync.get(keysToFetch);

  if (newKey !== oldKey && existing[newStorageKey]) {
    throw new Error(`Keyword "${newKey}" already exists.`);
  }

  const oldRecord = existing[oldStorageKey] as Shortcut | undefined;
  let normalized: Shortcut = {
    ...updated,
    key: newKey,
    createdAt: updated.createdAt ?? oldRecord?.createdAt ?? Date.now(),
    lastUsed: updated.lastUsed ?? oldRecord?.lastUsed,
    useCount: updated.useCount ?? oldRecord?.useCount,
  };
  if (normalized.type === 'bundle' && normalized.bundleUrls?.length) {
    normalized = { ...normalized, url: normalized.bundleUrls[0] };
  }

  try {
    await chrome.storage.sync.set({ [newStorageKey]: normalized });
    if (newKey !== oldKey && oldKey) {
      await chrome.storage.sync.remove(oldStorageKey);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('MAX_WRITE_OPERATIONS_PER_MINUTE')) {
      throw new Error('Too many changes in a short time. Please wait a moment and try again.');
    }
    if (msg.includes('quota') || msg.includes('QUOTA_BYTES') || msg.toLowerCase().includes('quota')) {
      throw new Error('Storage quota exceeded. Delete some shortcuts to free up space.');
    }
    throw err;
  }

  const delta: Record<string, StorageChangeLike> = {
    [newStorageKey]: { newValue: normalized },
  };
  if (newKey !== oldKey && oldKey) {
    delta[oldStorageKey] = { newValue: undefined };
  }
  await mirrorSessionDelta(delta);
}

export async function clearAllStats(): Promise<void> {
  const all = await chrome.storage.sync.get(null);
  const writes: Record<string, Shortcut> = {};

  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(SHORTCUT_PREFIX) && v && typeof v === 'object') {
      const shortcut = { ...(v as Shortcut) };
      delete shortcut.useCount;
      delete shortcut.lastUsed;
      writes[k] = shortcut;
    }
  }

  await Promise.all([
    chrome.storage.local.remove(DAILY_KEY),
    Object.keys(writes).length > 0 ? chrome.storage.sync.set(writes) : Promise.resolve(),
  ]);
  if (Object.keys(writes).length > 0) {
    await mirrorSessionDelta(
      Object.fromEntries(Object.entries(writes).map(([k, v]) => [k, { newValue: v }])),
    );
  }
}

export async function cleanupStaleShortcuts(): Promise<void> {
  const store = await getStore();
  if (!store.settings.staleAutoDelete) return;

  const now = Date.now();
  const cutoff = now - store.settings.staleDays * 86_400_000;
  const toGrace: Record<string, Shortcut> = {};
  const toDelete: string[] = [];

  for (const [key, shortcut] of Object.entries(store.shortcuts)) {
    // Never-used shortcuts age from creation so the UI doesn't show a fake
    // "used today". Records with neither timestamp get createdAt stamped now.
    const reference = shortcut.lastUsed ?? shortcut.createdAt;
    if (reference === undefined) {
      const graced = { ...shortcut, createdAt: now };
      toGrace[`${SHORTCUT_PREFIX}${key}`] = graced;
      store.shortcuts[key] = graced;
    } else if (reference < cutoff) {
      toDelete.push(`${SHORTCUT_PREFIX}${key}`);
      delete store.shortcuts[key];
    }
  }

  const ops: Promise<void>[] = [];
  if (toDelete.length > 0) ops.push(chrome.storage.sync.remove(toDelete));
  if (Object.keys(toGrace).length > 0) ops.push(chrome.storage.sync.set(toGrace));
  await Promise.all(ops);
  if (toDelete.length > 0 || Object.keys(toGrace).length > 0) {
    const delta: Record<string, StorageChangeLike> = {};
    for (const k of toDelete) delta[k] = { newValue: undefined };
    for (const [k, v] of Object.entries(toGrace)) delta[k] = { newValue: v };
    await mirrorSessionDelta(delta);
  }
}

export async function seedStarterShortcuts(overwriteExisting = false): Promise<number> {
  const store = await getStore();
  const max = store.settings.maxShortcuts ?? DEFAULT_SETTINGS.maxShortcuts;
  const maxToAdd = Math.max(0, max - Object.keys(store.shortcuts).length);
  const now = Date.now();
  const items: Record<string, Shortcut> = {};
  let addedCount = 0;
  let newCount = 0;

  for (const s of STARTER_SHORTCUTS) {
    const key = normalizeKey(s.key);
    if (!key) continue;
    const exists = Object.prototype.hasOwnProperty.call(store.shortcuts, key);
    if (!overwriteExisting && exists) continue;
    if (!exists && newCount >= maxToAdd) continue;
    const record: Shortcut = {
      ...s,
      key,
      createdAt: now,
      useCount: 0,
    };
    items[`${SHORTCUT_PREFIX}${key}`] = record;
    if (!exists) newCount++;
    addedCount++;
  }

  if (addedCount > 0) {
    await chrome.storage.sync.set(items);
    await mirrorSessionDelta(
      Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }])),
      { hydrateIfMissing: true },
    );
  }
  return addedCount;
}
