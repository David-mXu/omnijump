import { isSearchEngineUrl, rebuildDynamicRules } from './dnr';
import { fuzzyFilter } from './fuzzy';
import { IS_FIREFOX, openSidePanel } from './platform';
import { SETTINGS_KEY, SHORTCUT_PREFIX, addDismissedHost, cleanupStaleShortcuts, getDismissedHosts, getStore, migrateFromLegacyStorage, normalizeKey, seedStarterShortcuts, touchShortcut, upsertShortcut } from './storage';
import { suggestKeyFromUrl, uniqueKey } from './suggest';
import { DEFAULT_SETTINGS, Shortcut, ShortcutStore, Suggestion } from './types';
import { startDevReload } from './dev-reload';

if (import.meta.env.VITE_DEV_RELOAD === '1') startDevReload();

const IS_EDGE = /\bEdg\//i.test(globalThis.navigator?.userAgent ?? '');

let cachedStore: ShortcutStore | null = null;
let storeLoadPromise: Promise<ShortcutStore> | null = null;

function invalidateStoreCache(): void {
  cachedStore = null;
  storeLoadPromise = null;
}

async function getFastStore(): Promise<ShortcutStore> {
  if (cachedStore) return cachedStore;
  if (!storeLoadPromise) {
    const p = getStore()
      .then((store) => {
        if (storeLoadPromise === p) {
          cachedStore = store;
        }
        return store;
      })
      .finally(() => {
        if (storeLoadPromise === p) {
          storeLoadPromise = null;
        }
      });
    storeLoadPromise = p;
  }
  return storeLoadPromise;
}

async function syncRules(): Promise<void> {
  try {
    await rebuildDynamicRules();
  } catch (error) {
    console.error('Failed to rebuild DNR rules', error);
  }
}

const TIP_THRESHOLD = 3;

const SEARCH_ENGINE_BLOCKLIST = new Set([
  'bing.com', 'duckduckgo.com', 'yahoo.com', 'baidu.com',
  'yandex.com', 'yandex.ru', 'startpage.com', 'ecosia.org',
  'ask.com', 'brave.com', 'kagi.com', 'perplexity.ai',
]);

function isBlocklisted(host: string): boolean {
  if (/(?:^|\.)google\.[a-z]+(?:\.[a-z]+)?$/.test(host)) return true;
  if (SEARCH_ENGINE_BLOCKLIST.has(host)) return true;
  for (const domain of SEARCH_ENGINE_BLOCKLIST) {
    if (host.endsWith('.' + domain)) return true;
  }
  // Loopback / local-dev hosts: visit counting is keyed by hostname (no port),
  // and the suggested shortcut URL is rebuilt as `${protocol}//${host}/`, so a
  // suggestion for "localhost" would drop the port and produce a dead
  // http://localhost/ shortcut. Never suggest them. WHATWG URL normalizes
  // forms like 127.1 to 127.0.0.1, and IPv6 hostnames keep their brackets.
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host === '[::1]') return true;
  return false;
}

const SITE_NAMES: Record<string, string> = {
  amazon: 'Amazon', youtube: 'YouTube', github: 'GitHub',
  reddit: 'Reddit', twitter: 'Twitter', x: 'X',
  google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo',
  stackoverflow: 'Stack Overflow', wikipedia: 'Wikipedia',
  ebay: 'eBay', etsy: 'Etsy', netflix: 'Netflix',
};

function formatSiteName(host: string): string {
  const base = host.split('.')[0];
  return SITE_NAMES[base] ?? (base.charAt(0).toUpperCase() + base.slice(1));
}

function buildSuggestedKey(host: string, store: ShortcutStore): string {
  const existing = new Set(Object.keys(store.shortcuts));
  const base = suggestKeyFromUrl(`https://${host}/`) ?? host.slice(0, 2);
  return uniqueKey(base, existing);
}

// In-memory guard checked synchronously so two near-simultaneous events in
// the same worker instance can't both pass the async session-storage check.
const recentBundleTriggers = new Map<number, number>();
const recentJsRedirects = new Map<number, { url: string; time: number }>();

async function shouldHandleBundle(tabId: number): Promise<boolean> {
  const now = Date.now();
  if (now - (recentBundleTriggers.get(tabId) ?? 0) < 1500) return false;
  recentBundleTriggers.set(tabId, now);
  const result = await chrome.storage.session.get('bundleTriggers');
  const triggers = (result.bundleTriggers ?? {}) as Record<number, number>;
  if (now - (triggers[tabId] ?? 0) < 1500) return false;
  triggers[tabId] = now;
  await chrome.storage.session.set({ bundleTriggers: triggers });
  return true;
}

function extractQuery(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('q');
  } catch {
    return null;
  }
}

function parseSearchQuery(url: string): { key: string; args: string; hasArgs: boolean } | null {
  const query = extractQuery(url);
  if (!query) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const rawToken = parts[0].toLowerCase();
  const normalized = normalizeKey(rawToken);
  if (!normalized || rawToken !== normalized) return null;
  return {
    key: normalized,
    args: parts.slice(1).join(' '),
    hasArgs: parts.length > 1,
  };
}

async function handleBundleNavigation(url: string, tabId: number): Promise<void> {
  const parsed = parseSearchQuery(url);
  if (!parsed || parsed.hasArgs) {
    return;
  }

  const store = await getFastStore();
  const shortcut = store.shortcuts[parsed.key];

  if (!shortcut || shortcut.type !== 'bundle' || !shortcut.bundleUrls?.length) {
    return;
  }

  if (!await shouldHandleBundle(tabId)) {
    return;
  }

  const [, ...extraUrls] = shortcut.bundleUrls;
  await Promise.all(
    extraUrls.filter(isHttpUrl).map((target) =>
      chrome.tabs.create({
        url: target,
        openerTabId: tabId,
        active: false,
      })
    )
  );
}

let tipQueue: Promise<void> = Promise.resolve();

function enqueueTipTask(task: () => Promise<void>): Promise<void> {
  const next = tipQueue.then(task, task);
  tipQueue = next.catch(() => {});
  return next;
}

async function finalizeTabSession(
  session: { host: string }
): Promise<void> {
  const r = await chrome.storage.session.get('searchVisitCounts');
  const counts = (r.searchVisitCounts ?? {}) as Record<string, number>;
  counts[session.host] = (counts[session.host] ?? 0) + 1;
  await chrome.storage.session.set({ searchVisitCounts: counts });
}

async function clearTipState(
  tabId: number,
  sessions: Record<number, { host: string } | null>
): Promise<void> {
  sessions[tabId] = null;
  await Promise.all([
    chrome.storage.session.set({ tabActiveSessions: sessions }),
    chrome.storage.session.remove(`suggestion_${tabId}`),
  ]);
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch {
    // Tab was closed before badge could be cleared
  }
}

function handleSmartTip(url: string, tabId: number): Promise<void> {
  return enqueueTipTask(async () => {
    let host: string | null = null;
    let siteUrl: string | null = null;

    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        host = parsed.hostname.replace(/^www\./, '');
        siteUrl = `${parsed.protocol}//${host}/`;
      }
    } catch { /* ignore non-URL */ }

    const sessRes = await chrome.storage.session.get(['tabActiveSessions', 'searchVisitCounts']);
    const sessions = (sessRes.tabActiveSessions ?? {}) as Record<number, { host: string } | null>;
    const prev = sessions[tabId] ?? null;

    // Check the toggle before ANY counting: when smart suggestions are off,
    // no visit data is collected at all (the option is off-by-default, so
    // "off" must mean "not tracked", not merely "not shown").
    const store = await getFastStore();
    if (!store.settings.smartSuggestions) {
      await clearTipState(tabId, sessions);
      return;
    }

    if (prev && prev.host !== host) {
      await finalizeTabSession(prev);
    }

    if (!host || !siteUrl) {
      await clearTipState(tabId, sessions);
      return;
    }

    if (isBlocklisted(host)) {
      await clearTipState(tabId, sessions);
      return;
    }

    const hostOf = (u: string): string | null => {
      try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
    };
    const alreadyCovered = Object.values(store.shortcuts).some((s) =>
      [s.url, ...(s.bundleUrls ?? [])].some((u) => hostOf(u) === host)
    );
    if (alreadyCovered) {
      await clearTipState(tabId, sessions);
      return;
    }

    const dismissed = await getDismissedHosts();
    if (dismissed.has(host)) {
      await clearTipState(tabId, sessions);
      return;
    }

    if (!prev || prev.host !== host) {
      sessions[tabId] = { host };
      await chrome.storage.session.set({ tabActiveSessions: sessions });
    }

    const latestCountsRes = await chrome.storage.session.get('searchVisitCounts');
    const counts = (latestCountsRes.searchVisitCounts ?? {}) as Record<string, number>;
    const total = (counts[host] ?? 0) + 1;

    if (total >= TIP_THRESHOLD) {
      const siteName = formatSiteName(host);
      const key = buildSuggestedKey(host, store);
      const suggestion: Suggestion = { key, url: siteUrl, siteName, host };
      await chrome.storage.session.set({ [`suggestion_${tabId}`]: suggestion });
      try {
        await chrome.action.setBadgeBackgroundColor({ color: '#4c6ef5' });
        await chrome.action.setBadgeText({ tabId, text: 'TIP' });
      } catch {
        // Tab was closed before badge could be set
      }
    } else {
      await chrome.storage.session.remove(`suggestion_${tabId}`);
      try {
        await chrome.action.setBadgeText({ tabId, text: '' });
      } catch {
        // Tab was closed before badge could be cleared
      }
    }
  });
}

chrome.runtime.onStartup.addListener(async () => {
  await migrateFromLegacyStorage();
  await cleanupStaleShortcuts();
  invalidateStoreCache();
  void getFastStore();
  syncRules();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await seedStarterShortcuts();
    chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding.html') });
  }

  await migrateFromLegacyStorage();
  await cleanupStaleShortcuts();
  invalidateStoreCache();
  void getFastStore();
  syncRules();

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'omnijump-save-page',
      title: 'Save Page as Shortcut',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'omnijump-save-link',
      title: 'Save Link as Shortcut',
      contexts: ['link'],
    });
  });
});

let syncRulesTimer: ReturnType<typeof setTimeout> | null = null;
const boundChrome = globalThis.chrome;

function scheduleSyncRules(): void {
  if (syncRulesTimer !== null) clearTimeout(syncRulesTimer);
  syncRulesTimer = setTimeout(() => {
    syncRulesTimer = null;
    if (globalThis.chrome === boundChrome) {
      syncRules();
    }
  }, 50);
}

function didShortcutRuleChange(
  oldVal: Shortcut | undefined,
  newVal: Shortcut | undefined
): boolean {
  if (!oldVal || !newVal) return true;
  if (
    oldVal.key !== newVal.key ||
    oldVal.type !== newVal.type ||
    oldVal.url !== newVal.url ||
    oldVal.urlTemplate !== newVal.urlTemplate
  ) {
    return true;
  }
  const oldBundle = oldVal.bundleUrls ?? [];
  const newBundle = newVal.bundleUrls ?? [];
  if (oldBundle.length !== newBundle.length) return true;
  return oldBundle.some((u, i) => u !== newBundle[i]);
}

function applyChangesToCachedStore(
  changes: Record<string, chrome.storage.StorageChange>
): void {
  if (!cachedStore) {
    storeLoadPromise = null;
    return;
  }

  for (const [key, change] of Object.entries(changes)) {
    if (key.startsWith(SHORTCUT_PREFIX)) {
      const storageSuffix = normalizeKey(key.slice(SHORTCUT_PREFIX.length));
      const oldShortcut = change.oldValue as Shortcut | undefined;
      const oldKey = oldShortcut?.key ? normalizeKey(oldShortcut.key) : storageSuffix;
      if (oldKey) {
        delete cachedStore.shortcuts[oldKey];
      }
      if (storageSuffix) {
        delete cachedStore.shortcuts[storageSuffix];
      }

      if (change.newValue && typeof change.newValue === 'object') {
        const raw = change.newValue as Shortcut;
        const normKey = normalizeKey(raw.key || key.slice(SHORTCUT_PREFIX.length));
        if (normKey) {
          cachedStore.shortcuts[normKey] = { ...raw, key: normKey };
        }
      }
    } else if (key === SETTINGS_KEY) {
      const nextSettings = (change.newValue ?? {}) as Partial<ShortcutStore['settings']>;
      cachedStore.settings = { ...DEFAULT_SETTINGS, ...nextSettings };
    }
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  applyChangesToCachedStore(changes);

  let shouldRebuild = false;
  for (const [key, change] of Object.entries(changes)) {
    if (key.startsWith(SHORTCUT_PREFIX)) {
      if (
        didShortcutRuleChange(
          change.oldValue as Shortcut | undefined,
          change.newValue as Shortcut | undefined
        )
      ) {
        shouldRebuild = true;
        break;
      }
    }
  }

  if (shouldRebuild) {
    scheduleSyncRules();
  }

  if (SETTINGS_KEY in changes) {
    const oldSettings = changes[SETTINGS_KEY].oldValue as ShortcutStore['settings'] | undefined;
    const newSettings = changes[SETTINGS_KEY].newValue as ShortcutStore['settings'] | undefined;
    if (
      oldSettings?.staleAutoDelete !== newSettings?.staleAutoDelete ||
      oldSettings?.staleDays !== newSettings?.staleDays
    ) {
      void cleanupStaleShortcuts();
    }
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'omnijump-save-link' ? info.linkUrl : tab?.url;
  if (!url || !isHttpUrl(url)) {
    return;
  }

  try {
    const store = await getFastStore();
    const existingKeys = new Set<string>(Object.keys(store.shortcuts));
    const base = suggestKeyFromUrl(url);
    const key = uniqueKey(base || 'shortcut', existingKeys);

    await upsertShortcut({
      key,
      url,
      type: 'redirect',
    });

    if (tab?.id !== undefined) {
      await chrome.action.setBadgeBackgroundColor({ color: '#27ae60' });
      await chrome.action.setBadgeText({ tabId: tab.id, text: '✓' });
      setTimeout(() => {
        chrome.action.setBadgeText({ tabId: tab!.id!, text: '' }).catch(() => {});
      }, 2500);
    }
  } catch (error) {
    console.warn('OmniJump: failed to save shortcut from context menu.', error);
  }
});

// The side panel holds a long-lived port while open; its disconnect (user
// closes the panel, or the worker restarts) is how we know it's gone.
let panelPort: chrome.runtime.Port | null = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  port.onDisconnect.addListener(() => {
    if (panelPort === port) panelPort = null;
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-side-panel') return;

  if (panelPort) {
    // Close: no user gesture required for window.close() in the panel.
    panelPort.postMessage({ type: 'close-panel' });
    panelPort = null;
  } else {
    // Open: must happen before any await to keep the user-gesture context alive.
    if (tab?.id !== undefined) {
      openSidePanel(tab.id);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  recentBundleTriggers.delete(tabId);
  recentJsRedirects.delete(tabId);

  void enqueueTipTask(async () => {
    const r = await chrome.storage.session.get(['tabActiveSessions', 'bundleTriggers']);
    const sessions = (r.tabActiveSessions ?? {}) as Record<number, { host: string } | null>;
    const session = sessions[tabId];
    if (session) await finalizeTabSession(session);
    delete sessions[tabId];

    const triggers = (r.bundleTriggers ?? {}) as Record<number, number>;
    delete triggers[tabId];

    await Promise.all([
      chrome.storage.session.set({ tabActiveSessions: sessions, bundleTriggers: triggers }),
      chrome.storage.session.remove(`suggestion_${tabId}`),
    ]);
  });
});

async function handleShortcutTouch(url: string): Promise<void> {
  const parsed = parseSearchQuery(url);
  if (!parsed) return;
  const store = await getFastStore();
  const shortcut = store.shortcuts[parsed.key];
  if (!shortcut) return;
  if (parsed.hasArgs && shortcut.type !== 'parameterized') return;
  await touchShortcut(parsed.key);
}

// Fallback JS redirect for browsers (e.g. Edge) that bypass DNR for
// navigations to the configured search engine. Runs on onBeforeNavigate on
// Edge for instant redirect and on onCommitted universally as a safety net:
// when DNR already redirected, the committed URL is the target (no search
// query), so onCommitted is a no-op and recentJsRedirects prevents double-fires.
async function handleJsRedirect(url: string, tabId: number): Promise<boolean> {
  const parsed = parseSearchQuery(url);
  if (!parsed) return false;

  const store = await getFastStore();
  const shortcut = store.shortcuts[parsed.key];
  if (!shortcut) return false;

  let target: string | null = null;

  if (!parsed.hasArgs) {
    if (shortcut.type === 'redirect') {
      target = shortcut.url;
    } else if (shortcut.type === 'bundle') {
      target = shortcut.bundleUrls?.[0] ?? shortcut.url ?? null;
    }
  }

  if (shortcut.type === 'parameterized' && shortcut.urlTemplate) {
    target = parsed.args
      ? shortcut.urlTemplate.replace(/%s/g, () => encodeURIComponent(parsed.args))
      : shortcut.url;
  }

  if (!target || !isHttpUrl(target)) return false;

  const now = Date.now();
  const prev = recentJsRedirects.get(tabId);
  if (prev && prev.url === target && now - prev.time < 1500) {
    return true;
  }
  recentJsRedirects.set(tabId, { url: target, time: now });

  try {
    await chrome.tabs.update(tabId, { url: target });
    return true;
  } catch {
    // Tab may have been closed before redirect completed
    return false;
  }
}

// ── Omnibox ("oj" keyword) ────────────────────────────────────────────────────
// In-address-bar autocomplete of saved shortcuts. Unlike the DNR redirect
// path, this works with any default search engine.
function escapeXml(s: string): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!
    ));
}

function resolveTarget(shortcut: Shortcut, args: string): string | null {
  if (shortcut.type === 'parameterized' && shortcut.urlTemplate) {
    return args ? shortcut.urlTemplate.replace(/%s/g, () => encodeURIComponent(args)) : shortcut.url;
  }
  if (shortcut.type === 'bundle') {
    return shortcut.bundleUrls?.[0] ?? shortcut.url ?? null;
  }
  return shortcut.url;
}

function isHttpUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:/i.test(url);
}

async function navigateForDisposition(
  url: string,
  disposition: chrome.omnibox.OnInputEnteredDisposition
): Promise<void> {
  if (!isHttpUrl(url)) return;
  if (disposition === 'currentTab') {
    await chrome.tabs.update({ url });
  } else {
    await chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
  }
}

chrome.omnibox.setDefaultSuggestion({
  description: 'OmniJump: type a keyword, then press Enter to jump',
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const store = await getFastStore();
  const parts = text.trim().split(/\s+/);
  const query = parts[0] ?? '';
  const args = parts.slice(1).join(' ');

  const all = Object.values(store.shortcuts);
  const matches = query
    ? fuzzyFilter(query, all)
    : all.sort((a, b) =>
        (b.useCount ?? 0) - (a.useCount ?? 0) || (b.lastUsed ?? 0) - (a.lastUsed ?? 0)
      );

  suggest(matches.slice(0, 8).map((s) => {
    const target = resolveTarget(s, args) ?? s.urlTemplate ?? s.url ?? '';
    // Firefox renders descriptions as plain text; the XML markup is Chrome-only.
    const description = IS_FIREFOX
      ? `${s.key} — ${target}`
      : `<match>${escapeXml(s.key)}</match> <dim>—</dim> <url>${escapeXml(target)}</url>`;
    return { content: args ? `${s.key} ${args}` : s.key, description };
  }));
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const parts = text.trim().split(/\s+/);
  const key = normalizeKey(parts[0] ?? '');
  if (!key) return;

  const store = await getFastStore();
  // Exact key first, else the best fuzzy match for a half-typed keyword.
  const shortcut = store.shortcuts[key] ?? fuzzyFilter(key, Object.values(store.shortcuts))[0];
  if (!shortcut) return;

  const args = parts.slice(1).join(' ');

  if (shortcut.type === 'bundle' && shortcut.bundleUrls?.length) {
    const [first, ...rest] = shortcut.bundleUrls;
    await navigateForDisposition(first, disposition);
    await Promise.all(
      rest.filter(isHttpUrl).map((url) => chrome.tabs.create({ url, active: false }))
    );
  } else {
    const target = resolveTarget(shortcut, args);
    if (target) await navigateForDisposition(target, disposition);
  }

  await touchShortcut(shortcut.key);
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !details.url || details.tabId < 0) {
    return;
  }

  if (isSearchEngineUrl(details.url)) {
    if (IS_EDGE) {
      void handleJsRedirect(details.url, details.tabId);
    }
    void handleBundleNavigation(details.url, details.tabId);
    void handleShortcutTouch(details.url);
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || !details.url || details.tabId < 0) {
    return;
  }

  if (isSearchEngineUrl(details.url)) {
    void handleJsRedirect(details.url, details.tabId);
  }
  void handleSmartTip(details.url, details.tabId);
});
