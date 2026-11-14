import './theme.css';
import { DNR_SKIPPED_KEY } from './dnr';
import { icon } from './icons';
import { IS_FIREFOX } from './platform';
import { DAILY_KEY, SETTINGS_KEY, SHORTCUT_PREFIX, addDismissedHost, bulkWriteShortcuts, clearAllStats, deleteShortcuts, getStore, normalizeKey, renameShortcut, restoreShortcuts, sanitizeShortcut, saveSettings, seedStarterShortcuts, upsertShortcut } from './storage';
import { buildShortcutRow, cancelPendingDelete, describeTarget, groupShortcuts, hasShortcutTargetCollision, hoveredRow, isRowEditing, normalizeUrl, openShortcut, pendingDeleteKey, renderOverwriteConfirm, savedStatusMessage, showToast, showUndoToast } from './ui';
import { deriveSearchFallbackUrl, suggestKeyFromUrl, uniqueKey, getUrlAncestors } from './suggest';
import { fuzzyFilter } from './fuzzy';
import { MAX_BUNDLE_URLS, MAX_IMPORT_FILE_BYTES, MAX_KEY_LENGTH, MAX_LABEL_LENGTH, MAX_PARAMETERIZED_KEY_LENGTH, MAX_URL_LENGTH, Shortcut, Suggestion, UserSettings } from './types';

export interface PanelControllerOptions {
  enableBackgroundPort?: boolean;
  enableActiveTabAutofill?: boolean;
  chartMaxHeightPx?: number;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function initPanelController(options: PanelControllerOptions = {}): void {
  const {
    enableBackgroundPort = false,
    enableActiveTabAutofill = false,
    chartMaxHeightPx = 38,
  } = options;

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
  const kbdHintsEl = document.getElementById('kbdHints') as HTMLDivElement;
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
  const saveBundleBtn = document.getElementById('saveBundle') as HTMLButtonElement;
  const cancelBundleEditBtn = document.getElementById('cancelBundleEdit') as HTMLButtonElement;
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
    tabShortcutsBtn.setAttribute('aria-selected', String(name === 'shortcuts'));
    tabBundleBtn.setAttribute('aria-selected', String(name === 'bundle'));
    tabSettingsBtn.setAttribute('aria-selected', String(name === 'settings'));
    // Roving tabindex: only the active tab is in the Tab order; arrow keys
    // move between tabs per the ARIA tabs pattern.
    tabShortcutsBtn.tabIndex = name === 'shortcuts' ? 0 : -1;
    tabBundleBtn.tabIndex = name === 'bundle' ? 0 : -1;
    tabSettingsBtn.tabIndex = name === 'settings' ? 0 : -1;
  }

  tabShortcutsBtn.addEventListener('click', () => showTab('shortcuts'));
  tabBundleBtn.addEventListener('click', () => showTab('bundle'));

  // ── Store cache + render ──────────────────────────────────────────────────────
  // shortcutCache / settingsCache hold the last-known store values.
  // refresh() reads storage and updates them; renderList() reads only the cache.
  // This means filter-input keystrokes never hit storage.
  let shortcutCache: Shortcut[] = [];
  let settingsCache: UserSettings = { maxShortcuts: 500, filterThreshold: 10, darkMode: false, staleAutoDelete: true, staleDays: 90, smartSuggestions: false };
  // Selection survives list re-renders (filtering, live sync); DOM checkboxes
  // do not, so the source of truth lives here.
  const selectedKeys = new Set<string>();
  // Keywords whose DNR rules Chrome rejected (rule budget / RE2 size). They
  // still redirect through the post-commit fallback.
  let skippedDnrKeys = new Set<string>();

  // Track what was auto-filled so we can detect user edits on tab switch
  let autofillKey = '';
  let autofillUrl = '';

  let isSearchType = false;
  function setSearchMode(enabled: boolean, focusTemplate = false): void {
    isSearchType = enabled;
    searchFieldsEl.hidden = !enabled;
    searchToggleBtn.classList.toggle('active', enabled);
    searchToggleBtn.setAttribute('aria-pressed', String(enabled));
    searchToggleBtn.textContent = enabled ? 'Remove search shortcut' : 'Make search shortcut';
    redirectUrlInput.placeholder = enabled ? 'https://... (optional fallback)' : 'https://...';
    if (enabled && focusTemplate) {
      redirectUrlTemplateInput.focus();
    }
  }

  function handleAlias(shortcut: Shortcut): void {
    showTab('shortcuts');
    if (shortcut.type === 'parameterized') {
      setSearchMode(true, false);
      redirectUrlInput.value = shortcut.url;
      redirectUrlTemplateInput.value = shortcut.urlTemplate ?? '';
    } else {
      setSearchMode(false, false);
      redirectUrlInput.value = shortcut.url;
      redirectUrlTemplateInput.value = '';
    }
    autofillUrl = shortcut.url;
    redirectKeyInput.value = '';
    autofillKey = '';
    setRedirectStatus('');
    renderRedirectUrlAncestors(shortcut.url);
    redirectKeyInput.focus();
    redirectKeyInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderList(): void {
    const query = filterInput.value.trim();
    filterInput.hidden = shortcutCache.length < settingsCache.filterThreshold && !query;

    const filtered = query ? fuzzyFilter(query, shortcutCache) : shortcutCache;

    countEl.textContent = `${shortcutCache.length} / ${settingsCache.maxShortcuts}`;
    countEl.title = skippedDnrKeys.size > 0
      ? `${skippedDnrKeys.size} shortcut${skippedDnrKeys.size === 1 ? '' : 's'} will redirect after the search page loads (no instant rule).`
      : '';

    const isEmpty = shortcutCache.length === 0;
    const noResults = !isEmpty && filtered.length === 0;
    emptyStateEl.hidden = !isEmpty;
    noResultsEl.hidden = !noResults;
    listEl.hidden = isEmpty || noResults;
    kbdHintsEl.hidden = isEmpty;

    const frag = document.createDocumentFragment();
    groupShortcuts(filtered).forEach(({ shortcut, isAlias }) =>
      frag.appendChild(buildShortcutRow(shortcut, refresh, handleAlias, isAlias, handleEditBundle))
    );
    listEl.replaceChildren(frag);
    // Re-apply selection to the new checkbox nodes and recompute the bulk
    // button, so it can never claim "Delete (2)" while zero rows are checked.
    listEl.querySelectorAll<HTMLInputElement>('.select-cb').forEach((cb) => {
      cb.checked = selectedKeys.has(cb.dataset.key ?? '');
    });
    updateDeleteSelectedButton();
  }

  function updateDeleteSelectedButton(): void {
    const count = selectedKeys.size;
    deleteSelectedBtn.hidden = count === 0;
    deleteSelectedBtn.textContent = `Delete (${count})`;
  }

  // A live-sync refresh must not overwrite a field the user is editing (or has
  // typed into but not saved). Each control is marked dirty on input/change and
  // cleared by its own save handler or when the Settings tab is opened.
  const dirtySettingsFields = new Set<HTMLElement>();
  for (const el of [maxShortcutsInput, filterThresholdInput, staleDaysInput, staleToggle, darkModeToggle, smartSuggestionsToggle]) {
    el.addEventListener('input', () => dirtySettingsFields.add(el));
    el.addEventListener('change', () => dirtySettingsFields.add(el));
  }

  function renderSettings(): void {
    if (!dirtySettingsFields.has(darkModeToggle)) darkModeToggle.checked = settingsCache.darkMode ?? false;
    if (!dirtySettingsFields.has(smartSuggestionsToggle)) smartSuggestionsToggle.checked = settingsCache.smartSuggestions ?? false;
    if (!dirtySettingsFields.has(staleToggle)) staleToggle.checked = settingsCache.staleAutoDelete;
    if (!dirtySettingsFields.has(staleDaysInput)) staleDaysInput.value = String(settingsCache.staleDays);
    if (!dirtySettingsFields.has(maxShortcutsInput)) maxShortcutsInput.value = String(settingsCache.maxShortcuts);
    if (!dirtySettingsFields.has(filterThresholdInput)) filterThresholdInput.value = String(settingsCache.filterThreshold);
  }

  // Keeps the list in sync for useCount/lastUsed-only writes (every shortcut
  // activation touches the record) without rebuilding hundreds of rows.
  function applyStatOnlyChanges(changes: Record<string, chrome.storage.StorageChange>): void {
    for (const [storageKey, change] of Object.entries(changes)) {
      if (!storageKey.startsWith(SHORTCUT_PREFIX)) continue;
      const next = change.newValue as Shortcut | undefined;
      if (!next) continue;
      const cached = shortcutCache.find((s) => s.key === next.key);
      if (cached) {
        cached.useCount = next.useCount;
        cached.lastUsed = next.lastUsed;
      }
      const row = listEl.querySelector<HTMLLIElement>(`li[data-key="${next.key}"]`);
      const stats = row?.querySelector<HTMLElement>('.stats');
      if (stats) {
        const parts: string[] = [];
        if (next.useCount) parts.push(`${next.useCount}×`);
        if (next.lastUsed) {
          const days = Math.floor((Date.now() - next.lastUsed) / 86_400_000);
          parts.push(days === 0 ? 'today' : `${days}d ago`);
        }
        stats.textContent = parts.join(' · ');
      }
    }
  }

  function isStatOnlyChange(changes: Record<string, chrome.storage.StorageChange>): boolean {
    const entries = Object.entries(changes).filter(([k]) => k.startsWith(SHORTCUT_PREFIX));
    if (entries.length === 0) return false;
    return entries.every(([, change]) => {
      const before = change.oldValue as Shortcut | undefined;
      const after = change.newValue as Shortcut | undefined;
      if (!before || !after) return false;
      const strip = (s: Shortcut) => {
        const { useCount: _useCount, lastUsed: _lastUsed, ...rest } = s;
        return JSON.stringify(rest);
      };
      return strip(before) === strip(after);
    });
  }

  async function refresh(): Promise<void> {
    const store = await getStore();
    try {
      const skipped = await chrome.storage.session.get(DNR_SKIPPED_KEY);
      skippedDnrKeys = new Set((skipped[DNR_SKIPPED_KEY] as string[] | undefined) ?? []);
    } catch {
      skippedDnrKeys = new Set();
    }
    // Most-used first, so the shortcuts people actually reach for stay on top.
    shortcutCache = Object.values(store.shortcuts).sort(
      (a, b) =>
        (b.useCount ?? 0) - (a.useCount ?? 0) ||
        (b.lastUsed ?? 0) - (a.lastUsed ?? 0) ||
        a.key.localeCompare(b.key)
    );
    settingsCache = { ...store.settings };
    applyDarkMode(settingsCache.darkMode ?? false);
    // A pending delete is only invalidated when the record is actually gone.
    // A live-sync refresh (e.g. a usage touch) must not cancel it.
    if (pendingDeleteKey && !shortcutCache.some((s) => s.key === pendingDeleteKey)) {
      cancelPendingDelete();
    }
    // Replacing the list while an inline editor is open would detach the
    // focused inputs and discard typed values. Defer the render until the
    // editor closes (its save/cancel path calls refresh()).
    if (!isRowEditing()) renderList();
    renderSettings();
  }

  // Batches rapid onChanged bursts (e.g. bulk delete) into a single refresh.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRefresh(): void {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(); }, 50);
  }

  // Coalesce keystrokes: a 500-row rebuild per character was 100-330 ms.
  let filterRenderTimer: ReturnType<typeof setTimeout> | null = null;
  filterInput.addEventListener('input', () => {
    // Small lists re-render instantly; the debounce only matters at the
    // hundreds-of-rows scale where each rebuild costs 100+ ms.
    if (shortcutCache.length < settingsCache.filterThreshold) {
      if (filterRenderTimer !== null) {
        clearTimeout(filterRenderTimer);
        filterRenderTimer = null;
      }
      renderList();
      return;
    }
    if (filterRenderTimer !== null) clearTimeout(filterRenderTimer);
    filterRenderTimer = setTimeout(() => {
      filterRenderTimer = null;
      renderList();
    }, 80);
  });

  // ── Multi-select ──────────────────────────────────────────────────────────────
  selectToggleBtn.addEventListener('click', () => {
    cancelPendingDelete();
    const entering = !listEl.classList.contains('selecting');
    listEl.classList.toggle('selecting', entering);
    selectToggleBtn.textContent = entering ? 'Cancel' : 'Select';
    selectedKeys.clear();
    deleteSelectedBtn.hidden = true;
    listEl.querySelectorAll<HTMLInputElement>('.select-cb').forEach(cb => { cb.checked = false; });
  });

  listEl.addEventListener('change', (event) => {
    const cb = event.target;
    if (cb instanceof HTMLInputElement && cb.classList.contains('select-cb')) {
      const key = cb.dataset.key ?? '';
      if (cb.checked) selectedKeys.add(key);
      else selectedKeys.delete(key);
    }
    updateDeleteSelectedButton();
  });

  deleteSelectedBtn.addEventListener('click', async () => {
    const keys = Array.from(selectedKeys);
    if (keys.length === 0) {
      deleteSelectedBtn.hidden = true;
      return;
    }
    const deleted = shortcutCache.filter(s => keys.includes(s.key));
    await deleteShortcuts(keys);
    selectedKeys.clear();
    listEl.classList.remove('selecting');
    selectToggleBtn.textContent = 'Select';
    deleteSelectedBtn.hidden = true;
    await refresh();
    showUndoToast(`Deleted ${deleted.length} shortcut${deleted.length === 1 ? '' : 's'}`, async () => {
      const result = await restoreShortcuts(deleted);
      await refresh();
      if (result.skipped.length > 0) {
        showToast(`Restored ${result.restored}; skipped ${result.skipped.length} — keyword already in use.`);
      }
    });
  });

  // ── Add Redirect form ─────────────────────────────────────────────────────────
  function setRedirectStatus(msg: string, type: 'error' | 'success' | '' = ''): void {
    addRedirectStatusEl.textContent = msg;
    addRedirectStatusEl.className = type ? `form-status ${type}` : 'form-status';
  }

  searchToggleBtn.addEventListener('click', () => {
    setSearchMode(!isSearchType, !isSearchType);
  });

  function renderRedirectUrlAncestors(url: string): void {
    const container = document.getElementById('redirectUrlAncestors') as HTMLDivElement | null;
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
        redirectUrlInput.value = ancestor;
        renderRedirectUrlAncestors(ancestor);
      });
      container.appendChild(btn);
    }
    container.hidden = container.children.length === 0;
  }

  redirectUrlInput.addEventListener('input', () => {
    const normalized = normalizeUrl(redirectUrlInput.value);
    renderRedirectUrlAncestors(normalized || redirectUrlInput.value);
  });
  redirectUrlInput.addEventListener('change', () => {
    const normalized = normalizeUrl(redirectUrlInput.value);
    renderRedirectUrlAncestors(normalized || redirectUrlInput.value);
  });

  function initRedirectForm(tab: chrome.tabs.Tab | undefined): void {
    if (!tab?.url || !/^https?:\/\//i.test(tab.url)) return;
    redirectUrlInput.value = tab.url;
    autofillUrl = tab.url;
    renderRedirectUrlAncestors(tab.url);
    const existingKeys = new Set(shortcutCache.map(s => s.key));
    const suggested = suggestKeyFromUrl(tab.url);
    if (suggested) {
      redirectKeyInput.value = uniqueKey(suggested, existingKeys);
      autofillKey = redirectKeyInput.value;
    }
  }

  async function persistRedirect(candidate: Shortcut): Promise<void> {
    const { key } = candidate;
    const totalAfter = shortcutCache.some(s => s.key === key)
      ? shortcutCache.length
      : shortcutCache.length + 1;

    try {
      await upsertShortcut(candidate);
      setRedirectStatus(savedStatusMessage(key, totalAfter), 'success');
      redirectKeyInput.value = '';
      redirectUrlInput.value = '';
      redirectUrlTemplateInput.value = '';
      autofillKey = '';
      autofillUrl = '';
      renderRedirectUrlAncestors('');
      setSearchMode(false, false);
      await refresh();
    } catch (err) {
      setRedirectStatus((err as Error).message, 'error');
    }
  }

  saveRedirectBtn.addEventListener('click', async () => {
    const key = normalizeKey(redirectKeyInput.value);

    if (!key) { setRedirectStatus('Enter a keyword.', 'error'); return; }
    const maxKeyLength = isSearchType ? MAX_PARAMETERIZED_KEY_LENGTH : MAX_KEY_LENGTH;
    if (key.length > maxKeyLength) {
      setRedirectStatus(`Keyword is too long (max ${maxKeyLength} characters for this shortcut type).`, 'error');
      return;
    }

    let candidate: Shortcut;
    if (isSearchType) {
      const rawTemplate = redirectUrlTemplateInput.value.trim();
      if (!rawTemplate.includes('%s')) {
        setRedirectStatus('Search URL must include %s.', 'error');
        return;
      }
      if (rawTemplate.length > MAX_URL_LENGTH) {
        setRedirectStatus(`Search URL is too long (max ${MAX_URL_LENGTH} characters).`, 'error');
        return;
      }
      const urlTemplate = normalizeUrl(rawTemplate);
      if (!urlTemplate) {
        setRedirectStatus('Enter a valid http(s) search URL template.', 'error');
        return;
      }
      const rawFallback = redirectUrlInput.value.trim();
      if (rawFallback.length > MAX_URL_LENGTH) {
        setRedirectStatus(`Fallback URL is too long (max ${MAX_URL_LENGTH} characters).`, 'error');
        return;
      }
      let normalizedFallback: string | undefined;
      if (rawFallback) {
        const nf = normalizeUrl(rawFallback);
        if (!nf) {
          setRedirectStatus('Enter a valid http(s) fallback URL.', 'error');
          return;
        }
        normalizedFallback = nf;
      }
      const fallbackUrl = deriveSearchFallbackUrl(urlTemplate, normalizedFallback);
      if (!fallbackUrl) {
        setRedirectStatus('Enter a valid http(s) search URL template.', 'error');
        return;
      }
      candidate = { key, url: fallbackUrl, urlTemplate, type: 'parameterized' };
    } else {
      if (redirectUrlInput.value.trim().length > MAX_URL_LENGTH) {
        setRedirectStatus(`URL is too long (max ${MAX_URL_LENGTH} characters).`, 'error');
        return;
      }
      const url = normalizeUrl(redirectUrlInput.value);
      if (!url) {
        setRedirectStatus('Enter a valid http(s) URL.', 'error');
        return;
      }
      candidate = { key, url, type: 'redirect' };
    }

    // The keyword is taken and points elsewhere: ask instead of silently clobbering.
    const existing = shortcutCache.find(s => s.key === key);
    if (hasShortcutTargetCollision(existing, candidate) && existing) {
      const alt = uniqueKey(key, new Set(shortcutCache.map(s => s.key)));
      renderOverwriteConfirm(
        addRedirectStatusEl,
        existing,
        alt,
        () => void persistRedirect(candidate),
        (altKey) => void persistRedirect({ ...candidate, key: altKey }),
      );
      return;
    }

    await persistRedirect(candidate);
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

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.title = 'Drag to reorder, or press Alt+ArrowUp/Down in a URL field';
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = icon('drag', 14);
    handle.addEventListener('mousedown', () => { row.draggable = true; });
    handle.addEventListener('mouseup', () => { row.draggable = false; });

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'url-input';
    input.placeholder = 'google.com or https://...';
    input.setAttribute('aria-label', 'Bundle URL');
    input.title = 'Alt+ArrowUp/Down to reorder';
    input.value = value;
    // Keyboard alternative to pointer-only drag-and-drop.
    input.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const sibling = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling) return;
      e.preventDefault();
      if (e.key === 'ArrowUp') urlListEl.insertBefore(row, sibling);
      else urlListEl.insertBefore(sibling, row);
      input.focus();
      setBundleStatus(`Moved URL ${e.key === 'ArrowUp' ? 'up' : 'down'}.`);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-url';
    removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', 'Remove URL');
    removeBtn.innerHTML = icon('close');
    removeBtn.addEventListener('click', () => row.remove());

    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      row.draggable = false;
    });

    row.append(handle, input, removeBtn);
    urlListEl.appendChild(row);
  }

  function removeBlankUrlRows(): void {
    urlListEl.querySelectorAll<HTMLInputElement>('input.url-input').forEach((inp) => {
      if (!inp.value.trim()) {
        inp.closest('.url-row')?.remove();
      }
    });
  }

  function resetUrlList(): void {
    urlListEl.innerHTML = '';
    addUrlRow();
    addUrlRow();
  }

  addUrlBtn.addEventListener('click', () => addUrlRow());

  async function addAllOpenTabs(): Promise<void> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const urls = tabs.map(t => t.url ?? '').filter(u => /^https?:\/\//i.test(u));
    if (urls.length === 0) return;
    urlListEl.innerHTML = '';
    urls.forEach(url => addUrlRow(url));
    if (!bundleKeyInput.value && urls[0]) {
      try {
        const host = new URL(urls[0]).hostname.replace(/^www\./, '');
        bundleKeyInput.value = host.split('.')[0];
      } catch { /* ignore */ }
    }
  }

  // Disclosure helpers for the tab/shortcut pickers: keep aria-expanded in
  // sync and return focus to the trigger when a panel closes.
  function setPickerState(trigger: HTMLButtonElement, panel: HTMLElement, open: boolean): void {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (!open && document.contains(trigger)) trigger.focus();
  }

  async function openTabPicker(): Promise<void> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const httpTabs = tabs.filter(t => t.url && /^https?:\/\//i.test(t.url));
    tabPickListEl.innerHTML = '';
    if (httpTabs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'picker-empty';
      empty.textContent = 'No open tabs found.';
      tabPickListEl.appendChild(empty);
    } else {
      httpTabs.forEach(tab => {
        const label = document.createElement('label');
        label.className = 'tab-pick-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'tab-pick-cb';
        cb.value = tab.url!;

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
    }
    setPickerState(pickTabsBtn, tabPickerEl, true);
  }

  addAllTabsBtn.addEventListener('click', addAllOpenTabs);
  pickTabsBtn.addEventListener('click', () => { setPickerState(pickShortcutsBtn, shortcutPickerEl, false); void openTabPicker(); });
  cancelPickerBtn.addEventListener('click', () => { setPickerState(pickTabsBtn, tabPickerEl, false); });

  async function openRedirectTabPicker(): Promise<void> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const httpTabs = tabs.filter(t => t.url && /^https?:\/\//i.test(t.url));
    redirectTabPickListEl.innerHTML = '';
    if (httpTabs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'picker-empty';
      empty.textContent = 'No open tabs found.';
      redirectTabPickListEl.appendChild(empty);
    } else {
      httpTabs.forEach(tab => {
        const row = document.createElement('div');
        row.className = 'tab-pick-row';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');

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

        const selectTab = () => {
          if (!tab.url) return;
          redirectUrlInput.value = tab.url;
          autofillUrl = tab.url;
          const existingKeys = new Set(shortcutCache.map(s => s.key));
          const suggested = suggestKeyFromUrl(tab.url);
          if (suggested && (!redirectKeyInput.value || redirectKeyInput.value === autofillKey)) {
            redirectKeyInput.value = uniqueKey(suggested, existingKeys);
            autofillKey = redirectKeyInput.value;
          }
          renderRedirectUrlAncestors(tab.url);
          setPickerState(pickRedirectTabBtn, redirectTabPickerEl, false);
        };

        row.append(favicon, title);
        row.addEventListener('click', selectTab);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectTab();
          }
        });

        redirectTabPickListEl.appendChild(row);
      });
    }
    setPickerState(pickRedirectTabBtn, redirectTabPickerEl, true);
  }

  pickRedirectTabBtn.addEventListener('click', () => { void openRedirectTabPicker(); });
  cancelRedirectPickerBtn.addEventListener('click', () => { setPickerState(pickRedirectTabBtn, redirectTabPickerEl, false); });

  useSelectedTabsBtn.addEventListener('click', () => {
    const urls = Array.from(tabPickListEl.querySelectorAll<HTMLInputElement>('.tab-pick-cb:checked'))
      .map(cb => cb.value)
      .filter(Boolean);
    if (urls.length > 0) {
      removeBlankUrlRows();
      urls.forEach(url => addUrlRow(url));
    }
    setPickerState(pickTabsBtn, tabPickerEl, false);
  });

  function openShortcutPicker(): void {
    const candidates = shortcutCache.filter(s => s.type !== 'bundle');
    shortcutPickListEl.innerHTML = '';
    if (candidates.length === 0) {
      const empty = document.createElement('p');
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
    setPickerState(pickShortcutsBtn, shortcutPickerEl, true);
  }

  pickShortcutsBtn.addEventListener('click', () => { setPickerState(pickTabsBtn, tabPickerEl, false); openShortcutPicker(); });
  cancelShortcutPickerBtn.addEventListener('click', () => { setPickerState(pickShortcutsBtn, shortcutPickerEl, false); });

  useSelectedShortcutsBtn.addEventListener('click', () => {
    const urls = Array.from(shortcutPickListEl.querySelectorAll<HTMLInputElement>('.shortcut-pick-cb:checked'))
      .map(cb => cb.value)
      .filter(Boolean);
    if (urls.length > 0) {
      removeBlankUrlRows();
      urls.forEach(url => addUrlRow(url));
    }
    setPickerState(pickShortcutsBtn, shortcutPickerEl, false);
  });

  function setBundleStatus(msg: string, type: 'error' | 'success' | '' = ''): void {
    bundleStatusEl.textContent = msg;
    bundleStatusEl.className = type ? `form-status ${type}` : 'form-status';
  }

  // ── Bundle editing ────────────────────────────────────────────────────────────
  // A bundle's URLs can only be changed here, so "Edit" on a bundle row loads it
  // into this form instead of the inline key/label editor.
  let editingBundleKey: string | null = null;

  function exitBundleEditMode(): void {
    editingBundleKey = null;
    saveBundleBtn.textContent = 'Save bundle';
    cancelBundleEditBtn.hidden = true;
  }

  function handleEditBundle(shortcut: Shortcut): void {
    showTab('bundle');
    editingBundleKey = shortcut.key;
    bundleKeyInput.value = shortcut.key;
    bundleLabelInput.value = shortcut.label ?? '';
    urlListEl.innerHTML = '';
    (shortcut.bundleUrls?.length ? shortcut.bundleUrls : [shortcut.url]).forEach(u => addUrlRow(u));
    saveBundleBtn.textContent = 'Update bundle';
    cancelBundleEditBtn.hidden = false;
    setBundleStatus(`Editing bundle "${shortcut.key}".`);
    bundleKeyInput.focus();
  }

  cancelBundleEditBtn.addEventListener('click', () => {
    exitBundleEditMode();
    bundleForm.reset();
    resetUrlList();
    setBundleStatus('');
  });

  async function persistBundle(
    key: string,
    label: string | undefined,
    urls: string[],
    original: Shortcut | undefined,
  ): Promise<void> {
    try {
      if (original && original.key !== key) {
        // Rename: write-new-then-remove-old so a failure can't lose the bundle.
        await renameShortcut(original.key, { ...original, key, label, url: urls[0], bundleUrls: urls });
      } else if (original) {
        await upsertShortcut({ ...original, key, label, url: urls[0], bundleUrls: urls });
      } else {
        await upsertShortcut({ key, url: urls[0], type: 'bundle', bundleUrls: urls, label });
      }
      setBundleStatus(original ? `Bundle "${key}" updated.` : `Bundle "${key}" saved.`, 'success');
      exitBundleEditMode();
      bundleForm.reset();
      resetUrlList();
      await refresh();
    } catch (err) {
      setBundleStatus((err as Error).message, 'error');
    }
  }

  bundleForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const key = normalizeKey(bundleKeyInput.value);
    const label = bundleLabelInput.value.trim() || undefined;
    const rawUrls = Array.from(urlListEl.querySelectorAll<HTMLInputElement>('input.url-input'))
      .map((i) => i.value.trim())
      .filter(Boolean);
    const urls = rawUrls.map((u) => normalizeUrl(u)).filter(Boolean);

    if (!key) { setBundleStatus('Enter a keyword.', 'error'); return; }
    if (key.length > MAX_KEY_LENGTH) {
      setBundleStatus(`Keyword is too long (max ${MAX_KEY_LENGTH} characters).`, 'error');
      return;
    }
    if (label && label.length > MAX_LABEL_LENGTH) {
      setBundleStatus(`Label is too long (max ${MAX_LABEL_LENGTH} characters).`, 'error');
      return;
    }
    if (rawUrls.length > MAX_BUNDLE_URLS) {
      setBundleStatus(`A bundle can hold at most ${MAX_BUNDLE_URLS} URLs (remove ${rawUrls.length - MAX_BUNDLE_URLS}).`, 'error');
      return;
    }
    if (rawUrls.some((u) => u.length > MAX_URL_LENGTH)) {
      setBundleStatus(`A bundle URL is too long (max ${MAX_URL_LENGTH} characters).`, 'error');
      return;
    }
    if (urls.length < 2) { setBundleStatus('Add at least 2 valid http(s) URLs.', 'error'); return; }

    const original = editingBundleKey
      ? shortcutCache.find(s => s.key === editingBundleKey)
      : undefined;

    const collides = shortcutCache.find(s => s.key === key && s.key !== editingBundleKey);
    if (collides) {
      if (original) {
        // Renaming an existing bundle onto another shortcut's keyword.
        setBundleStatus(`"${key}" is already used by another shortcut.`, 'error');
        return;
      }
      const alt = uniqueKey(key, new Set(shortcutCache.map(s => s.key)));
      renderOverwriteConfirm(
        bundleStatusEl,
        collides,
        alt,
        () => void persistBundle(key, label, urls, undefined),
        (altKey) => void persistBundle(altKey, label, urls, undefined),
      );
      return;
    }

    await persistBundle(key, label, urls, original);
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
      const count = counts[date] ?? 0;
      const col = document.createElement('div');
      col.className = 'week-col';

      const bar = document.createElement('div');
      bar.className = 'week-bar';
      bar.style.height = `${count > 0 ? Math.max(4, Math.round((count / max) * chartMaxHeightPx)) : 2}px`;
      const label = `${date}: ${count} open${count === 1 ? '' : 's'}`;
      bar.title = label;
      bar.setAttribute('aria-label', label);

      const dayEl = document.createElement('span');
      dayEl.className = 'week-day';
      const dayIdx = new Date(`${date}T00:00:00Z`).getUTCDay();
      dayEl.textContent = DAY_LETTERS[dayIdx] ?? '';

      col.append(bar, dayEl);
      weeklyChartEl.appendChild(col);
    });
    weekTotalEl.textContent = `${weekTotal} shortcut open${weekTotal !== 1 ? 's' : ''} this week`;
  }

  clearStatsBtn.addEventListener('click', async () => {
    await clearAllStats();
    renderWeeklyChart({});
    clearStatsStatusEl.textContent = 'Stats cleared.';
    clearStatsStatusEl.className = 'form-status success';
    setTimeout(() => {
      clearStatsStatusEl.textContent = '';
      clearStatsStatusEl.className = 'form-status';
    }, 2000);
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
    dirtySettingsFields.clear();
    renderSettings();

    settingsStatusEl.textContent = '';
    settingsStatusEl.className = 'form-status';
    filterThresholdStatusEl.textContent = '';
    filterThresholdStatusEl.className = 'form-status';
    staleStatusEl.textContent = '';
    staleStatusEl.className = 'form-status';

    // Weekly usage chart
    const counts = (localResult[DAILY_KEY] ?? {}) as Record<string, number>;
    renderWeeklyChart(counts);

    dataStatusEl.textContent = '';
    dataStatusEl.className = 'form-status';
  });

  customizeBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  saveMaxBtn.addEventListener('click', async () => {
    const value = parseInt(maxShortcutsInput.value, 10);
    if (!value || value < 1 || value > 500) {
      settingsStatusEl.textContent = 'Enter a number between 1 and 500.';
      settingsStatusEl.className = 'form-status error';
      return;
    }
    settingsCache = { ...settingsCache, maxShortcuts: value };
    dirtySettingsFields.delete(maxShortcutsInput);
    await saveSettings(settingsCache);
    settingsStatusEl.textContent = 'Saved.';
    settingsStatusEl.className = 'form-status success';
  });

  maxShortcutsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveMaxBtn.click(); }
  });

  saveFilterThresholdBtn.addEventListener('click', async () => {
    const value = parseInt(filterThresholdInput.value, 10);
    if (!value || value < 1 || value > 500) {
      filterThresholdStatusEl.textContent = 'Enter a number between 1 and 500.';
      filterThresholdStatusEl.className = 'form-status error';
      return;
    }
    settingsCache = { ...settingsCache, filterThreshold: value };
    dirtySettingsFields.delete(filterThresholdInput);
    await saveSettings(settingsCache);
    filterThresholdStatusEl.textContent = 'Saved.';
    filterThresholdStatusEl.className = 'form-status success';
  });

  filterThresholdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveFilterThresholdBtn.click(); }
  });

  saveStaleBtn.addEventListener('click', async () => {
    const days = parseInt(staleDaysInput.value, 10);
    if (!days || days < 7 || days > 365) {
      staleStatusEl.textContent = 'Enter a number between 7 and 365.';
      staleStatusEl.className = 'form-status error';
      return;
    }
    settingsCache = { ...settingsCache, staleAutoDelete: staleToggle.checked, staleDays: days };
    dirtySettingsFields.delete(staleToggle);
    dirtySettingsFields.delete(staleDaysInput);
    await saveSettings(settingsCache);
    staleStatusEl.textContent = 'Saved.';
    staleStatusEl.className = 'form-status success';
  });

  staleToggle.addEventListener('change', () => {
    saveStaleBtn.click();
  });
  staleDaysInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveStaleBtn.click(); }
  });

  darkModeToggle.addEventListener('change', async () => {
    settingsCache = { ...settingsCache, darkMode: darkModeToggle.checked };
    dirtySettingsFields.delete(darkModeToggle);
    await saveSettings(settingsCache);
    applyDarkMode(darkModeToggle.checked);
  });

  smartSuggestionsToggle.addEventListener('change', async () => {
    settingsCache = { ...settingsCache, smartSuggestions: smartSuggestionsToggle.checked };
    dirtySettingsFields.delete(smartSuggestionsToggle);
    await saveSettings(settingsCache);
  });

  // ── Export / Import ───────────────────────────────────────────────────────────
  exportBtn.addEventListener('click', async () => {
    const [store, localResult] = await Promise.all([
      getStore(),
      chrome.storage.local.get(DAILY_KEY),
    ]);
    const dailyCounts = (localResult[DAILY_KEY] ?? {}) as Record<string, number>;
    const payload = { version: 1, shortcuts: Object.values(store.shortcuts), settings: store.settings, dailyCounts };
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
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      dataStatusEl.textContent = `Import failed — file is too large (max ${Math.round(MAX_IMPORT_FILE_BYTES / 1048576)} MB).`;
      dataStatusEl.className = 'form-status error';
      importFile.value = '';
      return;
    }
    let payload: { version?: number; shortcuts?: unknown[]; settings?: unknown; dailyCounts?: unknown };
    try {
      payload = JSON.parse(await file.text());
    } catch {
      dataStatusEl.textContent = 'Import failed — file is not valid JSON.';
      dataStatusEl.className = 'form-status error';
      importFile.value = '';
      return;
    }
    if (!Array.isArray(payload?.shortcuts)) {
      dataStatusEl.textContent = 'Import failed — missing "shortcuts" array in file.';
      dataStatusEl.className = 'form-status error';
      importFile.value = '';
      return;
    }
    // Only preference settings are imported: behavior-changing toggles
    // (smartSuggestions, staleAutoDelete, staleDays) are skipped on purpose
    // so a shared shortcut file can't silently weaken privacy or cleanup
    // protections for the person importing it.
    // Settings are parsed here but committed only inside finishImport(), after
    // the user resolves collisions. Writing them earlier (a) applied changes on
    // Cancel and (b) on a first-ever settings write triggered stale cleanup,
    // which could delete the very record the collision check below protects.
    let pendingSettings: Partial<UserSettings> | null = null;
    if (payload.settings && typeof payload.settings === 'object') {
      const raw = payload.settings as Record<string, unknown>;
      const sanitized: Partial<UserSettings> = {};
      if (typeof raw.maxShortcuts === 'number' && Number.isFinite(raw.maxShortcuts)) {
        sanitized.maxShortcuts = Math.min(500, Math.max(1, Math.round(raw.maxShortcuts)));
      }
      if (typeof raw.filterThreshold === 'number' && Number.isFinite(raw.filterThreshold)) {
        sanitized.filterThreshold = Math.min(500, Math.max(1, Math.round(raw.filterThreshold)));
      }
      if (typeof raw.darkMode === 'boolean') sanitized.darkMode = raw.darkMode;
      if (Object.keys(sanitized).length > 0) pendingSettings = sanitized;
    }
    // Parse and validate every entry before ANY shortcut write happens: a
    // rejected entry can never partially corrupt the store, and collision
    // checks run against a complete, validated write set.
    const now = Date.now();
    const seenKeys = new Set<string>();
    const writes: Record<string, Shortcut> = {};
    let failed = 0;
    payload.shortcuts.forEach((s, index) => {
      const result = sanitizeShortcut(s, now);
      if (!result.ok) {
        failed++;
        const rawKey = (s as { key?: unknown } | null)?.key;
        console.error(
          `Failed to import shortcut #${index}${typeof rawKey === 'string' ? ` (key "${rawKey}")` : ''}: ${result.reason}`,
        );
        return;
      }
      const { key } = result.shortcut;
      if (seenKeys.has(key)) {
        failed++;
        console.error(`Failed to import shortcut #${index} (key "${key}"): duplicate key in file, first entry wins.`);
        return;
      }
      seenKeys.add(key);
      writes[`${SHORTCUT_PREFIX}${key}`] = result.shortcut;
    });

    const importDailyCounts = async (): Promise<void> => {
      if (!payload.dailyCounts || typeof payload.dailyCounts !== 'object' || Array.isArray(payload.dailyCounts)) return;
      const raw = payload.dailyCounts as Record<string, unknown>;
      const sanitized: Record<string, number> = {};
      for (const [date, count] of Object.entries(raw)) {
        if (
          typeof count === 'number' &&
          Number.isFinite(count) &&
          count >= 0 &&
          /^\d{4}-\d{2}-\d{2}$/.test(date)
        ) {
          sanitized[date] = Math.floor(count);
        }
      }
      if (Object.keys(sanitized).length > 0) {
        try { await chrome.storage.local.set({ [DAILY_KEY]: sanitized }); } catch { /* non-fatal */ }
      }
    };

    const finishImport = async (
      chosenWrites: Record<string, Shortcut>,
      replaced: number,
      skippedExisting: number,
    ): Promise<void> => {
      const currentStore = await getStore();
      const cap = currentStore.settings.maxShortcuts;
      const currentCount = Object.keys(currentStore.shortcuts).length;
      let newSlots = Math.max(0, cap - currentCount);
      const withinCap: Record<string, Shortcut> = {};
      let skippedOverCap = 0;
      for (const [storageKey, shortcut] of Object.entries(chosenWrites)) {
        if (Object.prototype.hasOwnProperty.call(currentStore.shortcuts, shortcut.key)) {
          withinCap[storageKey] = shortcut;
        } else if (newSlots > 0) {
          withinCap[storageKey] = shortcut;
          newSlots--;
        } else {
          skippedOverCap++;
        }
      }
      const count = Object.keys(withinCap).length;
      if (count > 0) {
        // Single batched write: one storage operation regardless of size, so
        // a large import can't trip chrome.storage.sync's per-minute quota.
        try {
          await bulkWriteShortcuts(withinCap);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          dataStatusEl.textContent = /quota/i.test(msg)
            ? `Import failed — ${msg}`
            : `Import failed: ${msg}`;
          dataStatusEl.className = 'form-status error';
          importFile.value = '';
          return;
        }
      }
      // Apply imported preferences only after the shortcut write succeeds; a
      // Cancel never reaches this function, so it stays a true no-op.
      if (pendingSettings) {
        try {
          const refreshed = await getStore();
          await saveSettings({ ...refreshed.settings, ...pendingSettings });
        } catch { /* non-fatal */ }
      }
      await importDailyCounts();
      await refresh();
      const notes: string[] = [];
      if (replaced > 0) notes.push(`replaced ${replaced} existing`);
      if (skippedExisting > 0) notes.push(`kept ${skippedExisting} existing`);
      if (skippedOverCap > 0) notes.push(`${skippedOverCap} skipped over the ${cap} shortcut limit`);
      if (failed > 0) notes.push(`${failed} failed — check console for details`);
      dataStatusEl.textContent = notes.length > 0
        ? `Imported ${count} shortcuts (${notes.join('; ')}).`
        : `Imported ${count} shortcuts.`;
      dataStatusEl.className = failed > 0 && count === 0 ? 'form-status error' : 'form-status success';
      importFile.value = '';
    };

    const imported = Object.keys(writes).length;

    // Collision guard: imported keywords that already exist are never
    // silently overwritten. Interactive saves enforce an overwrite confirm;
    // import must too — otherwise a shared shortcut file could repoint a
    // trusted keyword (mail → a lookalike host) the moment it's imported.
    const existingStore = await getStore();
    const collidingKeys = Object.values(writes)
      .map((s) => s.key)
      .filter((k) => Object.prototype.hasOwnProperty.call(existingStore.shortcuts, k));

    if (imported > 0 && collidingKeys.length > 0) {
      dataStatusEl.className = 'form-status';
      dataStatusEl.textContent = '';

      // Show the record's actual destination. For parameterized shortcuts that
      // is the template (not the fallback URL) and for bundles every tab, so a
      // shared file cannot hide an attacker template behind a trusted host.
      const hostOf = (key: string): string => {
        const sc = writes[`${SHORTCUT_PREFIX}${key}`];
        return sc ? describeTarget(sc) : 'a new target';
      };
      const shown = collidingKeys.slice(0, 6);

      const text = document.createElement('span');
      text.textContent =
        `${collidingKeys.length} imported keyword${collidingKeys.length === 1 ? '' : 's'} ` +
        `would replace existing ones: ${shown.map((k) => `"${k}" → ${hostOf(k)}`).join(', ')}` +
        (collidingKeys.length > shown.length ? ` +${collidingKeys.length - shown.length} more` : '') +
        '. ';

      const makeChoiceButton = (label: string, onClick: () => Promise<void>): HTMLButtonElement => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-link confirm-overwrite';
        btn.textContent = label;
        btn.addEventListener('click', () => {
          void onClick().catch((err) => {
            console.error('OmniJump: import failed', err);
            dataStatusEl.textContent = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
            dataStatusEl.className = 'form-status error';
          });
        });
        return btn;
      };

      dataStatusEl.append(
        text,
        makeChoiceButton('Overwrite all', () => finishImport(writes, collidingKeys.length, 0)),
        document.createTextNode(' · '),
        makeChoiceButton('Skip existing', () => {
          const kept: Record<string, Shortcut> = {};
          for (const [storageKey, shortcut] of Object.entries(writes)) {
            if (!Object.prototype.hasOwnProperty.call(existingStore.shortcuts, shortcut.key)) {
              kept[storageKey] = shortcut;
            }
          }
          return finishImport(kept, 0, collidingKeys.length);
        }),
        document.createTextNode(' · '),
        makeChoiceButton('Cancel', async () => {
          dataStatusEl.textContent = 'Import cancelled.';
          dataStatusEl.className = 'form-status';
          importFile.value = '';
        }),
      );
      return;
    }

    await finishImport(writes, 0, 0);
  });

  const loadStarterBtn = document.getElementById('loadStarterBtn') as HTMLButtonElement | null;
  const loadStarterSettingsBtn = document.getElementById('loadStarterSettingsBtn') as HTMLButtonElement | null;

  async function handleLoadStarter(): Promise<void> {
    const added = await seedStarterShortcuts(false);
    const msg = added === 0
      ? 'All starter shortcuts are already added.'
      : `Added ${added} starter shortcut${added === 1 ? '' : 's'}.`;
    dataStatusEl.textContent = msg;
    dataStatusEl.className = 'form-status success';
    if (panelShortcuts && !panelShortcuts.hidden) {
      setRedirectStatus(msg, 'success');
    }
    await refresh();
  }

  loadStarterBtn?.addEventListener('click', handleLoadStarter);
  loadStarterSettingsBtn?.addEventListener('click', handleLoadStarter);

  // ── Keyboard navigation ───────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      let handled = false;
      if (pendingDeleteKey) {
        cancelPendingDelete();
        handled = true;
      }
      if (!tabPickerEl.hidden) {
        setPickerState(pickTabsBtn, tabPickerEl, false);
        handled = true;
      }
      if (!redirectTabPickerEl.hidden) {
        setPickerState(pickRedirectTabBtn, redirectTabPickerEl, false);
        handled = true;
      }
      if (!shortcutPickerEl.hidden) {
        setPickerState(pickShortcutsBtn, shortcutPickerEl, false);
        handled = true;
      }
      if (!handled && !panelBundle.hidden && !cancelBundleEditBtn.hidden) {
        cancelBundleEditBtn.click();
        handled = true;
      }
      if (handled) return;
    }

    // ARIA tabs keyboard pattern. Reaching this point means the target is not
    // an input; handle tabs before the shortcut-list j/k/arrow handler.
    const tabTarget = e.target instanceof HTMLElement ? e.target.closest<HTMLButtonElement>('[role="tab"]') : null;
    if (tabTarget) {
      const tabs = [tabShortcutsBtn, tabBundleBtn, tabSettingsBtn];
      const idx = tabs.indexOf(tabTarget);
      if (idx >= 0 && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const next = e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? tabs.length - 1
            : (idx + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        const target = tabs[next]!;
        target.focus();
        if (target === tabShortcutsBtn) showTab('shortcuts');
        else if (target === tabBundleBtn) showTab('bundle');
        else tabSettingsBtn.click();
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (panelShortcuts.hidden) return;

    const active = document.activeElement;
    const inInput =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement;
    if (inInput) return;

    const items = [...listEl.querySelectorAll<HTMLLIElement>('li:not([hidden])')];
    const focused = active instanceof HTMLLIElement ? active : null;
    const idx = focused ? items.indexOf(focused) : -1;
    const onInteractive =
      active instanceof HTMLButtonElement ||
      active instanceof HTMLAnchorElement ||
      active instanceof HTMLSelectElement ||
      Boolean((active as HTMLElement | null)?.closest('button, a[href], select, .tab-pick-row'));
    const target = focused ?? (onInteractive ? null : hoveredRow);
    const isSelecting = listEl.classList.contains('selecting');

    if (e.key === 'j' || e.key === 'ArrowDown') {
      if (pendingDeleteKey) cancelPendingDelete();
      e.preventDefault();
      items[Math.min(Math.max(idx, -1) + 1, items.length - 1)]?.focus();
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      if (pendingDeleteKey) cancelPendingDelete();
      e.preventDefault();
      items[Math.max(idx - 1, 0)]?.focus();
    } else if (isSelecting) {
      if ((e.key === 'Enter' || e.key === ' ') && target) {
        e.preventDefault();
        const cb = target.querySelector<HTMLInputElement>('.select-cb');
        if (cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } else if ((e.key === 'Enter' || e.key === 'l') && target) {
      if (pendingDeleteKey) cancelPendingDelete();
      const shortcut = shortcutCache.find(s => s.key === target.dataset.key);
      if (shortcut) openShortcut(shortcut);
      else if (target.dataset.url && /^https?:\/\//i.test(target.dataset.url)) {
        chrome.tabs.create({ url: target.dataset.url });
      }
    } else if (e.key === 'e' && target) {
      if (pendingDeleteKey) cancelPendingDelete();
      target.querySelector<HTMLButtonElement>('.edit-btn')?.click();
    } else if ((e.key === 'd' || e.key === 'Delete') && target) {
      e.preventDefault();
      target.querySelector<HTMLButtonElement>('.btn-icon.danger')?.click();
    }
  });

  // ── Toggle close via keyboard shortcut ───────────────────────────────────────
  // Long-lived port so the background knows the panel is open. Reconnects if
  // the service worker restarts (which disconnects every port).
  if (enableBackgroundPort) {
    function connectToBackground(): void {
      const port = chrome.runtime.connect({ name: 'sidepanel' });
      port.onMessage.addListener((message) => {
        if (message?.type === 'close-panel') window.close();
      });
      port.onDisconnect.addListener(() => {
        setTimeout(connectToBackground, 250);
      });
    }
    connectToBackground();
  }

  // ── Live sync ─────────────────────────────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(k => k.startsWith(SHORTCUT_PREFIX) || k === SETTINGS_KEY)) {
      if (isStatOnlyChange(changes)) {
        applyStatOnlyChanges(changes);
      } else {
        scheduleRefresh();
      }
    }
    if (area === 'local' && DAILY_KEY in changes && !panelSettings.hidden) {
      const counts = (changes[DAILY_KEY].newValue ?? {}) as Record<string, number>;
      renderWeeklyChart(counts);
    }
  });

  // ── TIP suggestion ────────────────────────────────────────────────────────────
  async function checkTipSuggestion(tab: chrome.tabs.Tab | undefined, fillForm = true): Promise<void> {
    if (!tab?.id) { suggestionEl.hidden = true; return; }
    const r = await chrome.storage.session.get(`suggestion_${tab.id}`);
    const suggestion = r[`suggestion_${tab.id}`] as Suggestion | undefined;
    if (!suggestion) { suggestionEl.hidden = true; return; }

    suggestionTextEl.textContent =
      `You often visit ${suggestion.siteName}. Save "${suggestion.key}" as a shortcut?`;
    suggestionEl.hidden = false;

    if (fillForm) {
      redirectKeyInput.value = suggestion.key;
      redirectUrlInput.value = suggestion.url;
      autofillKey = suggestion.key;
      autofillUrl = suggestion.url;
      renderRedirectUrlAncestors(suggestion.url);
    }

    const tabId = tab.id;
    const persistSuggestion = async (key: string): Promise<void> => {
      const url = normalizeUrl(suggestion.url);
      if (!url) {
        suggestionEl.hidden = true;
        return;
      }
      await upsertShortcut({ key, url, type: 'redirect' });
      await chrome.storage.session.remove(`suggestion_${tabId}`);
      await chrome.action.setBadgeText({ tabId, text: '' });
      suggestionEl.hidden = true;
      setRedirectStatus(savedStatusMessage(key, shortcutCache.length + 1), 'success');
      await refresh();
    };

    saveSuggestionBtn.onclick = async () => {
      const url = normalizeUrl(suggestion.url);
      if (!url) {
        suggestionEl.hidden = true;
        return;
      }
      // Same overwrite guard as the forms: saving a suggestion must never
      // silently repoint (or convert) an existing keyword.
      const store = await getStore();
      const existing = Object.prototype.hasOwnProperty.call(store.shortcuts, suggestion.key)
        ? store.shortcuts[suggestion.key]
        : undefined;
      const candidate: Shortcut = { key: suggestion.key, url, type: 'redirect' };
      if (existing && hasShortcutTargetCollision(existing, candidate)) {
        const alt = uniqueKey(suggestion.key, new Set(Object.keys(store.shortcuts)));
        renderOverwriteConfirm(
          suggestionTextEl,
          existing,
          alt,
          () => void persistSuggestion(suggestion.key),
          (altKey) => void persistSuggestion(altKey),
        );
        return;
      }
      await persistSuggestion(suggestion.key);
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

  // ── Tab-aware updates ─────────────────────────────────────────────────────────
  if (enableActiveTabAutofill) {
    chrome.tabs.onActivated.addListener(async ({ tabId }) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        // Capture dirty state before checkTipSuggestion may update autofill vars
        const formIsDirty =
          (redirectKeyInput.value !== '' && redirectKeyInput.value !== autofillKey) ||
          (redirectUrlInput.value !== '' && redirectUrlInput.value !== autofillUrl);

        await checkTipSuggestion(tab, !formIsDirty);

        // Re-init the form only when it's clean, no suggestion is showing, and tab is HTTP
        if (!formIsDirty && suggestionEl.hidden && tab.url && /^https?:\/\//i.test(tab.url)) {
          initRedirectForm(tab);
        }
      } catch { /* non-fatal */ }
    });

    chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
      if (!changeInfo.url || !tab.active) return;
      const formIsDirty =
        (redirectKeyInput.value !== '' && redirectKeyInput.value !== autofillKey) ||
        (redirectUrlInput.value !== '' && redirectUrlInput.value !== autofillUrl);
      try {
        await checkTipSuggestion(tab, !formIsDirty);
        if (!formIsDirty && suggestionEl.hidden && tab.url && /^https?:\/\//i.test(tab.url)) {
          initRedirectForm(tab);
        }
      } catch { /* non-fatal */ }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  redirectKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); redirectUrlInput.focus(); }
  });
  redirectUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isSearchType && !redirectUrlTemplateInput.value.trim()) {
        redirectUrlTemplateInput.focus();
      } else {
        saveRedirectBtn.click();
      }
    }
  });
  redirectUrlTemplateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveRedirectBtn.click(); }
  });

  resetUrlList();

  // Await refresh so shortcutCache is warm before initRedirectForm reads it,
  // then share a single tab query between initRedirectForm and checkTipSuggestion.
  (async () => {
    await refresh();
    try {
      const [tab] = await chrome.tabs.query(
        enableActiveTabAutofill
          ? { active: true, currentWindow: true }
          : { active: true, lastFocusedWindow: true }
      );
      if (enableActiveTabAutofill) {
        initRedirectForm(tab);
      }
      await checkTipSuggestion(tab);
    } catch { /* non-fatal */ }
    if (suggestionEl.hidden) redirectKeyInput.focus();
  })();
}
