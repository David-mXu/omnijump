import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock } from './test/chrome-mock';
import { createDomMock, MockElement } from './test/dom-mock';
import { SETTINGS_KEY, saveSettings } from './storage';

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function buildOnboardingDom() {
  const dom = createDomMock();
  const { doc, body } = dom;

  const popupShortcutHint = doc.createElement('span') as MockElement;
  popupShortcutHint.id = 'popupShortcutHint';

  const panelShortcut = doc.createElement('span') as MockElement;
  panelShortcut.id = 'panelShortcut';
  panelShortcut.textContent = 'Alt+Shift+A';

  const closeBtn = doc.createElement('button') as MockElement;
  closeBtn.id = 'closeBtn';

  const openOptionsBtn = doc.createElement('button') as MockElement;
  openOptionsBtn.id = 'openOptionsBtn';

  body.append(popupShortcutHint, panelShortcut, closeBtn, openOptionsBtn);

  return {
    dom,
    popupShortcutHint,
    panelShortcut,
    closeBtn,
    openOptionsBtn,
  };
}

describe('onboarding runtime behavior', () => {
  let mockChrome: ReturnType<typeof createChromeMock>;
  let els: ReturnType<typeof buildOnboardingDom>;
  let storageMap: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    mockChrome = createChromeMock();
    els = buildOnboardingDom();
    storageMap = {};
    (globalThis as any).chrome = mockChrome.chrome;
    (globalThis as any).document = els.dom.doc;
    (globalThis as any).window = { close: vi.fn() };
    (globalThis as any).localStorage = {
      getItem: vi.fn((k: string) => storageMap[k] ?? null),
      setItem: vi.fn((k: string, v: string) => {
        storageMap[k] = v;
      }),
    };
  });

  it('applies dark mode class when store.settings.darkMode is true and updates on chrome.storage.onChanged', async () => {
    await saveSettings({
      maxShortcuts: 500,
      filterThreshold: 25,
      darkMode: true,
      staleAutoDelete: true,
      staleDays: 90,
      smartSuggestions: false,
    });

    await import('./onboarding');
    await flushPromises();

    expect(els.dom.body.classList.contains('dark')).toBe(true);
    expect(storageMap['omnijump_dark']).toBe('1');

    // Toggle off via chrome.storage.onChanged
    await (mockChrome.chrome.storage.onChanged as any).emit(
      {
        [SETTINGS_KEY]: {
          oldValue: { darkMode: true },
          newValue: { darkMode: false },
        },
      },
      'sync',
    );
    await flushPromises();

    expect(els.dom.body.classList.contains('dark')).toBe(false);
    expect(storageMap['omnijump_dark']).toBe('0');

    // Toggle back on via chrome.storage.onChanged
    await (mockChrome.chrome.storage.onChanged as any).emit(
      {
        [SETTINGS_KEY]: {
          oldValue: { darkMode: false },
          newValue: { darkMode: true },
        },
      },
      'sync',
    );
    await flushPromises();

    expect(els.dom.body.classList.contains('dark')).toBe(true);
    expect(storageMap['omnijump_dark']).toBe('1');
  });

  it('populates #panelShortcut and #popupShortcutHint from chrome.commands.getAll()', async () => {
    (mockChrome.chrome.commands.getAll as any).mockResolvedValue([
      { name: '_execute_action', shortcut: 'Ctrl+Shift+O' },
      { name: 'open-side-panel', shortcut: 'Ctrl+Shift+P' },
    ]);

    await import('./onboarding');
    await flushPromises();

    expect(els.popupShortcutHint.textContent).toBe(' (or press Ctrl+Shift+O)');
    expect(els.panelShortcut.textContent).toBe('Ctrl+Shift+P');
  });

  it('clicking #closeBtn calls window.close()', async () => {
    await import('./onboarding');
    await flushPromises();

    await els.closeBtn.click();
    expect((globalThis as any).window.close).toHaveBeenCalledTimes(1);
  });

  it('clicking #openOptionsBtn calls chrome.runtime.openOptionsPage() and falls back to chrome.tabs.create if it throws', async () => {
    await import('./onboarding');
    await flushPromises();

    await els.openOptionsBtn.click();
    expect(mockChrome.chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);

    // Fallback when openOptionsPage throws synchronously
    vi.mocked(mockChrome.chrome.runtime.openOptionsPage).mockImplementationOnce(() => {
      throw new Error('openOptionsPage unsupported');
    });
    await els.openOptionsBtn.click();
    expect(mockChrome.chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/src/options.html',
    });
  });
});
