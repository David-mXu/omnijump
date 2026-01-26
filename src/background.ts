import { rebuildDynamicRules } from './dnr';
import { STORAGE_KEY, upsertShortcut } from './storage';
import { suggestKeyFromUrl, uniqueKey } from './suggest';

async function syncRules(): Promise<void> {
  try {
    await rebuildDynamicRules();
  } catch (error) {
    console.error('Failed to rebuild DNR rules', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  syncRules();

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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) {
    syncRules();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'omnibar-save-link' ? info.linkUrl : tab?.url;
  if (!url) {
    return;
  }

  const store = await chrome.storage.sync.get(STORAGE_KEY);
  const existingKeys = new Set<string>(
    Object.keys(store[STORAGE_KEY]?.shortcuts ?? {})
  );
  const base = suggestKeyFromUrl(url);
  const key = uniqueKey(base || 'shortcut', existingKeys);

  await upsertShortcut({
    key,
    url,
    type: 'redirect',
  });
});
