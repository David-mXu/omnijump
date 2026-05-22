import { addDismissedHost, getStore, normalizeKey, upsertShortcut } from './storage';
import { suggestKeyFromUrl, uniqueKey, getUrlAncestors } from './suggest';
import { Suggestion } from './types';

function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s || /^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

const form = document.getElementById('shortcutForm') as HTMLFormElement | null;
const keyInput = document.getElementById('shortcutKey') as HTMLInputElement | null;
const urlInput = document.getElementById('shortcutUrl') as HTMLInputElement | null;
const statusEl = document.getElementById('status') as HTMLDivElement | null;

function setStatus(message: string): void {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function renderUrlAncestors(url: string): void {
  const container = document.getElementById('urlAncestors') as HTMLDivElement | null;
  if (!container) return;

  container.innerHTML = '';
  for (const ancestor of getUrlAncestors(url)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'url-ancestor-btn';
    btn.textContent = ancestor.replace(/^https?:\/\//, '');
    btn.title = ancestor;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (urlInput) urlInput.value = ancestor;
    });
    container.appendChild(btn);
  }
}

function showSuggestion(s: Suggestion, tabId: number): void {
  const el = document.getElementById('suggestion');
  const text = document.getElementById('suggestionText');
  if (!el || !text) return;

  text.textContent = `You often search ${s.siteName}. Save "${s.key}" as a shortcut?`;
  el.hidden = false;

  document.getElementById('saveSuggestion')?.addEventListener('click', async () => {
    try {
      await upsertShortcut({ key: s.key, url: s.url, type: 'redirect' });
      await chrome.storage.session.remove(`suggestion_${tabId}`);
      await chrome.action.setBadgeText({ tabId, text: '' });
      el.hidden = true;
      setStatus(`Saved "${s.key}".`);
    } catch (err) {
      setStatus((err as Error).message);
    }
  });

  document.getElementById('dismissSuggestion')?.addEventListener('click', async () => {
    await chrome.storage.session.remove(`suggestion_${tabId}`);
    await chrome.action.setBadgeText({ tabId, text: '' });
    if (s.host) {
      await addDismissedHost(s.host);
    }
    el.hidden = true;
  });
}

async function init(): Promise<void> {
  try {
    const store = await getStore();
    document.body.classList.toggle('dark', store.settings.darkMode ?? false);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && urlInput) {
      urlInput.value = tab.url;
      renderUrlAncestors(tab.url);
      const suggested = suggestKeyFromUrl(tab.url);
      if (keyInput && suggested) {
        keyInput.value = suggested;
        keyInput.focus();
        keyInput.select();
      }
    }
    if (tab?.id !== undefined) {
      const result = await chrome.storage.session.get(`suggestion_${tab.id}`);
      const suggestion = result[`suggestion_${tab.id}`] as Suggestion | undefined;
      if (suggestion) showSuggestion(suggestion, tab.id);
    }
  } catch (error) {
    setStatus('Failed to read active tab.');
    console.error(error);
  }
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!keyInput || !urlInput) {
    return;
  }

  const key = normalizeKey(keyInput.value);
  const url = normalizeUrl(urlInput.value);

  if (!key || !url) {
    setStatus('Enter a keyword and URL.');
    return;
  }

  try {
    const store = await getStore();
    const existingKeys = new Set<string>(Object.keys(store.shortcuts));
    const unique = uniqueKey(key, existingKeys);

    await upsertShortcut({
      key: unique,
      url,
      type: 'redirect',
    });

    setStatus(`Saved ${unique}.`);
  } catch (error) {
    setStatus('Failed to save shortcut.');
    console.error(error);
  }
});

init();

document.getElementById('openPanel')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
  window.close();
});
