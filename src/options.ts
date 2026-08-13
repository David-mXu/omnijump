import './theme.css';
import { icon } from './icons';
import { IS_FIREFOX } from './platform';
import { DAILY_KEY, SETTINGS_KEY, SHORTCUT_PREFIX, addDismissedHost, clearAllStats, deleteShortcut, getStore, normalizeKey, saveSettings, upsertShortcut } from './storage';
import { buildShortcutRow, normalizeUrl } from './ui';
import { suggestKeyFromUrl, uniqueKey } from './suggest';
import { fuzzyFilter } from './fuzzy';
import { Shortcut, UserSettings } from './types';

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
const pickRedirectTabBtn = document.getElementById('pickRedirectTab') as HTMLButtonElement;
const redirectTabPickerEl = document.getElementById('redirectTabPicker') as HTMLDivElement;
const redirectTabPickListEl = document.getElementById('redirectTabPickList') as HTMLDivElement;
const cancelRedirectPickerBtn = document.getElementById('cancelRedirectPicker') as HTMLButtonElement;

// ── Settings panel ────────────────────────────────────────────────────────────
const weeklyChartEl = document.getElementById('weeklyChart') as HTMLDivElement;
const weekTotalEl = document.getElementById('weekTotal') as HTMLDivElement;
const clearStatsBtn = document.getElementById('clearStatsBtn') as HTMLButtonElement;
const clearStatsStatusEl = document.getElementById('clearStatsStatus') as HTMLDivElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
const importFile = document.getElementById('importFile') as HTMLInputElement;
const dataStatusEl = document.getElementById('dataStatus') as HTMLDivElement;
const shortcutPopupEl = document.getElementById('shortcutPopup') as HTMLSpanElement;
const shortcutPanelEl = document.getElementById('shortcutPanel') as HTMLSpanElement;
const customizeBtn = document.getElementById('customizeShortcut') as HTMLButtonElement;
if (IS_FIREFOX) customizeBtn.hidden = true;
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
let shortcutCache: Shortcut[] = [];
let settingsCache: UserSettings = { maxShortcuts: 500, filterThreshold: 25, darkMode: false, staleAutoDelete: true, staleDays: 90, smartSuggestions: false };

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

function renderSettings(): void {
  darkModeToggle.checked = settingsCache.darkMode ?? false;
  smartSuggestionsToggle.checked = settingsCache.smartSuggestions ?? false;
  staleToggle.checked = settingsCache.staleAutoDelete;
  staleDaysInput.value = String(settingsCache.staleDays);
  maxShortcutsInput.value = String(settingsCache.maxShortcuts);
  filterThresholdInput.value = String(settingsCache.filterThreshold);
}

async function refresh(): Promise<void> {
  const store = await getStore();
  shortcutCache = Object.values(store.shortcuts);
  settingsCache = { ...store.settings };
  document.body.classList.toggle('dark', settingsCache.darkMode);
  renderList();
  renderSettings();
}

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
  addRedirectStatusEl.className = type ? `form-status ${type}` : 'form-status';
}

let isSearchType = false;
searchToggleBtn.addEventListener('click', () => {
  isSearchType = !isSearchType;
  searchFieldsEl.hidden = !isSearchType;
  searchToggleBtn.textContent = isSearchType ? 'Remove search shortcut' : 'Make search shortcut';
});

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
      searchToggleBtn.textContent = 'Make search shortcut';
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
  removeBtn.setAttribute('aria-label', 'Remove URL');
  removeBtn.innerHTML = icon('close');
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

async function openRedirectTabPicker(): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const httpTabs = tabs.filter(t => t.url?.startsWith('http'));
  redirectTabPickListEl.innerHTML = '';
  if (httpTabs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = 'No open tabs found.';
    redirectTabPickListEl.appendChild(empty);
  } else {
    httpTabs.forEach(tab => {
      const row = document.createElement('div');
      row.className = 'tab-pick-row';

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

      row.append(favicon, title);
      row.addEventListener('click', () => {
        if (!tab.url) return;
        redirectUrlInput.value = tab.url;
        if (!redirectKeyInput.value) {
          const existingKeys = new Set(shortcutCache.map(s => s.key));
          const suggested = suggestKeyFromUrl(tab.url);
          if (suggested) redirectKeyInput.value = uniqueKey(suggested, existingKeys);
        }
        redirectTabPickerEl.hidden = true;
      });

      redirectTabPickListEl.appendChild(row);
    });
  }
  redirectTabPickerEl.hidden = false;
}

pickRedirectTabBtn.addEventListener('click', openRedirectTabPicker);
cancelRedirectPickerBtn.addEventListener('click', () => { redirectTabPickerEl.hidden = true; });

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
  bundleStatusEl.className = type ? `form-status ${type}` : 'form-status';
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
function renderWeeklyChart(counts: Record<string, number>): void {
  const last7 = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.now() - (6 - i) * 86_400_000).toISOString().slice(0, 10)
  );
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
}

clearStatsBtn.addEventListener('click', async () => {
  await clearAllStats();
  renderWeeklyChart({});
  clearStatsStatusEl.textContent = 'Stats cleared.';
  setTimeout(() => { clearStatsStatusEl.textContent = ''; }, 2000);
  await refresh();
});

tabSettingsBtn.addEventListener('click', async () => {
  showTab('settings');

  const [commands, store, localResult] = await Promise.all([
    chrome.commands.getAll(),
    getStore(),
    chrome.storage.local.get(DAILY_KEY),
  ]);

  const panelCmdName = IS_FIREFOX ? '_execute_sidebar_action' : 'open-side-panel';
  const panelCmd = commands.find((c) => c.name === panelCmdName);
  const popupCmd = commands.find((c) => c.name === '_execute_action');
  shortcutPanelEl.textContent = panelCmd?.shortcut || 'not set';
  shortcutPopupEl.textContent = popupCmd?.shortcut || 'not set';
  const firefoxHint = document.getElementById('firefoxShortcutHint');
  if (firefoxHint) firefoxHint.hidden = !IS_FIREFOX;

  settingsCache = { ...store.settings };
  renderSettings();

  settingsStatusEl.textContent = '';
  settingsStatusEl.className = '';
  filterThresholdStatusEl.textContent = '';
  filterThresholdStatusEl.className = '';
  staleStatusEl.textContent = '';
  staleStatusEl.className = '';

  const counts = (localResult[DAILY_KEY] ?? {}) as Record<string, number>;
  renderWeeklyChart(counts);

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
  await saveSettings({ ...settingsCache, maxShortcuts: value });
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
  await saveSettings({ ...settingsCache, filterThreshold: value });
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
  await saveSettings({ ...settingsCache, staleAutoDelete: staleToggle.checked, staleDays: days });
  staleStatusEl.textContent = 'Saved.';
  staleStatusEl.className = 'success';
});

darkModeToggle.addEventListener('change', async () => {
  await saveSettings({ ...settingsCache, darkMode: darkModeToggle.checked });
  document.body.classList.toggle('dark', darkModeToggle.checked);
});

smartSuggestionsToggle.addEventListener('change', async () => {
  await saveSettings({ ...settingsCache, smartSuggestions: smartSuggestionsToggle.checked });
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
  if (payload.settings && typeof payload.settings === 'object') {
    const raw = payload.settings as Record<string, unknown>;
    const sanitized: Partial<UserSettings> = {};
    if (typeof raw.maxShortcuts === 'number') sanitized.maxShortcuts = Math.min(500, Math.max(1, raw.maxShortcuts));
    if (typeof raw.filterThreshold === 'number') sanitized.filterThreshold = Math.min(500, Math.max(1, raw.filterThreshold));
    if (typeof raw.staleDays === 'number') sanitized.staleDays = Math.min(365, Math.max(7, raw.staleDays));
    if (typeof raw.staleAutoDelete === 'boolean') sanitized.staleAutoDelete = raw.staleAutoDelete;
    if (typeof raw.darkMode === 'boolean') sanitized.darkMode = raw.darkMode;
    if (typeof raw.smartSuggestions === 'boolean') sanitized.smartSuggestions = raw.smartSuggestions;
    if (Object.keys(sanitized).length > 0) {
      const store = await getStore();
      try { await saveSettings({ ...store.settings, ...sanitized }); } catch { /* ignore */ }
    }
  }
  let imported = 0;
  let failed = 0;
  for (const s of payload.shortcuts) {
    const shortcut = s as Shortcut;
    const key = normalizeKey(shortcut.key);
    if (!key) {
      failed++;
      console.error('Failed to import shortcut (empty key after normalization):', s);
      continue;
    }
    const normalized: Shortcut = { ...shortcut, key };
    if (normalized.bundleUrls && Array.isArray(normalized.bundleUrls)) {
      normalized.bundleUrls = normalized.bundleUrls
        .map((u) => (typeof u === 'string' ? normalizeUrl(u) : ''))
        .filter(Boolean);
    }
    if (normalized.type === 'bundle' && normalized.bundleUrls?.length) {
      normalized.url = normalized.bundleUrls[0];
    }
    normalized.url = typeof normalized.url === 'string' ? normalizeUrl(normalized.url) : '';
    if (normalized.urlTemplate && typeof normalized.urlTemplate === 'string') {
      normalized.urlTemplate = normalizeUrl(normalized.urlTemplate);
      if (!normalized.urlTemplate) {
        failed++;
        console.error('Failed to import shortcut (invalid urlTemplate after normalization):', s);
        continue;
      }
    }
    if (!normalized.url || (normalized.type === 'bundle' && (!normalized.bundleUrls || normalized.bundleUrls.length === 0))) {
      failed++;
      console.error('Failed to import shortcut (invalid or empty URL after normalization):', s);
      continue;
    }
    try {
      await chrome.storage.sync.set({ [`${SHORTCUT_PREFIX}${key}`]: normalized });
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('QUOTA_BYTES') || msg.toLowerCase().includes('quota')) {
        dataStatusEl.textContent = 'Storage quota exceeded — import stopped. Delete some shortcuts to free up space.';
        importFile.value = '';
        return;
      }
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

  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    items[Math.min(Math.max(idx, -1) + 1, items.length - 1)]?.focus();
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[Math.max(idx - 1, 0)]?.focus();
  } else if ((e.key === 'Enter' || e.key === 'l') && focused) {
    const url = focused.dataset.url;
    if (url) chrome.tabs.update({ url });
  } else if (e.key === 'e' && focused) {
    focused.querySelector<HTMLButtonElement>('.btn-icon:not(.danger)')?.click();
  } else if ((e.key === 'd' || e.key === 'Delete') && focused) {
    e.preventDefault();
    focused.querySelector<HTMLButtonElement>('.btn-icon.danger')?.click();
  }
});

// ── Live sync ─────────────────────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some(k => k.startsWith(SHORTCUT_PREFIX) || k === SETTINGS_KEY)) {
    scheduleRefresh();
  }
  if (area === 'local' && DAILY_KEY in changes && !panelSettings.hidden) {
    const counts = (changes[DAILY_KEY].newValue ?? {}) as Record<string, number>;
    renderWeeklyChart(counts);
  }
});

// ── Suggestion banner (shown when navigating from a page with a TIP) ──────────
async function checkTipSuggestion(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return;
    const r = await chrome.storage.session.get(`suggestion_${tab.id}`);
    const suggestion = r[`suggestion_${tab.id}`];
    if (!suggestion) return;
    suggestionTextEl.textContent =
      `You often visit ${suggestion.siteName}. Save "${suggestion.key}" as a shortcut?`;
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
  } catch { /* non-fatal */ }
}

// ── Redirect form Enter-key nav ───────────────────────────────────────────────
redirectKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); redirectUrlInput.focus(); }
});
redirectUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveRedirectBtn.click(); }
});

// ── Init ──────────────────────────────────────────────────────────────────────
resetUrlList();
(async () => {
  await refresh();
  await checkTipSuggestion();
  if (suggestionEl.hidden) redirectKeyInput.focus();
})();
