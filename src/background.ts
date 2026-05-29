import { rebuildDynamicRules } from './dnr';
import { openSidePanel } from './platform';
import { SETTINGS_KEY, SHORTCUT_PREFIX, addDismissedHost, cleanupStaleShortcuts, getDismissedHosts, getStore, migrateFromLegacyStorage, normalizeKey, touchShortcut, upsertShortcut } from './storage';
import { suggestKeyFromUrl, uniqueKey } from './suggest';
import { ShortcutStore, Suggestion } from './types';

async function syncRules(): Promise<void> {
  try {
    await rebuildDynamicRules();
  } catch (error) {
    console.error('Failed to rebuild DNR rules', error);
  }
}

const TIP_THRESHOLD = 5;

const SEARCH_PARAMS = ['q', 'query', 'search_query', 'search', 'k', 'keyword', 's', 'text'];

const SEARCH_ENGINE_BLOCKLIST = new Set([
  'bing.com', 'duckduckgo.com', 'yahoo.com', 'baidu.com',
  'yandex.com', 'yandex.ru', 'startpage.com', 'ecosia.org',
  'ask.com', 'brave.com', 'kagi.com', 'perplexity.ai',
]);

function isBlocklisted(host: string): boolean {
  if (host.startsWith('google.')) return true;
  return SEARCH_ENGINE_BLOCKLIST.has(host);
}

function detectSearch(url: string): { param: string; baseUrl: string; host: string } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    for (const param of SEARCH_PARAMS) {
      if (parsed.searchParams.has(param)) {
        return { param, baseUrl: `${parsed.origin}${parsed.pathname}?${param}=`, host };
      }
    }
    return null;
  } catch {
    return null;
  }
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

async function shouldHandleBundle(tabId: number): Promise<boolean> {
  const now = Date.now();
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

async function handleBundleNavigation(url: string, tabId: number): Promise<void> {
  const query = extractQuery(url);
  if (!query) {
    return;
  }

  const store = await getStore();
  const normalized = normalizeKey(query);
  const shortcut = store.shortcuts[normalized];

  if (!shortcut || shortcut.type !== 'bundle' || !shortcut.bundleUrls?.length) {
    return;
  }

  if (!await shouldHandleBundle(tabId)) {
    return;
  }

  const [, ...extraUrls] = shortcut.bundleUrls;
  await Promise.all(
    extraUrls.map((target) =>
      chrome.tabs.create({
        url: target,
        openerTabId: tabId,
        active: false,
      })
    )
  );
}

async function finalizeTabSession(
  session: { host: string; param: string; baseUrl: string }
): Promise<void> {
  const r = await chrome.storage.session.get('searchVisitCounts');
  const counts = (r.searchVisitCounts ?? {}) as Record<string, number>;
  const key = `${session.host}|${session.param}`;
  counts[key] = (counts[key] ?? 0) + 1;
  await chrome.storage.session.set({ searchVisitCounts: counts });
}

async function clearTipState(
  tabId: number,
  sessions: Record<number, { host: string; param: string; baseUrl: string } | null>
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

async function handleSmartTip(url: string, tabId: number): Promise<void> {
  const hit = detectSearch(url);
  const host = hit?.host ?? null;

  const sessionKeys = hit
    ? ['tabActiveSessions', 'searchVisitCounts']
    : ['tabActiveSessions'];
  const sessRes = await chrome.storage.session.get(sessionKeys);
  const sessions = (sessRes.tabActiveSessions ?? {}) as Record<number, { host: string; param: string; baseUrl: string } | null>;
  const prev = sessions[tabId] ?? null;

  if (prev && prev.host !== host) {
    await finalizeTabSession(prev);
  }

  if (!hit || !host) {
    await clearTipState(tabId, sessions);
    return;
  }

  if (isBlocklisted(host)) {
    await clearTipState(tabId, sessions);
    return;
  }

  const store = await getStore();

  if (!store.settings.smartSuggestions) {
    await clearTipState(tabId, sessions);
    return;
  }

  const alreadyCovered = Object.values(store.shortcuts).some(
    (s) => s.url.startsWith(hit.baseUrl)
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
    sessions[tabId] = { host, param: hit.param, baseUrl: hit.baseUrl };
    await chrome.storage.session.set({ tabActiveSessions: sessions });
  }

  const counts = (sessRes.searchVisitCounts ?? {}) as Record<string, number>;
  const countKey = `${host}|${hit.param}`;
  const total = (counts[countKey] ?? 0) + 1;

  if (total >= TIP_THRESHOLD) {
    const siteName = formatSiteName(host);
    const key = buildSuggestedKey(host, store);
    const suggestion: Suggestion = { key, url: hit.baseUrl, siteName, host };
    await chrome.storage.session.set({ [`suggestion_${tabId}`]: suggestion });
    try {
      await chrome.action.setBadgeBackgroundColor({ color: '#4c6ef5' });
      await chrome.action.setBadgeText({ tabId, text: 'TIP' });
    } catch {
      // Tab was closed before badge could be set
    }
  }
}

chrome.runtime.onStartup.addListener(async () => {
  await migrateFromLegacyStorage();
  await cleanupStaleShortcuts();
  syncRules();
});

chrome.runtime.onInstalled.addListener(async () => {
  await migrateFromLegacyStorage();
  await cleanupStaleShortcuts();
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

function scheduleSyncRules(): void {
  if (syncRulesTimer !== null) clearTimeout(syncRulesTimer);
  syncRulesTimer = setTimeout(() => { syncRulesTimer = null; syncRules(); }, 50);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some(
    k => k.startsWith(SHORTCUT_PREFIX) || k === SETTINGS_KEY
  )) {
    scheduleSyncRules();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'omnijump-save-link' ? info.linkUrl : tab?.url;
  if (!url) {
    return;
  }

  const store = await getStore();
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
      chrome.action.setBadgeText({ tabId: tab!.id!, text: '' });
    }, 2500);
  }
});

// Tracks whether the side panel is currently open.
// Reset on service-worker restart (worst case: next shortcut press opens the panel).
let panelOpen = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'panel-opened') panelOpen = true;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-side-panel') return;

  if (panelOpen) {
    // Close: no user gesture required for window.close() in the panel.
    chrome.runtime.sendMessage({ type: 'close-panel' });
    panelOpen = false;
  } else {
    // Open: must happen before any await to keep the user-gesture context alive.
    if (tab?.id !== undefined) {
      openSidePanel(tab.id);
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const r = await chrome.storage.session.get('tabActiveSessions');
  const sessions = (r.tabActiveSessions ?? {}) as Record<number, { host: string; param: string; baseUrl: string } | null>;
  const session = sessions[tabId];
  if (session) await finalizeTabSession(session);
  delete sessions[tabId];
  await chrome.storage.session.set({ tabActiveSessions: sessions });
  await chrome.storage.session.remove(`suggestion_${tabId}`);
});

async function handleShortcutTouch(url: string): Promise<void> {
  const query = extractQuery(url);
  if (!query) return;
  const normalized = normalizeKey(query.split(/\s+/)[0]);
  await touchShortcut(normalized);
}

// Fallback JS redirect for browsers (e.g. Edge) that bypass DNR for
// navigations to the configured search engine. DNR handles Chrome/Bing;
// this catches what DNR misses without conflicting when DNR also fires.
async function handleJsRedirect(url: string, tabId: number): Promise<void> {
  const query = extractQuery(url);
  if (!query) return;

  const parts = query.trim().split(/\s+/);
  const normalized = normalizeKey(parts[0]);
  const store = await getStore();
  const shortcut = store.shortcuts[normalized];
  if (!shortcut) return;

  const hasArgs = parts.length > 1;
  let target: string | null = null;

  if (!hasArgs) {
    if (shortcut.type === 'redirect') {
      target = shortcut.url;
    } else if (shortcut.type === 'bundle') {
      target = shortcut.bundleUrls?.[0] ?? shortcut.url ?? null;
    }
  }

  if (shortcut.type === 'parameterized' && shortcut.urlTemplate) {
    const args = parts.slice(1).join(' ');
    target = args
      ? shortcut.urlTemplate.replace('%s', encodeURIComponent(args))
      : shortcut.url;
  }

  if (target) {
    await chrome.tabs.update(tabId, { url: target });
  }
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !details.url || details.tabId < 0) {
    return;
  }

  void handleBundleNavigation(details.url, details.tabId);
  void handleShortcutTouch(details.url);
  void handleJsRedirect(details.url, details.tabId);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || !details.url || details.tabId < 0) {
    return;
  }

  void handleSmartTip(details.url, details.tabId);
});
