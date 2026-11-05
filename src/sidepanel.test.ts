import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock } from './test/chrome-mock';
import { createDomMock, MockElement } from './test/dom-mock';
import { DAILY_KEY, getStore, saveSettings, upsertShortcut } from './storage';

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await Promise.resolve();
  }
}

function buildPanelDom() {
  const dom = createDomMock();
  const { doc, body } = dom;

  const make = (tag: string, id: string, props: Partial<MockElement> = {}) => {
    const el = doc.createElement(tag) as MockElement;
    el.id = id;
    Object.assign(el, props);
    return el;
  };

  // Tabs & panels
  const tabShortcuts = make('button', 'tabShortcuts', { className: 'tab active' });
  const tabBundle = make('button', 'tabBundle', { className: 'tab' });
  const tabSettings = make('button', 'tabSettings', { className: 'tab' });
  const nav = doc.createElement('nav') as MockElement;
  nav.append(tabShortcuts, tabBundle, tabSettings);

  const panelShortcuts = make('section', 'panelShortcuts', { hidden: false });
  const panelBundle = make('section', 'panelBundle', { hidden: true });
  const panelSettings = make('section', 'panelSettings', { hidden: true });

  // Suggestion banner
  const suggestion = make('div', 'suggestion', { hidden: true });
  const suggestionText = make('div', 'suggestionText');
  const saveSuggestion = make('button', 'saveSuggestion');
  const dismissSuggestion = make('button', 'dismissSuggestion');
  suggestion.append(suggestionText, saveSuggestion, dismissSuggestion);

  // Add redirect / search form
  const redirectKey = make('input', 'redirectKey', { type: 'text' });
  const redirectUrl = make('input', 'redirectUrl', { type: 'text' });
  const saveRedirect = make('button', 'saveRedirect', { type: 'button' });
  const redirectUrlAncestors = make('div', 'redirectUrlAncestors', { hidden: true });
  const pickRedirectTab = make('button', 'pickRedirectTab', { type: 'button' });
  const searchToggle = make('button', 'searchToggle', { type: 'button' });
  searchToggle.setAttribute('aria-pressed', 'false');

  const redirectTabPicker = make('div', 'redirectTabPicker', { hidden: true });
  const redirectTabPickList = make('div', 'redirectTabPickList');
  const cancelRedirectPicker = make('button', 'cancelRedirectPicker', { type: 'button' });
  redirectTabPicker.append(redirectTabPickList, cancelRedirectPicker);

  const searchFields = make('div', 'searchFields', { hidden: true });
  const redirectUrlTemplate = make('input', 'redirectUrlTemplate', { type: 'text' });
  searchFields.append(redirectUrlTemplate);

  const addRedirectStatus = make('div', 'addRedirectStatus', { className: 'form-status' });

  // Filter + list controls
  const filterInput = make('input', 'filterInput', { type: 'search', hidden: true });
  const count = make('div', 'count');
  const selectToggle = make('button', 'selectToggle', { type: 'button' });
  const deleteSelected = make('button', 'deleteSelected', { type: 'button', hidden: true });
  const emptyState = make('div', 'emptyState', { hidden: true });
  const loadStarterBtn = make('button', 'loadStarterBtn', { type: 'button' });
  emptyState.append(loadStarterBtn);
  const noResults = make('div', 'noResults', { hidden: true });
  const shortcutList = make('ul', 'shortcutList');
  const kbdHints = make('div', 'kbdHints', { hidden: true });

  panelShortcuts.append(
    suggestion,
    redirectKey,
    redirectUrl,
    saveRedirect,
    redirectUrlAncestors,
    pickRedirectTab,
    searchToggle,
    redirectTabPicker,
    searchFields,
    addRedirectStatus,
    filterInput,
    count,
    selectToggle,
    deleteSelected,
    emptyState,
    noResults,
    shortcutList,
    kbdHints,
  );

  // Bundle panel
  const bundleForm = make('form', 'bundleForm');
  const bundleKey = make('input', 'bundleKey', { type: 'text' });
  const bundleLabel = make('input', 'bundleLabel', { type: 'text' });
  const addAllTabs = make('button', 'addAllTabs', { type: 'button' });
  const pickTabs = make('button', 'pickTabs', { type: 'button' });
  const pickShortcuts = make('button', 'pickShortcuts', { type: 'button' });
  const tabPicker = make('div', 'tabPicker', { hidden: true });
  const tabPickList = make('div', 'tabPickList');
  const useSelectedTabs = make('button', 'useSelectedTabs', { type: 'button' });
  const cancelPicker = make('button', 'cancelPicker', { type: 'button' });
  tabPicker.append(tabPickList, useSelectedTabs, cancelPicker);

  const shortcutPicker = make('div', 'shortcutPicker', { hidden: true });
  const shortcutPickList = make('div', 'shortcutPickList');
  const useSelectedShortcuts = make('button', 'useSelectedShortcuts', { type: 'button' });
  const cancelShortcutPicker = make('button', 'cancelShortcutPicker', { type: 'button' });
  shortcutPicker.append(shortcutPickList, useSelectedShortcuts, cancelShortcutPicker);

  const urlList = make('div', 'urlList');
  const addUrl = make('button', 'addUrl', { type: 'button' });
  const saveBundle = make('button', 'saveBundle', { type: 'submit' });
  const cancelBundleEdit = make('button', 'cancelBundleEdit', { type: 'button', hidden: true });
  const bundleStatus = make('div', 'bundleStatus', { className: 'form-status' });

  bundleForm.append(
    bundleKey,
    bundleLabel,
    addAllTabs,
    pickTabs,
    pickShortcuts,
    tabPicker,
    shortcutPicker,
    urlList,
    addUrl,
    saveBundle,
    cancelBundleEdit,
    bundleStatus,
  );
  panelBundle.append(bundleForm);

  // Settings panel
  const darkModeToggle = make('input', 'darkModeToggle', { type: 'checkbox' });
  const smartSuggestionsToggle = make('input', 'smartSuggestionsToggle', { type: 'checkbox' });
  const shortcutPopup = make('span', 'shortcutPopup');
  const shortcutPanel = make('span', 'shortcutPanel');
  const customizeShortcut = make('button', 'customizeShortcut', { type: 'button' });
  const firefoxShortcutHint = make('p', 'firefoxShortcutHint', { hidden: true });
  const maxShortcutsInput = make('input', 'maxShortcutsInput', { type: 'number' });
  const saveMaxShortcuts = make('button', 'saveMaxShortcuts', { type: 'button' });
  const settingsStatus = make('div', 'settingsStatus');
  const filterThresholdInput = make('input', 'filterThresholdInput', { type: 'number' });
  const saveFilterThreshold = make('button', 'saveFilterThreshold', { type: 'button' });
  const filterThresholdStatus = make('div', 'filterThresholdStatus');
  const weeklyChart = make('div', 'weeklyChart');
  const weekTotal = make('div', 'weekTotal');
  const clearStatsBtn = make('button', 'clearStatsBtn', { type: 'button' });
  const clearStatsStatus = make('div', 'clearStatsStatus');
  const exportBtn = make('button', 'exportBtn', { type: 'button' });
  const importBtn = make('button', 'importBtn', { type: 'button' });
  const loadStarterSettingsBtn = make('button', 'loadStarterSettingsBtn', { type: 'button' });
  const importFile = make('input', 'importFile', { type: 'file', hidden: true });
  const dataStatus = make('div', 'dataStatus');
  const staleToggle = make('input', 'staleToggle', { type: 'checkbox' });
  const staleDaysInput = make('input', 'staleDaysInput', { type: 'number' });
  const saveStale = make('button', 'saveStale', { type: 'button' });
  const staleStatus = make('div', 'staleStatus');

  panelSettings.append(
    darkModeToggle,
    smartSuggestionsToggle,
    shortcutPopup,
    shortcutPanel,
    customizeShortcut,
    firefoxShortcutHint,
    maxShortcutsInput,
    saveMaxShortcuts,
    settingsStatus,
    filterThresholdInput,
    saveFilterThreshold,
    filterThresholdStatus,
    weeklyChart,
    weekTotal,
    clearStatsBtn,
    clearStatsStatus,
    exportBtn,
    importBtn,
    loadStarterSettingsBtn,
    importFile,
    dataStatus,
    staleToggle,
    staleDaysInput,
    saveStale,
    staleStatus,
  );

  body.append(nav, panelShortcuts, panelBundle, panelSettings);

  return {
    dom,
    tabShortcuts,
    tabBundle,
    tabSettings,
    panelShortcuts,
    panelBundle,
    panelSettings,
    redirectKey,
    redirectUrl,
    saveRedirect,
    searchToggle,
    searchFields,
    redirectUrlTemplate,
    addRedirectStatus,
    filterInput,
    count,
    selectToggle,
    deleteSelected,
    shortcutList,
    importFile,
    dataStatus,
  };
}

describe.each([
  { name: 'sidepanel', loadModule: () => import('./sidepanel') },
  { name: 'options', loadModule: () => import('./options') },
])('$name runtime behavior', ({ loadModule }) => {
  let mockChrome: ReturnType<typeof createChromeMock>;
  let els: ReturnType<typeof buildPanelDom>;

  beforeEach(() => {
    vi.resetModules();
    mockChrome = createChromeMock();
    els = buildPanelDom();
    (globalThis as any).chrome = mockChrome.chrome;
    (globalThis as any).document = els.dom.doc;
    (globalThis as any).window = { close: vi.fn() };
    (globalThis as any).localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
  });

  describe('Adding redirect and parameterized (%s) search shortcuts', () => {
    it('toggles #searchToggle to enable search mode, rejects invalid templates, and saves normalized schemeless %s templates with derived fallback URL', async () => {
      await loadModule();
      await flushPromises();

      expect(els.searchToggle.getAttribute('aria-pressed')).toBe('false');
      expect(els.searchFields.hidden).toBe(true);

      // 1. Toggle search mode on
      await els.searchToggle.click();
      expect(els.searchToggle.getAttribute('aria-pressed')).toBe('true');
      expect(els.searchFields.hidden).toBe(false);

      // 2. Submit without %s -> error, does not save
      els.redirectKey.value = 'yt';
      els.redirectUrlTemplate.value = 'https://youtube.com/results?search_query=test';
      await els.saveRedirect.click();
      await flushPromises();

      expect(els.addRedirectStatus.textContent).toBe('Search URL must include %s.');
      expect(els.addRedirectStatus.className).toContain('error');
      let store = await getStore();
      expect(store.shortcuts['yt']).toBeUndefined();

      // 3. Submit with javascript:alert('%s') -> error, does not save
      els.redirectUrlTemplate.value = "javascript:alert('%s')";
      await els.saveRedirect.click();
      await flushPromises();

      expect(els.addRedirectStatus.textContent).toBe('Enter a valid http(s) search URL template.');
      expect(els.addRedirectStatus.className).toContain('error');
      store = await getStore();
      expect(store.shortcuts['yt']).toBeUndefined();

      // 4. Submit schemeless search template -> normalizes to https:// and derives fallback URL
      els.redirectKey.value = 'yt';
      els.redirectUrl.value = '';
      els.redirectUrlTemplate.value = 'youtube.com/results?search_query=%s';
      await els.saveRedirect.click();
      await flushPromises();

      store = await getStore();
      expect(store.shortcuts['yt']).toBeDefined();
      expect(store.shortcuts['yt'].type).toBe('parameterized');
      expect(store.shortcuts['yt'].urlTemplate).toBe('https://youtube.com/results?search_query=%s');
      expect(store.shortcuts['yt'].url).toBe('https://youtube.com/results');
      expect(els.addRedirectStatus.className).toContain('success');
      // Resets search mode after saving
      expect(els.searchFields.hidden).toBe(true);
      expect(els.searchToggle.getAttribute('aria-pressed')).toBe('false');

      // 5. Submit a standard redirect shortcut
      els.redirectKey.value = 'gh';
      els.redirectUrl.value = 'github.com/org';
      await els.saveRedirect.click();
      await flushPromises();

      store = await getStore();
      expect(store.shortcuts['gh']).toBeDefined();
      expect(store.shortcuts['gh'].type).toBe('redirect');
      expect(store.shortcuts['gh'].url).toBe('https://github.com/org');
    });
  });

  describe('Alias (handleAlias) for both redirect and parameterized shortcuts', () => {
    it('clicking .alias-btn on parameterized and redirect shortcuts configures search mode and populates target fields', async () => {
      await upsertShortcut({
        key: 'yt',
        url: 'https://youtube.com/feed/subscriptions',
        urlTemplate: 'https://youtube.com/results?search_query=%s',
        type: 'parameterized',
      });
      await upsertShortcut({
        key: 'gh',
        url: 'https://github.com',
        type: 'redirect',
      });

      await loadModule();
      await flushPromises();

      const ytRow = els.shortcutList.querySelector('li[data-key="yt"]');
      const ghRow = els.shortcutList.querySelector('li[data-key="gh"]');
      expect(ytRow).toBeTruthy();
      expect(ghRow).toBeTruthy();

      // Click alias button on parameterized shortcut
      const ytAliasBtn = ytRow!.querySelector('.alias-btn');
      expect(ytAliasBtn).toBeTruthy();
      await ytAliasBtn!.click();

      expect(els.searchToggle.getAttribute('aria-pressed')).toBe('true');
      expect(els.searchFields.hidden).toBe(false);
      expect(els.redirectUrl.value).toBe('https://youtube.com/feed/subscriptions');
      expect(els.redirectUrlTemplate.value).toBe('https://youtube.com/results?search_query=%s');
      expect(els.redirectKey.value).toBe('');
      expect(els.dom.doc.activeElement).toBe(els.redirectKey);

      // Click alias button on redirect shortcut -> exits search mode and clears template
      const ghAliasBtn = ghRow!.querySelector('.alias-btn');
      expect(ghAliasBtn).toBeTruthy();
      await ghAliasBtn!.click();

      expect(els.searchToggle.getAttribute('aria-pressed')).toBe('false');
      expect(els.searchFields.hidden).toBe(true);
      expect(els.redirectUrl.value).toBe('https://github.com');
      expect(els.redirectUrlTemplate.value).toBe('');
    });
  });

  describe('Filter bar visibility', () => {
    it('stays visible when filterInput.value is non-empty even if shortcut count is below filterThreshold', async () => {
      await saveSettings({
        maxShortcuts: 500,
        filterThreshold: 25,
        darkMode: false,
        staleAutoDelete: true,
        staleDays: 90,
        smartSuggestions: false,
      });
      await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });

      await loadModule();
      await flushPromises();

      // 1 shortcut < 25 threshold and empty query -> hidden
      expect(els.filterInput.hidden).toBe(true);

      // Non-empty query -> stays visible despite count (1) < threshold (25)
      els.filterInput.value = 'no-match-query';
      await els.filterInput.dispatchEvent({ type: 'input' });

      expect(els.filterInput.hidden).toBe(false);

      // Clearing query hides it again when count < threshold
      els.filterInput.value = '';
      await els.filterInput.dispatchEvent({ type: 'input' });
      expect(els.filterInput.hidden).toBe(true);
    });
  });

  describe('Keyboard navigation guards and select mode', () => {
    it('navigates rows with j/k on #panelShortcuts, ignores when other panels are active or with modifier keys, and toggles selection with Space/Enter in select mode', async () => {
      await upsertShortcut({ key: 'a', url: 'https://a.example.com', type: 'redirect' });
      await upsertShortcut({ key: 'b', url: 'https://b.example.com', type: 'redirect' });

      await loadModule();
      await flushPromises();

      const rows = els.shortcutList.querySelectorAll('li');
      expect(rows.length).toBe(2);

      // Blur input (init focuses redirectKeyInput)
      els.dom.doc.activeElement = null;

      // Press j -> focuses first row
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'j' });
      expect(els.dom.doc.activeElement).toBe(rows[0]);

      // Press j again -> focuses second row
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'j' });
      expect(els.dom.doc.activeElement).toBe(rows[1]);

      // Press k -> focuses first row
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'k' });
      expect(els.dom.doc.activeElement).toBe(rows[0]);

      // Chords with Ctrl / Meta / Alt are ignored
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'j', ctrlKey: true });
      expect(els.dom.doc.activeElement).toBe(rows[0]);
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'j', metaKey: true });
      expect(els.dom.doc.activeElement).toBe(rows[0]);
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'j', altKey: true });
      expect(els.dom.doc.activeElement).toBe(rows[0]);

      // Switch to #panelBundle -> j/k does NOT navigate
      await els.tabBundle.click();
      expect(els.panelShortcuts.hidden).toBe(true);
      expect(els.panelBundle.hidden).toBe(false);
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'j' });
      expect(els.dom.doc.activeElement).toBe(rows[0]);

      // Switch to #panelSettings -> j/k does NOT navigate
      await els.tabSettings.click();
      await flushPromises();
      expect(els.panelShortcuts.hidden).toBe(true);
      expect(els.panelSettings.hidden).toBe(false);
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'j' });
      expect(els.dom.doc.activeElement).toBe(rows[0]);

      // Return to #panelShortcuts and enter select mode
      await els.tabShortcuts.click();
      await els.selectToggle.click();
      expect(els.shortcutList.classList.contains('selecting')).toBe(true);
      expect(els.deleteSelected.hidden).toBe(true);

      // Focus row 0 and press Space -> toggles checkbox on and updates #deleteSelected
      rows[0].focus();
      const cb0 = rows[0].querySelector('.select-cb')!;
      expect(cb0.checked).toBe(false);

      await els.dom.doc.dispatchEvent({ type: 'keydown', key: ' ' });
      await flushPromises();
      expect(cb0.checked).toBe(true);
      expect(els.deleteSelected.hidden).toBe(false);
      expect(els.deleteSelected.textContent).toBe('Delete (1)');

      // Navigate to row 1 and press Enter -> toggles row 1 checkbox on, count becomes 2
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'j' });
      expect(els.dom.doc.activeElement).toBe(rows[1]);
      const cb1 = rows[1].querySelector('.select-cb')!;

      await els.dom.doc.dispatchEvent({ type: 'keydown', key: 'Enter' });
      await flushPromises();
      expect(cb1.checked).toBe(true);
      expect(els.deleteSelected.textContent).toBe('Delete (2)');

      // Press Space again on row 1 -> unchecks row 1, count becomes 1
      await els.dom.doc.dispatchEvent({ type: 'keydown', key: ' ' });
      await flushPromises();
      expect(cb1.checked).toBe(false);
      expect(els.deleteSelected.textContent).toBe('Delete (1)');
    });
  });

  describe('JSON Import Sanitization', () => {
    it('imports valid sanitized shortcuts, clamps settings, imports valid dailyCounts, and skips malformed entries without crashing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadModule();
      await flushPromises();

      const importPayload = {
        version: 1,
        settings: {
          maxShortcuts: 9999,
          filterThreshold: -10,
          staleDays: 2,
          darkMode: true,
          staleAutoDelete: false,
          smartSuggestions: true,
        },
        dailyCounts: {
          '2026-11-05': 7.8,
          '2026-11-04': -3,
          'not-a-date': 10,
          '2026-11-03': 'invalid',
        },
        shortcuts: [
          // Valid redirect (with non-string label that should be sanitized to undefined)
          {
            key: 'GH',
            url: 'github.com/org',
            type: 'redirect',
            label: 12345,
            useCount: 4.9,
          },
          // Valid bundle
          {
            key: 'work',
            type: 'bundle',
            label: '  Morning Routine  ',
            bundleUrls: ['linear.app', 'https://notion.so', 'javascript:alert(1)'],
          },
          // Valid parameterized search shortcut
          {
            key: 'yt',
            type: 'parameterized',
            urlTemplate: 'youtube.com/results?search_query=%s',
          },
          // Malformed entries that must be skipped:
          null,
          { key: 42, url: 'https://example.com', type: 'redirect' },
          { key: '   ', url: 'https://example.com', type: 'redirect' },
          { key: 'xss', url: 'javascript:alert(1)', type: 'redirect' },
          { key: 'badbundle', type: 'bundle', bundleUrls: ['https://only-one.com'] },
          { key: 'badsearch', type: 'parameterized', urlTemplate: 'https://example.com/no-placeholder' },
          { key: 'badsearchscheme', type: 'parameterized', urlTemplate: 'javascript:alert("%s")' },
        ],
      };

      els.importFile.files = [
        {
          name: 'omnijump.json',
          text: async () => JSON.stringify(importPayload),
        },
      ];

      await els.importFile.dispatchEvent({ type: 'change' });
      await flushPromises();

      const store = await getStore();

      // Only the 3 valid shortcuts were imported
      expect(Object.keys(store.shortcuts).sort()).toEqual(['gh', 'work', 'yt']);

      // Redirect sanitized properly (non-string label stripped, useCount floored, URL normalized)
      expect(store.shortcuts['gh']).toMatchObject({
        key: 'gh',
        type: 'redirect',
        url: 'https://github.com/org',
        useCount: 4,
      });
      expect(store.shortcuts['gh'].label).toBeUndefined();

      // Bundle sanitized (javascript: URL filtered out, remaining 2 valid URLs kept, label trimmed)
      expect(store.shortcuts['work']).toMatchObject({
        key: 'work',
        type: 'bundle',
        url: 'https://linear.app',
        bundleUrls: ['https://linear.app', 'https://notion.so'],
        label: 'Morning Routine',
      });

      // Parameterized search shortcut normalized and fallback derived
      expect(store.shortcuts['yt']).toMatchObject({
        key: 'yt',
        type: 'parameterized',
        url: 'https://youtube.com/results',
        urlTemplate: 'https://youtube.com/results?search_query=%s',
      });

      // Only preference settings are imported; behavior-changing toggles
      // (staleDays: 2, staleAutoDelete: false, smartSuggestions: true in the
      // payload) are intentionally ignored and stay at their defaults.
      expect(store.settings).toEqual({
        maxShortcuts: 500,
        filterThreshold: 1,
        staleDays: 90,
        darkMode: true,
        staleAutoDelete: true,
        smartSuggestions: false,
      });

      // Only valid YYYY-MM-DD non-negative numeric dailyCounts imported (and floored)
      const localData = await mockChrome.chrome.storage.local.get(DAILY_KEY);
      expect(localData[DAILY_KEY]).toEqual({
        '2026-11-05': 7,
      });

      // Status reports 3 imported, 7 failed
      expect(els.dataStatus.textContent).toBe(
        'Imported 3 shortcuts (7 failed — check console for details).',
      );
      expect(els.dataStatus.className).toBe('form-status success');

      errorSpy.mockRestore();
    });

    describe('import collision guard', () => {
      const COLLIDING_PAYLOAD = {
        version: 1,
        shortcuts: [
          { key: 'gh', url: 'https://evil-github.example.com', type: 'redirect' },
          { key: 'mail', url: 'https://evil-mail.example.com', type: 'redirect' },
          { key: 'fresh', url: 'https://fresh.example.com', type: 'redirect' },
        ],
      };

      async function seedAndImport(): Promise<void> {
        await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect', label: 'GitHub' });
        await upsertShortcut({ key: 'mail', url: 'https://mail.google.com', type: 'redirect' });
        await loadModule();
        await flushPromises();
        els.importFile.files = [{ name: 'x.json', text: async () => JSON.stringify(COLLIDING_PAYLOAD) }];
        await els.importFile.dispatchEvent({ type: 'change' });
        await flushPromises();
      }

      it('shows a confirmation listing colliding keys with their new hosts, writing nothing yet', async () => {
        await seedAndImport();
        const store = await getStore();
        expect(store.shortcuts['gh'].url).toBe('https://github.com');
        expect(store.shortcuts['mail'].url).toBe('https://mail.google.com');
        expect(store.shortcuts['fresh']).toBeUndefined();
        expect(els.dataStatus.textContent).toContain('would replace existing ones');
        expect(els.dataStatus.textContent).toContain('evil-github.example.com');
        const buttons = els.dataStatus.querySelectorAll('button') as unknown as Array<{ textContent: string }>;
        expect(buttons.map((b) => b.textContent)).toEqual(['Overwrite all', 'Skip existing', 'Cancel']);
      });

      it('"Skip existing" imports only non-colliding keys', async () => {
        await seedAndImport();
        const buttons = els.dataStatus.querySelectorAll('button') as unknown as Array<{ click: () => Promise<void> }>;
        await buttons[1]!.click();
        await flushPromises();
        const store = await getStore();
        expect(store.shortcuts['gh'].url).toBe('https://github.com');
        expect(store.shortcuts['mail'].url).toBe('https://mail.google.com');
        expect(store.shortcuts['fresh'].url).toBe('https://fresh.example.com');
        expect(els.dataStatus.textContent).toBe('Imported 1 shortcuts (kept 2 existing).');
      });

      it('"Overwrite all" applies the imported targets explicitly', async () => {
        await seedAndImport();
        const buttons = els.dataStatus.querySelectorAll('button') as unknown as Array<{ click: () => Promise<void> }>;
        await buttons[0]!.click();
        await flushPromises();
        const store = await getStore();
        expect(store.shortcuts['gh'].url).toBe('https://evil-github.example.com');
        expect(store.shortcuts['mail'].url).toBe('https://evil-mail.example.com');
        expect(store.shortcuts['fresh'].url).toBe('https://fresh.example.com');
        expect(els.dataStatus.textContent).toBe('Imported 3 shortcuts (replaced 2 existing).');
      });

      it('"Cancel" imports nothing', async () => {
        await seedAndImport();
        const buttons = els.dataStatus.querySelectorAll('button') as unknown as Array<{ click: () => Promise<void> }>;
        await buttons[2]!.click();
        await flushPromises();
        const store = await getStore();
        expect(store.shortcuts['gh'].url).toBe('https://github.com');
        expect(store.shortcuts['fresh']).toBeUndefined();
        expect(els.dataStatus.textContent).toBe('Import cancelled.');
      });
    });

    it('rejects oversized import files before parsing them', async () => {
      await loadModule();
      await flushPromises();
      els.importFile.files = [{
        name: 'big.json',
        size: 3 * 1024 * 1024,
        text: async () => { throw new Error('must not be read'); },
      }];
      await els.importFile.dispatchEvent({ type: 'change' });
      await flushPromises();
      expect(els.dataStatus.textContent).toContain('file is too large');
      expect(Object.keys((await getStore()).shortcuts)).toHaveLength(0);
    });

    it('clamps far-future imported timestamps, rejects over-long keys and in-file duplicates', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await loadModule();
      await flushPromises();
      const farFuture = Date.now() + 100_000_000_000;
      els.importFile.files = [{
        name: 'x.json',
        text: async () => JSON.stringify({
          version: 1,
          shortcuts: [
            { key: 'fut', url: 'https://fut.example.com', type: 'redirect', createdAt: farFuture, lastUsed: farFuture },
            { key: 'dup', url: 'https://a.example.com', type: 'redirect' },
            { key: 'DUP!', url: 'https://b.example.com', type: 'redirect' },
            { key: 'k'.repeat(200), url: 'https://l.example.com', type: 'redirect' },
          ],
        }),
      }];
      await els.importFile.dispatchEvent({ type: 'change' });
      await flushPromises();

      const store = await getStore();
      const fut = store.shortcuts['fut']!;
      expect(fut.createdAt).toBeLessThanOrEqual(Date.now());
      expect(fut.lastUsed).toBeLessThanOrEqual(Date.now());
      // In-file duplicate: first entry wins, second counts as failed.
      expect(store.shortcuts['dup'].url).toBe('https://a.example.com');
      // Over-long keyword rejected.
      expect(store.shortcuts['k'.repeat(200)]).toBeUndefined();
      expect(els.dataStatus.textContent).toBe(
        'Imported 2 shortcuts (2 failed — check console for details).',
      );
      errorSpy.mockRestore();
    });
  });
});
