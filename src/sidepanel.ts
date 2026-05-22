import { DAILY_KEY, SETTINGS_KEY, SHORTCUT_PREFIX, addDismissedHost, deleteShortcut, getStore, normalizeKey, saveSettings, upsertShortcut } from './storage';
import { buildShortcutRow, hoveredRow, normalizeUrl } from './ui';
import { suggestKeyFromUrl, uniqueKey, getUrlAncestors } from './suggest';
import { fuzzyFilter } from './fuzzy';
import { Shortcut, Suggestion } from './types';

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
const noResultsEl = document.getElementById('noResults') as HTMLDivElement;
const countEl = document.getElementById('count') as HTMLDivElement;
const filterInput = document.getElementById('filterInput') as HTMLInputElement;
const selectToggleBtn = document.getElementById('selectToggle') as HTMLButtonElement;
const deleteSelectedBtn = document.getElementById('deleteSelected') as HTMLButtonElement;
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
const addAllTabsBtn = document.getElementById('addAllTabs') as HTMLButtonElement;
const pickTabsBtn = document.getElementById('pickTabs') as HTMLButtonElement;
const tabPickerEl = document.getElementById('tabPicker') as HTMLDivElement;
const tabPickListEl = document.getElementById('tabPickList') as HTMLDivElement;
const useSelectedTabsBtn = document.getElementById('useSelectedTabs') as HTMLButtonElement;
const cancelPickerBtn = document.getElementById('cancelPicker') as HTMLButtonElement;
const pickShortcutsBtn = document.getElementById('pickShortcuts') as HTMLButtonElement;
const shortcutPickerEl = document.getElementById('shortcutPicker') as HTMLDivElement;
const shortcutPickListEl = document.getElementById('shortcutPickList') as HTMLDivElement;
const useSelectedShortcutsBtn = document.getElementById('useSelectedShortcuts') as HTMLButtonElement;
const cancelShortcutPickerBtn = document.getElementById('cancelShortcutPicker') as HTMLButtonElement;

// ── Suggestion banner ─────────────────────────────────────────────────────────
const suggestionEl = document.getElementById('suggestion') as HTMLDivElement;
const suggestionTextEl = document.getElementById('suggestionText') as HTMLDivElement;
const saveSuggestionBtn = document.getElementById('saveSuggestion') as HTMLButtonElement;
const dismissSuggestionBtn = document.getElementById('dismissSuggestion') as HTMLButtonElement;

// ── Redirect form extras ──────────────────────────────────────────────────────
const searchToggleBtn = document.getElementById('searchToggle') as HTMLButtonElement;
const searchFieldsEl = document.getElementById('searchFields') as HTMLDivElement;
const redirectUrlTemplateInput = document.getElementById('redirectUrlTemplate') as HTMLInputElement;

// ── Settings panel ────────────────────────────────────────────────────────────
const weeklyChartEl = document.getElementById('weeklyChart') as HTMLDivElement;
const weekTotalEl = document.getElementById('weekTotal') as HTMLDivElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
const importFile = document.getElementById('importFile') as HTMLInputElement;
const dataStatusEl = document.getElementById('dataStatus') as HTMLDivElement;
const shortcutPopupEl = document.getElementById('shortcutPopup') as HTMLSpanElement;
const shortcutPanelEl = document.getElementById('shortcutPanel') as HTMLSpanElement;
const customizeBtn = document.getElementById('customizeShortcut') as HTMLButtonElement;
const maxShortcutsInput = document.getElementById('maxShortcutsInput') as HTMLInputElement;
const saveMaxBtn = document.getElementById('saveMaxShortcuts') as HTMLButtonElement;
const settingsStatusEl = document.getElementById('settingsStatus') as HTMLDivElement;
const filterThresholdInput = document.getElementById('filterThresholdInput') as HTMLInputElement;
const saveFilterThresholdBtn = document.getElementById('saveFilterThreshold') as HTMLButtonElement;
const filterThresholdStatusEl = document.getElementById('filterThresholdStatus') as HTMLDivElement;
const staleToggle = document.getElementById('staleToggle') as HTMLInputElement;
const staleDaysInput = document.getElementById('staleDaysInput') as HTMLInputElement;
const saveStaleBtn = document.getElementById('saveStale') as HTMLButtonElement;
const staleStatusEl = document.getElementById('staleStatus') as HTMLDivElement;
const darkModeToggle = document.getElementById('darkModeToggle') as HTMLInputElement;
const smartSuggestionsToggle = document.getElementById('smartSuggestionsToggle') as HTMLInputElement;

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

// ── Store cache + render ──────────────────────────────────────────────────────
// shortcutCache / settingsCache hold the last-known store values.
// refresh() reads storage and updates them; renderList() reads only the cache.
// This means filter-input keystrokes never hit storage.
let shortcutCache: Shortcut[] = [];
let settingsCache = { maxShortcuts: 500, filterThreshold: 25, darkMode: false };

function renderList(): void {
  filterInput.hidden = shortcutCache.length < settingsCache.filterThreshold;

  const query = filterInput.value.trim();
  const filtered = query ? fuzzyFilter(query, shortcutCache) : shortcutCache;

  countEl.textContent = `${shortcutCache.length} / ${settingsCache.maxShortcuts}`;

  const isEmpty = shortcutCache.length === 0;
  const noResults = !isEmpty && filtered.length === 0;
  emptyStateEl.hidden = !isEmpty;
  noResultsEl.hidden = !noResults;
  listEl.hidden = isEmpty || noResults;

  const frag = document.createDocumentFragment();
  filtered.forEach((s) => frag.appendChild(buildShortcutRow(s, refresh)));
  listEl.replaceChildren(frag);
}

async function refresh(): Promise<void> {
  const store = await getStore();
  shortcutCache = Object.values(store.shortcuts);
  settingsCache = { maxShortcuts: store.settings.maxShortcuts, filterThreshold: store.settings.filterThreshold, darkMode: store.settings.darkMode ?? false };
  document.body.classList.toggle('dark', settingsCache.darkMode);
  renderList();
}

// Batches rapid onChanged bursts (e.g. bulk delete) into a single refresh.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(); }, 50);
}

filterInput.addEventListener('input', renderList);

// ── Multi-select ──────────────────────────────────────────────────────────────
selectToggleBtn.addEventListener('click', () => {
  const entering = !listEl.classList.contains('selecting');
  listEl.classList.toggle('selecting', entering);
  selectToggleBtn.textContent = entering ? 'Cancel' : 'Select';
  deleteSelectedBtn.hidden = true;
  listEl.querySelectorAll<HTMLInputElement>('.select-cb').forEach(cb => { cb.checked = false; });
});

listEl.addEventListener('change', () => {
  const count = listEl.querySelectorAll<HTMLInputElement>('.select-cb:checked').length;
  deleteSelectedBtn.hidden = count === 0;
  deleteSelectedBtn.textContent = `Delete (${count})`;
});

deleteSelectedBtn.addEventListener('click', async () => {
  const keys = Array.from(
    listEl.querySelectorAll<HTMLInputElement>('.select-cb:checked')
  ).map(cb => cb.dataset.key!);
  await Promise.all(keys.map(deleteShortcut));
  listEl.classList.remove('selecting');
  selectToggleBtn.textContent = 'Select';
  deleteSelectedBtn.hidden = true;
  await refresh();
});

// ── Add Redirect form ─────────────────────────────────────────────────────────
function setRedirectStatus(msg: string, type: 'error' | 'success' | '' = ''): void {
  addRedirectStatusEl.textContent = msg;
  addRedirectStatusEl.className = type;
}

let isSearchType = false;
searchToggleBtn.addEventListener('click', () => {
  isSearchType = !isSearchType;
  searchFieldsEl.hidden = !isSearchType;
  searchToggleBtn.textContent = isSearchType ? '− Remove search shortcut' : '+ Make search shortcut';
});

function renderRedirectUrlAncestors(url: string): void {
  const container = document.getElementById('redirectUrlAncestors') as HTMLDivElement | null;
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
      redirectUrlInput.value = ancestor;
    });
    container.appendChild(btn);
  }
}

function initRedirectForm(tab: chrome.tabs.Tab | undefined): void {
  if (!tab?.url) return;
  redirectUrlInput.value = tab.url;
  renderRedirectUrlAncestors(tab.url);
  // shortcutCache is populated by refresh() before this runs
  const existingKeys = new Set(shortcutCache.map(s => s.key));
  const suggested = suggestKeyFromUrl(tab.url);
  if (suggested) redirectKeyInput.value = uniqueKey(suggested, existingKeys);
}

saveRedirectBtn.addEventListener('click', async () => {
  const key = normalizeKey(redirectKeyInput.value);

  if (!key) { setRedirectStatus('Enter a keyword.', 'error'); return; }

  if (isSearchType) {
    const urlTemplate = redirectUrlTemplateInput.value.trim();
    if (!urlTemplate.includes('%s')) {
      setRedirectStatus('Search URL must include %s.', 'error');
      return;
    }
    const fallbackUrl = normalizeUrl(redirectUrlInput.value) || urlTemplate.replace('%s', '');
    try {
      await upsertShortcut({ key, url: fallbackUrl, urlTemplate, type: 'parameterized' });
      setRedirectStatus(`Saved "${key}".`, 'success');
      redirectKeyInput.value = '';
      redirectUrlInput.value = '';
      redirectUrlTemplateInput.value = '';
      isSearchType = false;
      searchFieldsEl.hidden = true;
      searchToggleBtn.textContent = '+ Make search shortcut';
      await refresh();
    } catch (err) {
      setRedirectStatus((err as Error).message, 'error');
    }
    return;
  }

  const url = normalizeUrl(redirectUrlInput.value);
  if (!url) { setRedirectStatus('Enter a URL.', 'error'); return; }

  try {
    await upsertShortcut({ key, url, type: 'redirect' });
    setRedirectStatus(`Saved "${key}".`, 'success');
    redirectKeyInput.value = '';
    redirectUrlInput.value = '';
    await refresh();
  } catch (err) {
    setRedirectStatus((err as Error).message, 'error');
  }
});

// ── Bundle form ───────────────────────────────────────────────────────────────
function getDragAfterElement(container: HTMLElement, y: number): HTMLElement | null {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('.url-row:not(.dragging)'));
  return rows.reduce<{ offset: number; element: HTMLElement | null }>(
    (closest, el) => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      return offset < 0 && offset > closest.offset ? { offset, element: el } : closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

urlListEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  const dragging = urlListEl.querySelector<HTMLElement>('.url-row.dragging');
  if (!dragging) return;
  const after = getDragAfterElement(urlListEl, e.clientY);
  if (!after) urlListEl.appendChild(dragging);
  else urlListEl.insertBefore(dragging, after);
});

function addUrlRow(value = ''): void {
  const row = document.createElement('div');
  row.className = 'url-row';
  row.draggable = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'url-input';
  input.placeholder = 'google.com or https://...';
  input.value = value;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-url';
  removeBtn.title = 'Remove';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => row.remove());

  row.addEventListener('dragstart', () => row.classList.add('dragging'));
  row.addEventListener('dragend', () => row.classList.remove('dragging'));

  row.append(input, removeBtn);
  urlListEl.appendChild(row);
}

function resetUrlList(): void {
  urlListEl.innerHTML = '';
  addUrlRow();
  addUrlRow();
}

addUrlBtn.addEventListener('click', () => addUrlRow());

async function addAllOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const urls = tabs.map(t => t.url ?? '').filter(u => u.startsWith('http'));
  urlListEl.innerHTML = '';
  urls.forEach(url => addUrlRow(url));
  if (!bundleKeyInput.value && urls[0]) {
    try {
      const host = new URL(urls[0]).hostname.replace(/^www\./, '');
      bundleKeyInput.value = host.split('.')[0];
    } catch { /* ignore */ }
  }
}

async function openTabPicker(): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const httpTabs = tabs.filter(t => t.url?.startsWith('http'));
  tabPickListEl.innerHTML = '';
  httpTabs.forEach(tab => {
    const label = document.createElement('label');
    label.className = 'tab-pick-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'tab-pick-cb';
    cb.value = tab.url!;
    cb.checked = true;

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.width = 14;
    favicon.height = 14;
    favicon.src = tab.favIconUrl ?? '';
    favicon.onerror = () => { favicon.style.display = 'none'; };

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title ?? tab.url ?? '';
    title.title = tab.url ?? '';

    label.append(cb, favicon, title);
    tabPickListEl.appendChild(label);
  });
  tabPickerEl.hidden = false;
}

addAllTabsBtn.addEventListener('click', addAllOpenTabs);
pickTabsBtn.addEventListener('click', () => { shortcutPickerEl.hidden = true; openTabPicker(); });
cancelPickerBtn.addEventListener('click', () => { tabPickerEl.hidden = true; });

useSelectedTabsBtn.addEventListener('click', () => {
  const urls = Array.from(tabPickListEl.querySelectorAll<HTMLInputElement>('.tab-pick-cb:checked'))
    .map(cb => cb.value)
    .filter(Boolean);
  urlListEl.innerHTML = '';
  urls.forEach(url => addUrlRow(url));
  tabPickerEl.hidden = true;
});

function openShortcutPicker(): void {
  const candidates = shortcutCache.filter(s => s.type !== 'bundle');
  shortcutPickListEl.innerHTML = '';
  if (candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = 'No redirect or search shortcuts saved yet.';
    shortcutPickListEl.appendChild(empty);
  } else {
    candidates.forEach(shortcut => {
      const label = document.createElement('label');
      label.className = 'tab-pick-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'shortcut-pick-cb';
      cb.value = shortcut.url;
      cb.checked = true;

      const item = document.createElement('div');
      item.className = 'shortcut-pick-item';

      const keyEl = document.createElement('div');
      keyEl.className = 'shortcut-pick-key';
      keyEl.textContent = shortcut.label ?? shortcut.key;

      const urlEl = document.createElement('div');
      urlEl.className = 'shortcut-pick-url';
      urlEl.textContent = shortcut.urlTemplate ?? shortcut.url;
      urlEl.title = shortcut.url;

      item.append(keyEl, urlEl);
      label.append(cb, item);
      shortcutPickListEl.appendChild(label);
    });
  }
  shortcutPickerEl.hidden = false;
}

pickShortcutsBtn.addEventListener('click', () => { tabPickerEl.hidden = true; openShortcutPicker(); });
cancelShortcutPickerBtn.addEventListener('click', () => { shortcutPickerEl.hidden = true; });

useSelectedShortcutsBtn.addEventListener('click', () => {
  const urls = Array.from(shortcutPickListEl.querySelectorAll<HTMLInputElement>('.shortcut-pick-cb:checked'))
    .map(cb => cb.value)
    .filter(Boolean);
  urls.forEach(url => addUrlRow(url));
  shortcutPickerEl.hidden = true;
});

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
    resetUrlList();
    await refresh();
  } catch (err) {
    setBundleStatus((err as Error).message, 'error');
  }
});

// ── Settings tab ──────────────────────────────────────────────────────────────
tabSettingsBtn.addEventListener('click', async () => {
  showTab('settings');

  const [commands, store, localResult] = await Promise.all([
    chrome.commands.getAll(),
    getStore(),
    chrome.storage.local.get(DAILY_KEY),
  ]);

  const panelCmd = commands.find((c) => c.name === 'open-side-panel');
  const popupCmd = commands.find((c) => c.name === '_execute_action');
  shortcutPanelEl.textContent = panelCmd?.shortcut || 'not set';
  shortcutPopupEl.textContent = popupCmd?.shortcut || 'not set';

  maxShortcutsInput.value = String(store.settings.maxShortcuts);
  filterThresholdInput.value = String(store.settings.filterThreshold);
  staleToggle.checked = store.settings.staleAutoDelete;
  staleDaysInput.value = String(store.settings.staleDays);
  darkModeToggle.checked = store.settings.darkMode ?? false;
  smartSuggestionsToggle.checked = store.settings.smartSuggestions ?? false;

  settingsStatusEl.textContent = '';
  settingsStatusEl.className = '';
  filterThresholdStatusEl.textContent = '';
  filterThresholdStatusEl.className = '';
  staleStatusEl.textContent = '';
  staleStatusEl.className = '';

  // Weekly usage chart
  const counts = (localResult[DAILY_KEY] ?? {}) as Record<string, number>;
  const last7 = Array.from({ length: 7 }, (_, i) => {
    return new Date(Date.now() - (6 - i) * 86_400_000).toISOString().slice(0, 10);
  });
  const weekTotal = last7.reduce((s, d) => s + (counts[d] ?? 0), 0);
  const max = Math.max(1, ...last7.map(d => counts[d] ?? 0));
  weeklyChartEl.innerHTML = '';
  last7.forEach(date => {
    const bar = document.createElement('div');
    bar.className = 'week-bar';
    bar.style.height = `${Math.round(((counts[date] ?? 0) / max) * 40)}px`;
    bar.title = `${date}: ${counts[date] ?? 0} opens`;
    weeklyChartEl.appendChild(bar);
  });
  weekTotalEl.textContent = `${weekTotal} shortcut open${weekTotal !== 1 ? 's' : ''} this week`;

  dataStatusEl.textContent = '';
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
  await saveSettings({ ...store.settings, maxShortcuts: value });
  settingsStatusEl.textContent = 'Saved.';
  settingsStatusEl.className = 'success';
});

saveFilterThresholdBtn.addEventListener('click', async () => {
  const value = parseInt(filterThresholdInput.value, 10);
  if (!value || value < 1 || value > 500) {
    filterThresholdStatusEl.textContent = 'Enter a number between 1 and 500.';
    filterThresholdStatusEl.className = 'error';
    return;
  }
  const store = await getStore();
  await saveSettings({ ...store.settings, filterThreshold: value });
  filterThresholdStatusEl.textContent = 'Saved.';
  filterThresholdStatusEl.className = 'success';
});

saveStaleBtn.addEventListener('click', async () => {
  const days = parseInt(staleDaysInput.value, 10);
  if (!days || days < 7 || days > 365) {
    staleStatusEl.textContent = 'Enter a number between 7 and 365.';
    staleStatusEl.className = 'error';
    return;
  }
  const store = await getStore();
  await saveSettings({ ...store.settings, staleAutoDelete: staleToggle.checked, staleDays: days });
  staleStatusEl.textContent = 'Saved.';
  staleStatusEl.className = 'success';
});

darkModeToggle.addEventListener('change', async () => {
  const store = await getStore();
  await saveSettings({ ...store.settings, darkMode: darkModeToggle.checked });
  document.body.classList.toggle('dark', darkModeToggle.checked);
});

smartSuggestionsToggle.addEventListener('change', async () => {
  const store = await getStore();
  await saveSettings({ ...store.settings, smartSuggestions: smartSuggestionsToggle.checked });
});

// ── Export / Import ───────────────────────────────────────────────────────────
exportBtn.addEventListener('click', async () => {
  const store = await getStore();
  const payload = { version: 1, shortcuts: Object.values(store.shortcuts), settings: store.settings };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  a.download = 'omnijump.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  let payload: { version?: number; shortcuts?: unknown[]; settings?: unknown };
  try {
    payload = JSON.parse(await file.text());
  } catch {
    dataStatusEl.textContent = 'Import failed — file is not valid JSON.';
    importFile.value = '';
    return;
  }
  if (!Array.isArray(payload?.shortcuts)) {
    dataStatusEl.textContent = 'Import failed — missing "shortcuts" array in file.';
    importFile.value = '';
    return;
  }
  // Apply settings first so maxShortcuts from the file is in effect.
  if (payload.settings) {
    try { await saveSettings(payload.settings as Parameters<typeof saveSettings>[0]); } catch { /* ignore */ }
  }
  // Write shortcuts directly, bypassing the limit check (restore operation).
  // The only hard cap is Chrome's 512-item storage limit.
  let imported = 0;
  let failed = 0;
  for (const s of payload.shortcuts) {
    try {
      const shortcut = s as Shortcut;
      const key = normalizeKey(shortcut.key);
      if (!key) throw new Error('Key is empty after normalization.');
      const normalized: Shortcut = { ...shortcut, key };
      if (normalized.type === 'bundle' && normalized.bundleUrls?.length) {
        normalized.url = normalized.bundleUrls[0];
      }
      await chrome.storage.sync.set({ [`${SHORTCUT_PREFIX}${key}`]: normalized });
      imported++;
    } catch (err) {
      failed++;
      console.error('Failed to import shortcut:', s, err);
    }
  }
  await refresh();
  dataStatusEl.textContent = failed > 0
    ? `Imported ${imported} shortcuts (${failed} failed — check console for details).`
    : `Imported ${imported} shortcuts.`;
  importFile.value = '';
});

// ── Keyboard navigation ───────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const inInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  if (inInput) return;

  const items = [...listEl.querySelectorAll<HTMLLIElement>('li:not([hidden])')];
  const focused = active instanceof HTMLLIElement ? active : null;
  const idx = focused ? items.indexOf(focused) : -1;
  const target = focused ?? hoveredRow;

  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    items[Math.min(Math.max(idx, -1) + 1, items.length - 1)]?.focus();
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[Math.max(idx - 1, 0)]?.focus();
  } else if ((e.key === 'Enter' || e.key === 'l') && target) {
    const url = target.dataset.url;
    if (url) chrome.tabs.update({ url });
  } else if (e.key === 'e' && target) {
    target.querySelector<HTMLButtonElement>('.btn-icon:not(.danger)')?.click();
  } else if ((e.key === 'd' || e.key === 'Delete') && target) {
    e.preventDefault();
    target.querySelector<HTMLButtonElement>('.btn-icon.danger')?.click();
  }
});

// ── Toggle close via keyboard shortcut ───────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'close-panel') {
    sendResponse({ closed: true });
    window.close();
  }
});

// ── Live sync ─────────────────────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (Object.keys(changes).some(k => k.startsWith(SHORTCUT_PREFIX) || k === SETTINGS_KEY)) {
    scheduleRefresh();
  }
});

// ── TIP suggestion ────────────────────────────────────────────────────────────
async function checkTipSuggestion(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab?.id) return;
  const r = await chrome.storage.session.get(`suggestion_${tab.id}`);
  const suggestion = r[`suggestion_${tab.id}`] as Suggestion | undefined;
  if (!suggestion) return;

  suggestionTextEl.textContent =
    `You often search ${suggestion.siteName}. Save "${suggestion.key}" as a shortcut?`;
  suggestionEl.hidden = false;
  redirectKeyInput.value = suggestion.key;
  redirectUrlInput.value = suggestion.url;

  const tabId = tab.id;
  saveSuggestionBtn.onclick = async () => {
    await upsertShortcut({ key: suggestion.key, url: suggestion.url, type: 'redirect' });
    await chrome.storage.session.remove(`suggestion_${tabId}`);
    await chrome.action.setBadgeText({ tabId, text: '' });
    suggestionEl.hidden = true;
    await refresh();
  };

  dismissSuggestionBtn.onclick = async () => {
    await chrome.storage.session.remove(`suggestion_${tabId}`);
    await chrome.action.setBadgeText({ tabId, text: '' });
    if (suggestion.host) {
      await addDismissedHost(suggestion.host);
    }
    suggestionEl.hidden = true;
  };
}

// ── Init ──────────────────────────────────────────────────────────────────────
redirectKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); redirectUrlInput.focus(); }
});
redirectUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveRedirectBtn.click(); }
});

chrome.runtime.sendMessage({ type: 'panel-opened' });
resetUrlList();

// Await refresh so shortcutCache is warm before initRedirectForm reads it,
// then share a single tab query between initRedirectForm and checkTipSuggestion.
(async () => {
  await refresh();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    initRedirectForm(tab);
    await checkTipSuggestion(tab);
  } catch { /* non-fatal */ }
  if (suggestionEl.hidden) redirectKeyInput.focus();
})();
