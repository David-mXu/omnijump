import { rebuildDynamicRules } from './dnr';
import { SETTINGS_KEY, SHORTCUT_PREFIX, getStore, migrateFromLegacyStorage, normalizeKey, upsertShortcut } from './storage';
import { suggestKeyFromUrl, uniqueKey } from './suggest';

async function syncRules(): Promise<void> {
  try {
    await rebuildDynamicRules();
  } catch (error) {
    console.error('Failed to rebuild DNR rules', error);
  }
}

const TIP_THRESHOLD = 3;

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

async function handleSmartTip(url: string, tabId: number): Promise<void> {
  const query = extractQuery(url);
  if (!query) {
    await chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }

  const store = await getStore();
  const normalized = normalizeKey(query);
  if (store.shortcuts[normalized]) {
    await chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }

  const host = new URL(url).hostname;
  const countKey = `${host}|${normalized}`;
  const result = await chrome.storage.session.get('searchCounts');
  const counts = (result.searchCounts ?? {}) as Record<string, number>;
  counts[countKey] = (counts[countKey] ?? 0) + 1;
  await chrome.storage.session.set({ searchCounts: counts });

  if (counts[countKey] >= TIP_THRESHOLD) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#4c6ef5' });
    await chrome.action.setBadgeText({ tabId, text: 'TIP' });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await migrateFromLegacyStorage();
  syncRules();

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'omnibar-save-page',
      title: 'Save Page as Shortcut',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'omnibar-save-link',
      title: 'Save Link as Shortcut',
      contexts: ['link'],
    });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some(
    k => k.startsWith(SHORTCUT_PREFIX) || k === SETTINGS_KEY
  )) {
    syncRules();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'omnibar-save-link' ? info.linkUrl : tab?.url;
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
      chrome.sidePanel.open({ tabId: tab.id });
    }
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !details.url || details.tabId < 0) {
    return;
  }

  void handleBundleNavigation(details.url, details.tabId);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || !details.url || details.tabId < 0) {
    return;
  }

  void handleSmartTip(details.url, details.tabId);
});
