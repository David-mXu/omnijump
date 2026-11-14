import './theme.css';
import { IS_FIREFOX, openSidePanel } from './platform';
import { SETTINGS_KEY, addDismissedHost, getStore, normalizeKey, upsertShortcut } from './storage';
import { suggestKeyFromUrl, uniqueKey, getUrlAncestors } from './suggest';
import { MAX_KEY_LENGTH, MAX_URL_LENGTH, Shortcut, Suggestion } from './types';
import { hasShortcutTargetCollision, normalizeUrl, renderOverwriteConfirm, savedStatusMessage } from './ui';

try {
  if (localStorage.getItem('omnijump_dark') === '1') {
    document.body.classList.add('dark');
  }
} catch { /* ignore */ }

function applyDarkMode(dark: boolean): void {
  document.body.classList.toggle('dark', dark);
  try {
    localStorage.setItem('omnijump_dark', dark ? '1' : '0');
  } catch { /* ignore */ }
}

const form = document.getElementById('shortcutForm') as HTMLFormElement | null;
const keyInput = document.getElementById('shortcutKey') as HTMLInputElement | null;
const urlInput = document.getElementById('shortcutUrl') as HTMLInputElement | null;
const statusEl = document.getElementById('status') as HTMLDivElement | null;

let autofillKey = '';
let autofillUrl = '';

function setStatus(message: string, kind: 'error' | 'success' | '' = ''): void {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = kind;
  }
}

function renderUrlAncestors(url: string): void {
  const container = document.getElementById('urlAncestors') as HTMLDivElement | null;
  if (!container) return;

  container.innerHTML = '';
  const ancestors = url ? getUrlAncestors(url) : [];
  for (const ancestor of ancestors) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'url-ancestor-btn';
    btn.textContent = ancestor.replace(/^https?:\/\//, '');
    btn.title = ancestor;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (urlInput) {
        urlInput.value = ancestor;
        renderUrlAncestors(ancestor);
      }
    });
    container.appendChild(btn);
  }
}

urlInput?.addEventListener('input', () => {
  const normalized = normalizeUrl(urlInput.value);
  renderUrlAncestors(normalized || urlInput.value);
});
urlInput?.addEventListener('change', () => {
  const normalized = normalizeUrl(urlInput.value);
  renderUrlAncestors(normalized || urlInput.value);
});

function showSuggestion(s: Suggestion, tabId: number): void {
  const el = document.getElementById('suggestion');
  const text = document.getElementById('suggestionText');
  if (!el || !text) return;

  text.textContent = `You often visit ${s.siteName}. Save "${s.key}" as a shortcut?`;
  el.hidden = false;

  const isDirty =
    (keyInput && keyInput.value !== '' && keyInput.value !== autofillKey) ||
    (urlInput && urlInput.value !== '' && urlInput.value !== autofillUrl);

  if (!isDirty) {
    if (keyInput) {
      keyInput.value = s.key;
      autofillKey = s.key;
    }
    if (urlInput) {
      urlInput.value = s.url;
      autofillUrl = s.url;
      renderUrlAncestors(s.url);
    }
  }

  const persistSuggestion = async (key: string): Promise<void> => {
    try {
      const store = await getStore();
      // Validate at the write boundary like every other save path.
      const url = normalizeUrl(s.url);
      if (!url) {
        setStatus('Suggested URL is invalid.', 'error');
        return;
      }
      await upsertShortcut({ key, url, type: 'redirect' });
      await chrome.storage.session.remove(`suggestion_${tabId}`);
      await chrome.action.setBadgeText({ tabId, text: '' });
      el.hidden = true;
      setStatus(savedStatusMessage(key, Object.keys(store.shortcuts).length + 1), 'success');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save shortcut.', 'error');
    }
  };

  document.getElementById('saveSuggestion')?.addEventListener('click', async () => {
    const url = normalizeUrl(s.url);
    if (!url) {
      setStatus('Suggested URL is invalid.', 'error');
      return;
    }
    // Mirror the form's overwrite guard: a banner that stays visible after the
    // keyword was saved elsewhere must not silently replace it.
    const store = await getStore();
    const existing = Object.prototype.hasOwnProperty.call(store.shortcuts, s.key)
      ? store.shortcuts[s.key]
      : undefined;
    const candidate: Shortcut = { key: s.key, url, type: 'redirect' };
    if (existing && hasShortcutTargetCollision(existing, candidate) && statusEl) {
      const alt = uniqueKey(s.key, new Set(Object.keys(store.shortcuts)));
      renderOverwriteConfirm(
        statusEl,
        existing,
        alt,
        () => void persistSuggestion(s.key),
        (altKey) => void persistSuggestion(altKey),
      );
      return;
    }
    await persistSuggestion(s.key);
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
    applyDarkMode(store.settings.darkMode ?? false);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:\/\//i.test(tab.url) && urlInput) {
      urlInput.value = tab.url;
      autofillUrl = tab.url;
      renderUrlAncestors(tab.url);
      const suggested = suggestKeyFromUrl(tab.url);
      if (keyInput && suggested) {
        const unique = uniqueKey(suggested, new Set(Object.keys(store.shortcuts)));
        keyInput.value = unique;
        autofillKey = unique;
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
    setStatus('Failed to read active tab.', 'error');
    console.error(error);
  }
}

async function persistShortcut(key: string, url: string, totalAfter: number): Promise<void> {
  try {
    await upsertShortcut({ key, url, type: 'redirect' });
    setStatus(savedStatusMessage(key, totalAfter), 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to save shortcut.', 'error');
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
    setStatus('Enter a keyword and valid http(s) URL.', 'error');
    return;
  }
  if (key.length > MAX_KEY_LENGTH) {
    setStatus(`Keyword is too long (${key.length} chars, max ${MAX_KEY_LENGTH}).`, 'error');
    return;
  }
  if (urlInput.value.trim().length > MAX_URL_LENGTH) {
    setStatus(`URL is too long (max ${MAX_URL_LENGTH} characters).`, 'error');
    return;
  }

  try {
    const store = await getStore();
    const existing = Object.prototype.hasOwnProperty.call(store.shortcuts, key)
      ? store.shortcuts[key]
      : undefined;
    const total = Object.keys(store.shortcuts).length;
    const candidate: Shortcut = { key, url, type: 'redirect' };

    // Same key pointing elsewhere: ask instead of silently renaming or clobbering.
    if (existing && hasShortcutTargetCollision(existing, candidate) && statusEl) {
      const alt = uniqueKey(key, new Set(Object.keys(store.shortcuts)));
      renderOverwriteConfirm(
        statusEl,
        existing,
        alt,
        () => void persistShortcut(key, url, total),
        (altKey) => void persistShortcut(altKey, url, total + 1),
      );
      return;
    }

    await persistShortcut(key, url, existing ? total : total + 1);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to save shortcut.', 'error');
    console.error(error);
  }
});

void init();

document.getElementById('openPanel')?.addEventListener('click', async () => {
  // Firefox: sidebarAction.open() must be called synchronously within the user
  // gesture — calling it after any await causes Firefox to drop it.
  if (IS_FIREFOX) {
    openSidePanel(0);
    window.close();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    openSidePanel(tab.id);
  }
  window.close();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && SETTINGS_KEY in changes) {
    const newSettings = changes[SETTINGS_KEY]?.newValue as { darkMode?: boolean } | undefined;
    applyDarkMode(newSettings?.darkMode ?? false);
  }
});
