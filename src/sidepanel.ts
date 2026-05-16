import { getStore, normalizeKey, saveSettings, upsertShortcut } from './storage';
import { buildShortcutRow, normalizeUrl } from './ui';
import { suggestKeyFromUrl, uniqueKey } from './suggest';

// ── Tab elements ──────────────────────────────────────────────────────────────
const tabShortcutsBtn = document.getElementById('tabShortcuts') as HTMLButtonElement;
const tabBundleBtn = document.getElementById('tabBundle') as HTMLButtonElement;
const tabSettingsBtn = document.getElementById('tabSettings') as HTMLButtonElement;
const panelShortcuts = document.getElementById('panelShortcuts') as HTMLElement;
const panelBundle = document.getElementById('panelBundle') as HTMLElement;
const panelSettings = document.getElementById('panelSettings') as HTMLElement;

// ── Shortcuts panel ───────────────────────────────────────────────────────────
const listEl = document.getElementById('shortcutList') as HTMLUListElement;
const emptyStateEl = document.getElementById('emptyState') as HTMLDivElement;
const countEl = document.getElementById('count') as HTMLDivElement;
const redirectKeyInput = document.getElementById('redirectKey') as HTMLInputElement;
const redirectUrlInput = document.getElementById('redirectUrl') as HTMLInputElement;
const saveRedirectBtn = document.getElementById('saveRedirect') as HTMLButtonElement;
const addRedirectStatusEl = document.getElementById('addRedirectStatus') as HTMLDivElement;

// ── Bundle panel ──────────────────────────────────────────────────────────────
const bundleForm = document.getElementById('bundleForm') as HTMLFormElement;
const bundleKeyInput = document.getElementById('bundleKey') as HTMLInputElement;
const bundleLabelInput = document.getElementById('bundleLabel') as HTMLInputElement;
const urlListEl = document.getElementById('urlList') as HTMLDivElement;
const addUrlBtn = document.getElementById('addUrl') as HTMLButtonElement;
const bundleStatusEl = document.getElementById('bundleStatus') as HTMLDivElement;

// ── Settings panel ────────────────────────────────────────────────────────────
const shortcutPopupEl = document.getElementById('shortcutPopup') as HTMLSpanElement;
const shortcutPanelEl = document.getElementById('shortcutPanel') as HTMLSpanElement;
const customizeBtn = document.getElementById('customizeShortcut') as HTMLButtonElement;
const maxShortcutsInput = document.getElementById('maxShortcutsInput') as HTMLInputElement;
const saveMaxBtn = document.getElementById('saveMaxShortcuts') as HTMLButtonElement;
const settingsStatusEl = document.getElementById('settingsStatus') as HTMLDivElement;

// ── Tab switching ─────────────────────────────────────────────────────────────
type TabName = 'shortcuts' | 'bundle' | 'settings';

function showTab(name: TabName): void {
  panelShortcuts.hidden = name !== 'shortcuts';
  panelBundle.hidden = name !== 'bundle';
  panelSettings.hidden = name !== 'settings';
  tabShortcutsBtn.classList.toggle('active', name === 'shortcuts');
  tabBundleBtn.classList.toggle('active', name === 'bundle');
  tabSettingsBtn.classList.toggle('active', name === 'settings');
}

tabShortcutsBtn.addEventListener('click', () => showTab('shortcuts'));
tabBundleBtn.addEventListener('click', () => showTab('bundle'));

// ── Shortcut list ─────────────────────────────────────────────────────────────
async function render(): Promise<void> {
  const store = await getStore();
  const shortcuts = Object.values(store.shortcuts);

  countEl.textContent = `${shortcuts.length} / ${store.settings.maxShortcuts}`;
  listEl.innerHTML = '';

  const isEmpty = shortcuts.length === 0;
  emptyStateEl.hidden = !isEmpty;
  listEl.hidden = isEmpty;

  shortcuts.forEach((shortcut) => listEl.appendChild(buildShortcutRow(shortcut, render)));
}

// ── Add Redirect form ─────────────────────────────────────────────────────────
function setRedirectStatus(msg: string, type: 'error' | 'success' | '' = ''): void {
  addRedirectStatusEl.textContent = msg;
  addRedirectStatusEl.className = type;
}

async function initRedirectForm(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      redirectUrlInput.value = tab.url;
      const store = await getStore();
      const existingKeys = new Set(Object.keys(store.shortcuts));
      const suggested = suggestKeyFromUrl(tab.url);
      if (suggested) {
        redirectKeyInput.value = uniqueKey(suggested, existingKeys);
      }
    }
  } catch {
    // non-fatal — fields stay empty
  }
}

saveRedirectBtn.addEventListener('click', async () => {
  const key = normalizeKey(redirectKeyInput.value);
  const url = normalizeUrl(redirectUrlInput.value);

  if (!key) { setRedirectStatus('Enter a keyword.', 'error'); return; }
  if (!url) { setRedirectStatus('Enter a URL.', 'error'); return; }

  try {
    await upsertShortcut({ key, url, type: 'redirect' });
    setRedirectStatus(`Saved "${key}".`, 'success');
    redirectKeyInput.value = '';
    redirectUrlInput.value = '';
    await render();
  } catch (err) {
    setRedirectStatus((err as Error).message, 'error');
  }
});

// ── Bundle form ───────────────────────────────────────────────────────────────
function addUrlRow(): void {
  const row = document.createElement('div');
  row.className = 'url-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'url-input';
  input.placeholder = 'google.com or https://...';
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-url';
  removeBtn.title = 'Remove';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => row.remove());
  row.append(input, removeBtn);
  urlListEl.appendChild(row);
}

addUrlBtn.addEventListener('click', addUrlRow);

function setBundleStatus(msg: string, type: 'error' | 'success' | '' = ''): void {
  bundleStatusEl.textContent = msg;
  bundleStatusEl.className = type;
}

bundleForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const key = normalizeKey(bundleKeyInput.value);
  const label = bundleLabelInput.value.trim() || undefined;
  const urls = Array.from(urlListEl.querySelectorAll<HTMLInputElement>('input.url-input'))
    .map((i) => normalizeUrl(i.value))
    .filter(Boolean);

  if (!key) { setBundleStatus('Enter a keyword.', 'error'); return; }
  if (urls.length < 2) { setBundleStatus('Add at least 2 URLs.', 'error'); return; }

  try {
    await upsertShortcut({ key, url: urls[0], type: 'bundle', bundleUrls: urls, label });
    setBundleStatus(`Bundle "${key}" saved.`, 'success');
    bundleForm.reset();
    urlListEl.innerHTML = `
      <div class="url-row"><input type="text" class="url-input" placeholder="google.com or https://..." /></div>
      <div class="url-row">
        <input type="text" class="url-input" placeholder="google.com or https://..." />
        <button type="button" class="remove-url" title="Remove">×</button>
      </div>`;
    urlListEl
      .querySelectorAll<HTMLButtonElement>('.remove-url')
      .forEach((btn) => btn.addEventListener('click', () => btn.closest('.url-row')?.remove()));
    await render();
  } catch (err) {
    setBundleStatus((err as Error).message, 'error');
  }
});

// ── Settings tab ──────────────────────────────────────────────────────────────
tabSettingsBtn.addEventListener('click', async () => {
  showTab('settings');

  const commands = await chrome.commands.getAll();
  const panelCmd = commands.find((c) => c.name === 'open-side-panel');
  const popupCmd = commands.find((c) => c.name === '_execute_action');
  shortcutPanelEl.textContent = panelCmd?.shortcut || 'not set';
  shortcutPopupEl.textContent = popupCmd?.shortcut || 'not set';

  const store = await getStore();
  maxShortcutsInput.value = String(store.settings.maxShortcuts);
  settingsStatusEl.textContent = '';
  settingsStatusEl.className = '';
});

customizeBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

saveMaxBtn.addEventListener('click', async () => {
  const value = parseInt(maxShortcutsInput.value, 10);
  if (!value || value < 1 || value > 500) {
    settingsStatusEl.textContent = 'Enter a number between 1 and 500.';
    settingsStatusEl.className = 'error';
    return;
  }
  const store = await getStore();
  store.settings.maxShortcuts = value;
  await saveSettings(store.settings);
  settingsStatusEl.textContent = 'Saved.';
  settingsStatusEl.className = 'success';
});

// ── Init ──────────────────────────────────────────────────────────────────────
render();
initRedirectForm();
