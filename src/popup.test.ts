import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createChromeMock } from './test/chrome-mock';
import { createDomMock, MockElement } from './test/dom-mock';
import { getDismissedHosts, getStore, upsertShortcut } from './storage';

describe('popup layout and margins/padding integrity', () => {
  const popupHtmlPath = path.resolve(__dirname, 'popup.html');
  const themeCssPath = path.resolve(__dirname, 'theme.css');

  it('popup.html designates body with .popup class and sets padding', () => {
    const html = fs.readFileSync(popupHtmlPath, 'utf8');
    expect(html).toMatch(/<body class="[^"]*popup[^"]*">/);
    expect(html).toContain('padding: var(--s4)');
  });

  it('theme.css defines body.popup layout rules with padding token', () => {
    const css = fs.readFileSync(themeCssPath, 'utf8');
    expect(css).toMatch(/body\.popup\s*\{[^}]*padding:\s*var\(--s4\)/);
  });

  it('theme.css base body reset does not zero out body padding', () => {
    const css = fs.readFileSync(themeCssPath, 'utf8');
    // Ensure the global body reset rule doesn't stomp on body padding
    const bodyResetMatch = css.match(/body\s*\{([^}]+)\}/);
    expect(bodyResetMatch).toBeTruthy();
    expect(bodyResetMatch![1]).not.toContain('padding: 0');
  });
});

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function buildPopupDom() {
  const dom = createDomMock();
  const { doc, body } = dom;

  const suggestion = doc.createElement('div') as MockElement;
  suggestion.id = 'suggestion';
  suggestion.hidden = true;

  const suggestionText = doc.createElement('div') as MockElement;
  suggestionText.id = 'suggestionText';

  const saveSuggestion = doc.createElement('button') as MockElement;
  saveSuggestion.id = 'saveSuggestion';

  const dismissSuggestion = doc.createElement('button') as MockElement;
  dismissSuggestion.id = 'dismissSuggestion';

  suggestion.append(suggestionText, saveSuggestion, dismissSuggestion);

  const form = doc.createElement('form') as MockElement;
  form.id = 'shortcutForm';

  const keyInput = doc.createElement('input') as MockElement;
  keyInput.id = 'shortcutKey';

  const urlInput = doc.createElement('input') as MockElement;
  urlInput.id = 'shortcutUrl';

  const urlAncestors = doc.createElement('div') as MockElement;
  urlAncestors.id = 'urlAncestors';

  const status = doc.createElement('div') as MockElement;
  status.id = 'status';

  form.append(keyInput, urlInput, urlAncestors, status);

  const openPanel = doc.createElement('button') as MockElement;
  openPanel.id = 'openPanel';

  body.append(suggestion, form, openPanel);

  return {
    dom,
    suggestion,
    suggestionText,
    saveSuggestion,
    dismissSuggestion,
    form,
    keyInput,
    urlInput,
    urlAncestors,
    status,
    openPanel,
  };
}

describe('popup runtime behavior', () => {
  let mockChrome: ReturnType<typeof createChromeMock>;
  let els: ReturnType<typeof buildPopupDom>;

  beforeEach(() => {
    vi.resetModules();
    mockChrome = createChromeMock();
    els = buildPopupDom();
    (globalThis as any).chrome = mockChrome.chrome;
    (globalThis as any).document = els.dom.doc;
    (globalThis as any).window = { close: vi.fn() };
  });

  it('auto-fills active HTTP tab URL, collision-free suggested keyword (uniqueKey), and renders ancestor chips', async () => {
    await upsertShortcut({ key: 'git', url: 'https://gitlab.com', type: 'redirect' });
    vi.mocked(mockChrome.chrome.tabs.query).mockResolvedValue([
      { id: 10, url: 'https://github.com/org/repo/issues' } as chrome.tabs.Tab,
    ]);

    await import('./popup');
    await flushPromises();

    expect(els.urlInput.value).toBe('https://github.com/org/repo/issues');
    expect(els.keyInput.value).toBe('git2');

    const chips = els.urlAncestors.querySelectorAll('.url-ancestor-btn');
    expect(chips.length).toBe(3);
    expect(chips[0].title).toBe('https://github.com/');
    expect(chips[1].title).toBe('https://github.com/org/');
    expect(chips[2].title).toBe('https://github.com/org/repo/');

    // Clicking an ancestor chip updates the URL input and re-renders ancestors
    await chips[2].click();
    expect(els.urlInput.value).toBe('https://github.com/org/repo/');
    expect(els.urlAncestors.querySelectorAll('.url-ancestor-btn').length).toBe(2);
  });

  it('does NOT auto-fill chrome://extensions or edge://settings URLs', async () => {
    vi.mocked(mockChrome.chrome.tabs.query).mockResolvedValue([
      { id: 11, url: 'chrome://extensions' } as chrome.tabs.Tab,
    ]);

    await import('./popup');
    await flushPromises();

    expect(els.urlInput.value).toBe('');
    expect(els.keyInput.value).toBe('');
    expect(els.urlAncestors.children.length).toBe(0);

    // Also verify edge://settings
    vi.resetModules();
    els = buildPopupDom();
    (globalThis as any).document = els.dom.doc;
    vi.mocked(mockChrome.chrome.tabs.query).mockResolvedValue([
      { id: 12, url: 'edge://settings' } as chrome.tabs.Tab,
    ]);

    await import('./popup');
    await flushPromises();

    expect(els.urlInput.value).toBe('');
    expect(els.keyInput.value).toBe('');
    expect(els.urlAncestors.children.length).toBe(0);
  });

  it('submitting a new shortcut saves it and displays .success status', async () => {
    vi.mocked(mockChrome.chrome.tabs.query).mockResolvedValue([]);

    await import('./popup');
    await flushPromises();

    els.keyInput.value = 'docs';
    els.urlInput.value = 'https://docs.example.com';

    await els.form.dispatchEvent({ type: 'submit' });
    await flushPromises();

    const store = await getStore();
    expect(store.shortcuts['docs']).toBeDefined();
    expect(store.shortcuts['docs'].url).toBe('https://docs.example.com');
    expect(store.shortcuts['docs'].type).toBe('redirect');
    expect(els.status.className).toBe('success');
    expect(els.status.textContent).toContain('Saved!');
  });

  it('rejects keywords longer than MAX_KEY_LENGTH instead of saving', async () => {
    vi.mocked(mockChrome.chrome.tabs.query).mockResolvedValue([]);

    await import('./popup');
    await flushPromises();

    els.keyInput.value = 'k'.repeat(100);
    els.urlInput.value = 'https://docs.example.com';

    await els.form.dispatchEvent({ type: 'submit' });
    await flushPromises();

    const store = await getStore();
    expect(Object.keys(store.shortcuts)).toHaveLength(0);
    expect(els.status.className).toBe('error');
    expect(els.status.textContent).toContain('too long');
  });

  it('submitting a key that collides with an existing bundle or redirect renders inline overwrite confirmation', async () => {
    await upsertShortcut({
      key: 'work',
      url: 'https://github.com',
      bundleUrls: ['https://github.com', 'https://linear.app'],
      type: 'bundle',
    });
    await upsertShortcut({
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    });
    vi.mocked(mockChrome.chrome.tabs.query).mockResolvedValue([]);

    await import('./popup');
    await flushPromises();

    // 1. Collide with existing bundle 'work' and choose "Save as work2"
    els.keyInput.value = 'work';
    els.urlInput.value = 'https://notion.so';
    await els.form.dispatchEvent({ type: 'submit' });
    await flushPromises();

    let store = await getStore();
    expect(store.shortcuts['work'].type).toBe('bundle');
    expect(els.status.textContent).toContain('"work" already points to 2 tabs · github.com, linear.app.');

    const buttons = els.status.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Overwrite');
    expect(buttons[1].textContent).toBe('Save as "work2"');

    await buttons[1].click();
    await flushPromises();

    store = await getStore();
    expect(store.shortcuts['work'].type).toBe('bundle');
    expect(store.shortcuts['work2']).toBeDefined();
    expect(store.shortcuts['work2'].url).toBe('https://notion.so');
    expect(els.status.className).toBe('success');

    // 2. Collide with existing redirect 'gh' and choose "Overwrite"
    els.keyInput.value = 'gh';
    els.urlInput.value = 'https://gitlab.com';
    await els.form.dispatchEvent({ type: 'submit' });
    await flushPromises();

    expect(els.status.textContent).toContain('"gh" already points to github.com.');
    const overwriteBtn = els.status.querySelector('.confirm-overwrite');
    expect(overwriteBtn).toBeTruthy();

    await overwriteBtn!.click();
    await flushPromises();

    store = await getStore();
    expect(store.shortcuts['gh'].url).toBe('https://gitlab.com');
    expect(els.status.className).toBe('success');
  });

  it('displays the TIP suggestion banner when suggestion_${tabId} is in session storage and supports saving and dismissing', async () => {
    const suggestionData = {
      key: 'hn',
      url: 'https://news.ycombinator.com/',
      host: 'news.ycombinator.com',
      siteName: 'Hacker News',
    };
    await mockChrome.chrome.storage.session.set({ suggestion_7: suggestionData });
    vi.mocked(mockChrome.chrome.tabs.query).mockResolvedValue([
      { id: 7, url: 'https://news.ycombinator.com/' } as chrome.tabs.Tab,
    ]);

    await import('./popup');
    await flushPromises();

    expect(els.suggestion.hidden).toBe(false);
    expect(els.suggestionText.textContent).toBe(
      'You often visit Hacker News. Save "hn" as a shortcut?',
    );

    // Save the suggestion
    await els.saveSuggestion.click();
    await flushPromises();

    const store = await getStore();
    expect(store.shortcuts['hn']).toBeDefined();
    expect(store.shortcuts['hn'].url).toBe('https://news.ycombinator.com/');
    expect(els.suggestion.hidden).toBe(true);
    expect(els.status.className).toBe('success');
    expect(mockChrome.chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '' });
    const sessionAfterSave = await mockChrome.chrome.storage.session.get('suggestion_7');
    expect(sessionAfterSave['suggestion_7']).toBeUndefined();

    // Test dismissing the suggestion in a fresh popup instance
    vi.resetModules();
    els = buildPopupDom();
    (globalThis as any).document = els.dom.doc;
    await mockChrome.chrome.storage.session.set({ suggestion_8: suggestionData });
    vi.mocked(mockChrome.chrome.tabs.query).mockResolvedValue([
      { id: 8, url: 'https://news.ycombinator.com/' } as chrome.tabs.Tab,
    ]);

    await import('./popup');
    await flushPromises();

    expect(els.suggestion.hidden).toBe(false);
    await els.dismissSuggestion.click();
    await flushPromises();

    expect(els.suggestion.hidden).toBe(true);
    expect(mockChrome.chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 8, text: '' });
    const sessionAfterDismiss = await mockChrome.chrome.storage.session.get('suggestion_8');
    expect(sessionAfterDismiss['suggestion_8']).toBeUndefined();
    const dismissed = await getDismissedHosts();
    expect(dismissed.has('news.ycombinator.com')).toBe(true);
  });
});
