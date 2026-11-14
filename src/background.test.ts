import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChromeMock, makeChromeEvent, MockChromeEvent } from './test/chrome-mock';
import { DEFAULT_SETTINGS, STARTER_SHORTCUTS, Shortcut, Suggestion } from './types';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0';

let syncStore: Record<string, unknown>;
let localStore: Record<string, unknown>;
let sessionStore: Record<string, unknown>;
let dnrRules: chrome.declarativeNetRequest.Rule[];
let activeMock: ReturnType<typeof createChromeMock>;

function asMockEvent<T extends (...args: any[]) => any>(event: unknown): MockChromeEvent<T> {
  return event as MockChromeEvent<T>;
}

async function flushPromises(ticks = 25): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
}

async function loadBackground(userAgent = CHROME_UA) {
  vi.resetModules();
  const mock = createChromeMock();
  activeMock = mock;
  globalThis.chrome = mock.chrome;
  syncStore = mock.syncStore;
  localStore = mock.localStore;
  sessionStore = mock.sessionStore;
  dnrRules = mock.dnrRules;
  vi.stubGlobal('navigator', { userAgent });

  const storage = await import('./storage');
  await import('./background');
  await flushPromises();
  return { storage };
}

async function restartWorker(userAgent = EDGE_UA) {
  vi.resetModules();
  activeMock.resetListeners();
  globalThis.chrome = activeMock.chrome;
  vi.stubGlobal('navigator', { userAgent });

  const storage = await import('./storage');
  await import('./background');
  await flushPromises();
  return { storage };
}

beforeEach(async () => {
  await loadBackground(CHROME_UA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('1. Startup & Install Lifecycle (onInstalled, onStartup)', () => {
  it('onInstalled with reason="install" seeds starter shortcuts, opens onboarding, registers context menus, and builds DNR rules', async () => {
    await asMockEvent(chrome.runtime.onInstalled).emit({
      reason: 'install' as chrome.runtime.OnInstalledReason,
    });
    await flushPromises();

    // Starter shortcuts seeded
    const shortcutKeys = Object.keys(syncStore).filter((k) => k.startsWith('omnibar_s_'));
    expect(shortcutKeys).toHaveLength(STARTER_SHORTCUTS.length);
    expect(syncStore['omnibar_s_gh']).toMatchObject({
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    });

    // Onboarding tab opened
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/src/onboarding.html',
    });

    // Context menus registered
    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(chrome.contextMenus.create).toHaveBeenCalledWith({
      id: 'omnijump-save-page',
      title: 'Save Page as Shortcut',
      contexts: ['page'],
    });
    expect(chrome.contextMenus.create).toHaveBeenCalledWith({
      id: 'omnijump-save-link',
      title: 'Save Link as Shortcut',
      contexts: ['link'],
    });

    // DNR rules built for all starter shortcuts
    expect(dnrRules.length).toBeGreaterThan(0);
    expect(dnrRules.some((r) => r.action.redirect?.url === 'https://github.com')).toBe(true);
  });

  it('onInstalled with reason="update" does not re-seed starters or open onboarding, but still syncs rules and menus', async () => {
    syncStore['omnibar_s_custom'] = {
      key: 'custom',
      url: 'https://custom.example.com',
      type: 'redirect',
      createdAt: Date.now(),
    };

    await asMockEvent(chrome.runtime.onInstalled).emit({
      reason: 'update' as chrome.runtime.OnInstalledReason,
    });
    await flushPromises();

    expect(chrome.tabs.create).not.toHaveBeenCalled();
    const shortcutKeys = Object.keys(syncStore).filter((k) => k.startsWith('omnibar_s_'));
    expect(shortcutKeys).toEqual(['omnibar_s_custom']);
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(2);
    expect(dnrRules.some((r) => r.action.redirect?.url === 'https://custom.example.com')).toBe(true);
  });

  it('onStartup runs legacy migration, stale shortcut cleanup, and DNR rule sync', async () => {
    const DAY = 86_400_000;
    syncStore['omnibar_settings'] = {
      ...DEFAULT_SETTINGS,
      staleAutoDelete: true,
      staleDays: 30,
    };
    // Legacy single-key format shortcut (fresh)
    syncStore['omnibarShortcuts'] = {
      shortcuts: {
        gh: {
          key: 'gh',
          url: 'https://github.com',
          type: 'redirect',
          createdAt: Date.now() - 2 * DAY,
        },
      },
    };
    // Stale shortcut that should be cleaned up
    syncStore['omnibar_s_expired'] = {
      key: 'expired',
      url: 'https://expired.example.com',
      type: 'redirect',
      createdAt: Date.now() - 45 * DAY,
    };

    await asMockEvent(chrome.runtime.onStartup).emit();
    await flushPromises();

    // Legacy key removed and migrated to per-key format
    expect(syncStore['omnibarShortcuts']).toBeUndefined();
    expect(syncStore['omnibar_s_gh']).toMatchObject({
      key: 'gh',
      url: 'https://github.com',
    });

    // Stale shortcut deleted
    expect(syncStore['omnibar_s_expired']).toBeUndefined();

    // DNR rules built only for surviving shortcut
    expect(dnrRules.length).toBeGreaterThan(0);
    expect(dnrRules.every((r) => r.action.redirect?.url === 'https://github.com')).toBe(true);
  });
});

describe('2. Edge Instant Redirect (onBeforeNavigate) vs. Universal Fallback (onCommitted)', () => {
  it('in Edge mode, onBeforeNavigate immediately redirects via chrome.tabs.update and deduplicates subsequent onCommitted within 1,500 ms', async () => {
    await loadBackground(EDGE_UA);
    syncStore['omnibar_s_gh'] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    };

    const bingSearchUrl = 'https://www.bing.com/search?q=gh&form=QBLH';
    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 7,
      frameId: 0,
      url: bingSearchUrl,
    });
    await flushPromises();

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { url: 'https://github.com' });

    // Subsequent onCommitted for the same tab within 1,500 ms is deduplicated
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 7,
      frameId: 0,
      url: bingSearchUrl,
    });
    await flushPromises();

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);

    // Also verify Google search URL on another tab in Edge mode
    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 8,
      frameId: 0,
      url: 'https://www.google.com/search?q=gh',
    });
    await flushPromises();

    expect(chrome.tabs.update).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.update).toHaveBeenLastCalledWith(8, { url: 'https://github.com' });
  });

  it('in Chrome mode, onBeforeNavigate does NOT call chrome.tabs.update, while onCommitted acts as fallback', async () => {
    await loadBackground(CHROME_UA);
    syncStore['omnibar_s_gh'] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    };

    const googleSearchUrl = 'https://www.google.com/search?q=gh';
    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 12,
      frameId: 0,
      url: googleSearchUrl,
    });
    await flushPromises();

    // Native DNR handles onBeforeNavigate in Chrome
    expect(chrome.tabs.update).not.toHaveBeenCalled();

    // If navigation still commits to the search engine URL, fallback fires
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 12,
      frameId: 0,
      url: googleSearchUrl,
    });
    await flushPromises();

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.update).toHaveBeenCalledWith(12, { url: 'https://github.com' });
  });

  it('redirects parameterized shortcuts with query arguments and falls back to base URL when bare', async () => {
    await loadBackground(EDGE_UA);
    syncStore['omnibar_s_yt'] = {
      key: 'yt',
      url: 'https://www.youtube.com',
      urlTemplate: 'https://www.youtube.com/results?search_query=%s',
      type: 'parameterized',
    };

    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 21,
      frameId: 0,
      url: 'https://www.bing.com/search?q=yt+lofi+hip+hop',
    });
    await flushPromises();

    expect(chrome.tabs.update).toHaveBeenCalledWith(21, {
      url: 'https://www.youtube.com/results?search_query=lofi%20hip%20hop',
    });

    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 22,
      frameId: 0,
      url: 'https://www.bing.com/search?q=yt',
    });
    await flushPromises();

    expect(chrome.tabs.update).toHaveBeenCalledWith(22, {
      url: 'https://www.youtube.com',
    });
  });

  it('never passes unsafe non-HTTP target URLs to chrome.tabs.update', async () => {
    await loadBackground(EDGE_UA);
    syncStore['omnibar_s_xss'] = {
      key: 'xss',
      url: 'javascript:alert(1)',
      type: 'redirect',
    };
    syncStore['omnibar_s_badparam'] = {
      key: 'badparam',
      url: 'javascript:alert(1)',
      urlTemplate: 'javascript:alert("%s")',
      type: 'parameterized',
    };

    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 30,
      frameId: 0,
      url: 'https://www.google.com/search?q=xss',
    });
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 30,
      frameId: 0,
      url: 'https://www.google.com/search?q=badparam+payload',
    });
    await flushPromises();

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});

describe('3. Strict Query Parsing & False-Positive Prevention', () => {
  beforeEach(async () => {
    await loadBackground(EDGE_UA);
    syncStore['omnibar_s_c'] = {
      key: 'c',
      url: 'https://calendar.google.com',
      type: 'bundle',
      bundleUrls: ['https://calendar.google.com', 'https://mail.google.com'],
    };
    syncStore['omnibar_s_gh'] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    };
    syncStore['omnibar_s_yt'] = {
      key: 'yt',
      url: 'https://www.youtube.com',
      urlTemplate: 'https://www.youtube.com/results?search_query=%s',
      type: 'parameterized',
    };
    syncStore['omnibar_s_work'] = {
      key: 'work',
      url: 'https://slack.com',
      type: 'redirect',
    };
    syncStore['omnibar_s_work-docs'] = {
      key: 'work-docs',
      url: 'https://docs.google.com',
      type: 'bundle',
      bundleUrls: ['https://docs.google.com', 'https://drive.google.com'],
    };
    syncStore['omnibar_s_mail'] = {
      key: 'mail',
      url: 'https://mail.google.com',
      type: 'redirect',
    };
  });

  it('searching with punctuation (?q=c%2B%2B, ?q=gh%3F, ?q=yt%3A+music) does NOT redirect, open bundle tabs, or touch usage stats', async () => {
    for (const url of [
      'https://www.google.com/search?q=c%2B%2B',
      'https://www.google.com/search?q=gh%3F',
      'https://www.google.com/search?q=yt%3A+music',
    ]) {
      await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
        tabId: 40,
        frameId: 0,
        url,
      });
      await asMockEvent(chrome.webNavigation.onCommitted).emit({
        tabId: 40,
        frameId: 0,
        url,
      });
    }
    await flushPromises();

    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect((syncStore['omnibar_s_c'] as Shortcut).useCount).toBeUndefined();
    expect((syncStore['omnibar_s_gh'] as Shortcut).useCount).toBeUndefined();
    expect((syncStore['omnibar_s_yt'] as Shortcut).useCount).toBeUndefined();
  });

  it('multi-word search (?q=work+docs) does NOT trigger hyphenated bundle (work-docs) or redirect shortcut (work)', async () => {
    const url = 'https://www.google.com/search?q=work+docs';
    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 41,
      frameId: 0,
      url,
    });
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 41,
      frameId: 0,
      url,
    });
    await flushPromises();

    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect((syncStore['omnibar_s_work'] as Shortcut).useCount).toBeUndefined();
    expect((syncStore['omnibar_s_work-docs'] as Shortcut).useCount).toBeUndefined();
  });

  it('multi-word search (?q=mail+delivery) does NOT increment useCount on redirect shortcut mail', async () => {
    const url = 'https://www.bing.com/search?q=mail+delivery';
    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 42,
      frameId: 0,
      url,
    });
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 42,
      frameId: 0,
      url,
    });
    await flushPromises();

    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect((syncStore['omnibar_s_mail'] as Shortcut).useCount).toBeUndefined();
  });
});

describe('4. Bundle Navigation & Deduplication (handleBundleNavigation, shouldHandleBundle)', () => {
  beforeEach(async () => {
    await loadBackground(CHROME_UA);
    syncStore['omnibar_s_dev'] = {
      key: 'dev',
      url: 'https://github.com',
      type: 'bundle',
      bundleUrls: [
        'https://github.com',
        'https://linear.app',
        'javascript:alert(1)',
        'https://vercel.com',
      ],
    };
  });

  it('opens bundleUrls.slice(1) in background tabs with openerTabId, filtering out non-HTTP URLs', async () => {
    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 50,
      frameId: 0,
      url: 'https://www.google.com/search?q=dev',
    });
    await flushPromises();

    expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.create).toHaveBeenNthCalledWith(1, {
      url: 'https://linear.app',
      openerTabId: 50,
      active: false,
    });
    expect(chrome.tabs.create).toHaveBeenNthCalledWith(2, {
      url: 'https://vercel.com',
      openerTabId: 50,
      active: false,
    });
  });

  it('deduplicates rapid onBeforeNavigate events on the same tabId within 1,500 ms, allows different tabId, and cleans up on tabs.onRemoved', async () => {
    const navUrl = 'https://www.google.com/search?q=dev';

    // Two near-simultaneous events on tab 55
    await Promise.all([
      asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
        tabId: 55,
        frameId: 0,
        url: navUrl,
      }),
      asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
        tabId: 55,
        frameId: 0,
        url: navUrl,
      }),
    ]);
    await flushPromises();

    // Extra bundle tabs opened only once (2 valid extra URLs)
    expect(chrome.tabs.create).toHaveBeenCalledTimes(2);

    // A different tabId (56) opens normally
    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 56,
      frameId: 0,
      url: navUrl,
    });
    await flushPromises();

    expect(chrome.tabs.create).toHaveBeenCalledTimes(4);

    // Removing tab 55 clears both in-memory and session storage bundle trigger state
    await asMockEvent(chrome.tabs.onRemoved).emit(55);
    await flushPromises();

    const storedTriggers = (sessionStore['bundleTriggers'] ?? {}) as Record<number, number>;
    expect(storedTriggers[55]).toBeUndefined();
    expect(storedTriggers[56]).toBeTypeOf('number');

    // Re-triggering with tabId 55 after cleanup opens bundle tabs again
    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 55,
      frameId: 0,
      url: navUrl,
    });
    await flushPromises();

    expect(chrome.tabs.create).toHaveBeenCalledTimes(6);
  });
});

describe('5. Smart DNR Rebuild Filtering on storage.onChanged', () => {
  it('touchShortcut does NOT trigger a redundant DNR rule rebuild, whereas updating URL or adding a shortcut DOES', async () => {
    vi.useFakeTimers();
    const { storage } = await loadBackground(CHROME_UA);

    // Adding a shortcut triggers a debounced DNR rebuild
    await storage.upsertShortcut({
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    });
    await vi.advanceTimersByTimeAsync(60);
    await flushPromises();

    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalled();
    vi.mocked(chrome.declarativeNetRequest.updateDynamicRules).mockClear();

    // Touching usage stats only updates useCount and lastUsed -> must NOT rebuild DNR rules
    await storage.touchShortcut('gh');
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises();

    expect(chrome.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
    expect((syncStore['omnibar_s_gh'] as Shortcut).useCount).toBe(1);

    // Updating the shortcut's URL DOES trigger a debounced DNR rebuild
    await storage.upsertShortcut({
      key: 'gh',
      url: 'https://github.com/organizations',
      type: 'redirect',
    });
    await vi.advanceTimersByTimeAsync(60);
    await flushPromises();

    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledTimes(1);
    expect(dnrRules.every((r) => r.action.redirect?.url === 'https://github.com/organizations')).toBe(
      true,
    );
  });
});

describe('6. Smart Tips Engine (handleSmartTip)', () => {
  beforeEach(async () => {
    await loadBackground(CHROME_UA);
    syncStore['omnibar_settings'] = {
      ...DEFAULT_SETTINGS,
      smartSuggestions: true,
    };
  });

  it('stores suggestion_${tabId} and sets TIP badge on the 3rd visit to an uncovered HTTP host', async () => {
    // Visit 1 to stackoverflow.com on tab 1
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 1,
      frameId: 0,
      url: 'https://stackoverflow.com/questions/1',
    });
    await flushPromises();
    expect(sessionStore['suggestion_1']).toBeUndefined();

    // Navigate away -> finalizes visit 1
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 1,
      frameId: 0,
      url: 'https://news.ycombinator.com/',
    });
    await flushPromises();

    // Visit 2 to stackoverflow.com
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 1,
      frameId: 0,
      url: 'https://stackoverflow.com/questions/2',
    });
    await flushPromises();
    expect(sessionStore['suggestion_1']).toBeUndefined();

    // Close tab 1 -> finalizes visit 2
    await asMockEvent(chrome.tabs.onRemoved).emit(1);
    await flushPromises();

    // Visit 3 on tab 2 -> crosses TIP_THRESHOLD (3)
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 2,
      frameId: 0,
      url: 'https://www.stackoverflow.com/questions/3',
    });
    await flushPromises();

    expect(sessionStore['suggestion_2']).toEqual<Suggestion>({
      key: 'sta',
      url: 'https://stackoverflow.com/',
      siteName: 'Stack Overflow',
      host: 'stackoverflow.com',
    });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#4c6ef5' });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 2, text: 'TIP' });
  });

  it('collects no visit data at all when smartSuggestions is disabled', async () => {
    syncStore['omnibar_settings'] = {
      ...DEFAULT_SETTINGS,
      smartSuggestions: false,
    };

    // Repeatedly hop between two uncovered hosts — enough to cross the tip
    // threshold if any counting were happening.
    for (let i = 0; i < 4; i++) {
      await asMockEvent(chrome.webNavigation.onCommitted).emit({
        tabId: 3,
        frameId: 0,
        url: `https://example.com/page-${i}`,
      });
      await asMockEvent(chrome.webNavigation.onCommitted).emit({
        tabId: 3,
        frameId: 0,
        url: `https://other-site.example.org/page-${i}`,
      });
    }
    await flushPromises(60);

    expect(sessionStore['searchVisitCounts']).toBeUndefined();
    expect(sessionStore['suggestion_3']).toBeUndefined();
    expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 3, text: 'TIP' });
  });

  it('never triggers smart tips for subdomains of blocklisted search engines', async () => {
    const blocklistedUrls = [
      'https://search.brave.com/search?q=test',
      'https://cn.bing.com/search?q=test',
      'https://html.duckduckgo.com/html?q=test',
      'https://www.google.co.uk/search?q=test',
    ];

    for (const targetUrl of blocklistedUrls) {
      for (let i = 0; i < 4; i++) {
        await asMockEvent(chrome.webNavigation.onCommitted).emit({
          tabId: 5,
          frameId: 0,
          url: targetUrl,
        });
        await asMockEvent(chrome.webNavigation.onCommitted).emit({
          tabId: 5,
          frameId: 0,
          url: `https://uncovered-${i}.example.org/`,
        });
      }
    }
    await flushPromises(60);

    const counts = (sessionStore['searchVisitCounts'] ?? {}) as Record<string, number>;
    expect(counts['search.brave.com']).toBeUndefined();
    expect(counts['cn.bing.com']).toBeUndefined();
    expect(counts['html.duckduckgo.com']).toBeUndefined();
    expect(counts['google.co.uk']).toBeUndefined();
  });

  it('never triggers smart tips for localhost / loopback hosts', async () => {
    const loopbackUrls = [
      'http://localhost:3000/dev-server',
      'http://api.localhost:3000/tenant',
      'http://127.0.0.1:8080/admin',
      'http://[::1]:3000/page',
    ];

    for (const targetUrl of loopbackUrls) {
      for (let i = 0; i < 4; i++) {
        await asMockEvent(chrome.webNavigation.onCommitted).emit({
          tabId: 6,
          frameId: 0,
          url: targetUrl,
        });
        await asMockEvent(chrome.webNavigation.onCommitted).emit({
          tabId: 6,
          frameId: 0,
          url: `https://uncovered-${i}.example.org/`,
        });
      }
    }
    await flushPromises(60);

    const counts = (sessionStore['searchVisitCounts'] ?? {}) as Record<string, number>;
    expect(counts['localhost']).toBeUndefined();
    expect(counts['api.localhost']).toBeUndefined();
    expect(counts['127.0.0.1']).toBeUndefined();
    expect(counts['[::1]']).toBeUndefined();
    expect(sessionStore['suggestion_6']).toBeUndefined();
    expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 6, text: 'TIP' });
  });

  it('clears suggestion_${tabId} and TIP badge when navigating away to a site with < 3 visits, a blocklisted search engine, or a non-HTTP URL', async () => {
    // Seed 2 prior visits to github.com so next visit triggers TIP
    sessionStore['searchVisitCounts'] = { 'github.com': 2 };

    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 9,
      frameId: 0,
      url: 'https://github.com/trending',
    });
    await flushPromises();

    expect(sessionStore['suggestion_9']).toBeDefined();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 9, text: 'TIP' });

    // 1) Navigate to another site with < 3 visits -> clears suggestion_9 and badge
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 9,
      frameId: 0,
      url: 'https://fresh-domain.example.com/',
    });
    await flushPromises();

    expect(sessionStore['suggestion_9']).toBeUndefined();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 9, text: '' });

    // Re-trigger TIP on tab 9 by visiting github.com again
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 9,
      frameId: 0,
      url: 'https://github.com/pulls',
    });
    await flushPromises();
    expect(sessionStore['suggestion_9']).toBeDefined();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 9, text: 'TIP' });

    // 2) Navigate to a blocklisted search engine -> clears suggestion_9 and badge
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 9,
      frameId: 0,
      url: 'https://search.brave.com/search?q=vitest',
    });
    await flushPromises();

    expect(sessionStore['suggestion_9']).toBeUndefined();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 9, text: '' });

    // Re-trigger TIP on tab 9 and then navigate to non-HTTP URL
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 9,
      frameId: 0,
      url: 'https://github.com/issues',
    });
    await flushPromises();
    expect(sessionStore['suggestion_9']).toBeDefined();

    // 3) Navigate to a non-HTTP URL -> clears suggestion_9 and badge
    await asMockEvent(chrome.webNavigation.onCommitted).emit({
      tabId: 9,
      frameId: 0,
      url: 'chrome://extensions/',
    });
    await flushPromises();

    expect(sessionStore['suggestion_9']).toBeUndefined();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 9, text: '' });
  });
});

describe('7. Omnibox "oj" Keyword (onInputChanged, onInputEntered)', () => {
  beforeEach(async () => {
    await loadBackground(CHROME_UA);
    syncStore['omnibar_s_low'] = {
      key: 'low',
      url: 'https://low.example.com',
      type: 'redirect',
      useCount: 1,
      lastUsed: 1000,
    };
    syncStore['omnibar_s_high'] = {
      key: 'high',
      url: 'https://high.example.com/?a=1&b=<2>"\'',
      type: 'redirect',
      useCount: 10,
      lastUsed: 2000,
    };
    syncStore['omnibar_s_yt'] = {
      key: 'yt',
      url: 'https://www.youtube.com',
      urlTemplate: 'https://www.youtube.com/results?search_query=%s\x00\x07',
      type: 'parameterized',
      useCount: 5,
      lastUsed: 3000,
    };
    syncStore['omnibar_s_bundle'] = {
      key: 'bundle',
      url: 'https://one.example.com',
      type: 'bundle',
      bundleUrls: [
        'https://one.example.com',
        'https://two.example.com',
        'javascript:evil()',
        'https://three.example.com',
      ],
      useCount: 3,
      lastUsed: 1500,
    };
  });

  it('onInputChanged returns usage-sorted suggestions when empty, live %s preview with args, and escapes XML / strips C0 control chars', async () => {
    const suggestEmpty = vi.fn();
    await asMockEvent(chrome.omnibox.onInputChanged).emit('', suggestEmpty);
    await flushPromises();

    expect(suggestEmpty).toHaveBeenCalledTimes(1);
    const emptyResults = suggestEmpty.mock.calls[0][0] as chrome.omnibox.SuggestResult[];
    expect(emptyResults.map((r) => r.content)).toEqual(['high', 'yt', 'bundle', 'low']);

    // Verify XML escaping on 'high'
    expect(emptyResults[0].description).toBe(
      '<match>high</match> <dim>—</dim> <url>https://high.example.com/?a=1&amp;b=&lt;2&gt;&quot;&apos;</url>',
    );

    // Verify fuzzy filtering + live %s substitution + C0 control char stripping
    const suggestArgs = vi.fn();
    await asMockEvent(chrome.omnibox.onInputChanged).emit('yt rock & roll', suggestArgs);
    await flushPromises();

    expect(suggestArgs).toHaveBeenCalledTimes(1);
    const argResults = suggestArgs.mock.calls[0][0] as chrome.omnibox.SuggestResult[];
    expect(argResults[0]).toEqual({
      content: 'yt rock & roll',
      description:
        '<match>yt</match> <dim>—</dim> <url>https://www.youtube.com/results?search_query=rock%20%26%20roll</url>',
    });
  });

  it('onInputEntered handles currentTab, newForegroundTab, and newBackgroundTab dispositions for redirect, parameterized, and bundle shortcuts', async () => {
    // 1. Redirect shortcut in currentTab
    await asMockEvent(chrome.omnibox.onInputEntered).emit('low', 'currentTab');
    await flushPromises();

    expect(chrome.tabs.update).toHaveBeenCalledWith({ url: 'https://low.example.com' });
    expect((syncStore['omnibar_s_low'] as Shortcut).useCount).toBe(2);

    // 2. Parameterized shortcut with args in newForegroundTab
    await asMockEvent(chrome.omnibox.onInputEntered).emit('yt synthwave mix', 'newForegroundTab');
    await flushPromises();

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://www.youtube.com/results?search_query=synthwave%20mix',
      active: true,
    });
    expect((syncStore['omnibar_s_yt'] as Shortcut).useCount).toBe(6);

    // 3. Bundle shortcut in newBackgroundTab opens first URL with disposition and HTTP rest in background
    vi.mocked(chrome.tabs.create).mockClear();
    await asMockEvent(chrome.omnibox.onInputEntered).emit('bundle', 'newBackgroundTab');
    await flushPromises();

    expect(chrome.tabs.create).toHaveBeenCalledTimes(3);
    expect(chrome.tabs.create).toHaveBeenNthCalledWith(1, {
      url: 'https://one.example.com',
      active: false,
    });
    expect(chrome.tabs.create).toHaveBeenNthCalledWith(2, {
      url: 'https://two.example.com',
      active: false,
    });
    expect(chrome.tabs.create).toHaveBeenNthCalledWith(3, {
      url: 'https://three.example.com',
      active: false,
    });
    expect((syncStore['omnibar_s_bundle'] as Shortcut).useCount).toBe(4);
  });
});

describe('8. Context Menus & Sidepanel Toggle Command', () => {
  it('saves link or page URL with a unique key and flashes "✓" badge when context menu is clicked', async () => {
    vi.useFakeTimers();
    await loadBackground(CHROME_UA);

    // Seed 'git' so saving another github.com URL must pick a unique key ('git2')
    syncStore['omnibar_s_git'] = {
      key: 'git',
      url: 'https://github.com',
      type: 'redirect',
    };

    // Click omnijump-save-link
    await asMockEvent(chrome.contextMenus.onClicked).emit(
      {
        menuItemId: 'omnijump-save-link',
        linkUrl: 'https://github.com/vitest-dev/vitest',
        editable: false,
        pageUrl: 'https://news.ycombinator.com',
      } as chrome.contextMenus.OnClickData,
      { id: 77, url: 'https://news.ycombinator.com' } as chrome.tabs.Tab,
    );
    await flushPromises();

    expect(syncStore['omnibar_s_git2']).toMatchObject({
      key: 'git2',
      url: 'https://github.com/vitest-dev/vitest',
      type: 'redirect',
    });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#27ae60' });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 77, text: '✓' });

    // Badge clears after 2,500 ms
    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 77, text: '' });

    // Click omnijump-save-page
    await asMockEvent(chrome.contextMenus.onClicked).emit(
      {
        menuItemId: 'omnijump-save-page',
        editable: false,
        pageUrl: 'https://linear.app/features',
      } as chrome.contextMenus.OnClickData,
      { id: 78, url: 'https://linear.app/features' } as chrome.tabs.Tab,
    );
    await flushPromises();

    expect(syncStore['omnibar_s_lin']).toMatchObject({
      key: 'lin',
      url: 'https://linear.app/features',
      type: 'redirect',
    });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 78, text: '✓' });
  });

  it('open-side-panel command opens the sidepanel when closed and posts { type: "close-panel" } when connected', async () => {
    // 1. Panel is closed -> opens sidePanel for tab
    await asMockEvent(chrome.commands.onCommand).emit('open-side-panel', {
      id: 88,
    } as chrome.tabs.Tab);

    expect(chrome.sidePanel.open).toHaveBeenCalledTimes(1);
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 88 });

    // 2. Connect sidepanel port
    const mockPort = {
      name: 'sidepanel',
      onMessage: makeChromeEvent(),
      onDisconnect: makeChromeEvent(),
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    };
    await asMockEvent(chrome.runtime.onConnect).emit(mockPort as unknown as chrome.runtime.Port);

    // 3. Triggering open-side-panel while connected sends close-panel message instead of opening
    await asMockEvent(chrome.commands.onCommand).emit('open-side-panel', {
      id: 88,
    } as chrome.tabs.Tab);

    expect(mockPort.postMessage).toHaveBeenCalledTimes(1);
    expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'close-panel' });
    expect(chrome.sidePanel.open).toHaveBeenCalledTimes(1);

    // 4. Subsequent command opens the side panel again
    await asMockEvent(chrome.commands.onCommand).emit('open-side-panel', {
      id: 88,
    } as chrome.tabs.Tab);

    expect(chrome.sidePanel.open).toHaveBeenCalledTimes(2);
  });

  it('patches cachedStore in-place on storage.onChanged without re-reading storage.sync.get(null)', async () => {
    const { storage } = await loadBackground(EDGE_UA);
    await storage.upsertShortcut({
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    });
    await flushPromises();

    // First jump warms cachedStore if not already warm
    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      frameId: 0,
      tabId: 90,
      url: 'https://www.google.com/search?q=gh',
    } as chrome.webNavigation.WebNavigationParentedCallbackDetails);
    await flushPromises();

    // Clear spy call history after initial warm-up + touchShortcut
    vi.mocked(chrome.storage.sync.get).mockClear();

    // Update gh URL via upsertShortcut (which triggers storage.onChanged -> in-place patch)
    await storage.upsertShortcut({
      key: 'gh',
      url: 'https://github.com/trending',
      type: 'redirect',
    });
    await flushPromises();

    // Reset spy after upsertShortcut's own read
    vi.mocked(chrome.storage.sync.get).mockClear();

    // Triggering omnibox suggestion should read from the patched in-memory cachedStore without calling sync.get
    const suggest = vi.fn();
    await asMockEvent(chrome.omnibox.onInputChanged).emit('gh', suggest);
    await flushPromises();

    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
    expect(suggest).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'gh',
          description: expect.stringContaining('https://github.com/trending'),
        }),
      ]),
    );
  });
});

describe('9. Session Mirror & MV3 Service Worker Pre-Warming (Option A)', () => {
  function fullSyncReads(): unknown[][] {
    const calls = vi.mocked(chrome.storage.sync.get).mock.calls as unknown[][];
    return calls.filter((c) => c[0] === null || c[0] === undefined);
  }

  it('redirects a cold-restarted Edge service worker straight from chrome.storage.session with zero full sync reads (even if sync hangs)', async () => {
    vi.useFakeTimers();
    const { storage } = await loadBackground(EDGE_UA);
    await storage.upsertShortcut({
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    });
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises(40);

    // Simulate MV3 service worker termination after 30s idle (module state wiped, sessionStore preserved)
    await restartWorker(EDGE_UA);
    vi.mocked(chrome.storage.sync.get).mockClear();
    vi.mocked(chrome.tabs.update).mockClear();

    // Even if chrome.storage.sync hangs indefinitely, onBeforeNavigate redirects via storage.session
    vi.mocked(chrome.storage.sync.get).mockImplementation(() => new Promise(() => {}));

    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 101,
      frameId: 0,
      url: 'https://www.bing.com/search?q=gh',
    } as chrome.webNavigation.WebNavigationParentedCallbackDetails);
    await flushPromises(40);

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.update).toHaveBeenCalledWith(101, { url: 'https://github.com' });
    expect(fullSyncReads()).toHaveLength(0);
  });

  function fullSessionReads(): unknown[][] {
    const calls = vi.mocked(chrome.storage.session.get).mock.calls as unknown[][];
    return calls.filter((c) => c[0] === null || c[0] === undefined);
  }

  it.each([
    ['tabs.onCreated', () => asMockEvent(chrome.tabs.onCreated).emit({ id: 5, windowId: 1 } as chrome.tabs.Tab)],
    ['tabs.onActivated', () => asMockEvent(chrome.tabs.onActivated).emit({ tabId: 5, windowId: 1 })],
    ['windows.onFocusChanged', () => asMockEvent(chrome.windows.onFocusChanged).emit(1)],
  ])('pre-warms cachedStore on %s so subsequent Edge onBeforeNavigate reads purely from memory', async (_name, trigger) => {
    vi.useFakeTimers();
    await loadBackground(EDGE_UA);
    syncStore['omnibar_s_gh'] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    };

    await trigger();
    await flushPromises(40);

    // Tamper with both underlying storage tiers + clear spies to prove the redirect
    // is served 100% from Tier 1 (in-memory cachedStore) with zero full-store reads
    syncStore['omnibar_s_gh'] = {
      key: 'gh',
      url: 'https://tampered-sync.example.com',
      type: 'redirect',
    };
    sessionStore['omnibar_s_gh'] = {
      key: 'gh',
      url: 'https://tampered-session.example.com',
      type: 'redirect',
    };
    vi.mocked(chrome.storage.sync.get).mockClear();
    vi.mocked(chrome.storage.session.get).mockClear();

    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 102,
      frameId: 0,
      url: 'https://www.google.com/search?q=gh',
    } as chrome.webNavigation.WebNavigationParentedCallbackDetails);
    await flushPromises(40);

    expect(chrome.tabs.update).toHaveBeenCalledWith(102, { url: 'https://github.com' });
    expect(fullSyncReads()).toHaveLength(0);
    expect(fullSessionReads()).toHaveLength(0);
  });

  it('ignores windows.onFocusChanged(WINDOW_ID_NONE) when browser loses focus', async () => {
    await loadBackground(EDGE_UA);
    syncStore['omnibar_s_gh'] = {
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    };
    vi.mocked(chrome.storage.sync.get).mockClear();

    await asMockEvent(chrome.windows.onFocusChanged).emit(chrome.windows.WINDOW_ID_NONE);
    await flushPromises(30);

    expect(fullSyncReads()).toHaveLength(0);
    expect(sessionStore['omnibar_store_meta']).toBeUndefined();
  });

  it('propagates cross-device deletes arriving via storage.onChanged while cachedStore is cold', async () => {
    vi.useFakeTimers();
    const { storage } = await loadBackground(EDGE_UA);
    await storage.upsertShortcut({
      key: 'gh',
      url: 'https://github.com',
      type: 'redirect',
    });
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises(40);

    // Worker goes cold, leaving omnibar_s_gh in sessionStore
    await restartWorker(EDGE_UA);
    expect(sessionStore['omnibar_s_gh']).toBeDefined();

    // Cross-device sync removes gh while cachedStore === null
    await chrome.storage.sync.remove('omnibar_s_gh');
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises(40);

    expect(sessionStore['omnibar_s_gh']).toBeUndefined();

    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 103,
      frameId: 0,
      url: 'https://www.bing.com/search?q=gh',
    } as chrome.webNavigation.WebNavigationParentedCallbackDetails);
    await flushPromises(40);

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('drops stale in-flight sync reads when storage.onChanged mutates a shortcut mid-flight', async () => {
    vi.useFakeTimers();
    await loadBackground(EDGE_UA);
    syncStore['omnibar_s_gh'] = {
      key: 'gh',
      url: 'https://old.example.com',
      type: 'redirect',
    };

    let resolveSlowSync!: (val: Record<string, unknown>) => void;
    vi.mocked(chrome.storage.sync.get).mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((res) => {
          resolveSlowSync = res;
        }) as unknown as Promise<Record<string, any>>,
    );

    // Start pre-warming (hits slow sync.get(null) because sessionStore is empty)
    const warmPromise = asMockEvent(chrome.tabs.onCreated).emit({ id: 9, windowId: 1 } as chrome.tabs.Tab);
    await flushPromises(5);

    // While sync.get(null) is still in-flight, an update arrives via storage.sync.set -> onChanged bumps epoch
    await chrome.storage.sync.set({
      omnibar_s_gh: {
        key: 'gh',
        url: 'https://new.example.com',
        type: 'redirect',
      },
    });

    // Now resolve the stale snapshot from before the update
    resolveSlowSync({
      omnibar_s_gh: {
        key: 'gh',
        url: 'https://old.example.com',
        type: 'redirect',
      },
    });
    await warmPromise;
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises(40);

    await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
      tabId: 104,
      frameId: 0,
      url: 'https://www.bing.com/search?q=gh',
    } as chrome.webNavigation.WebNavigationParentedCallbackDetails);
    await flushPromises(40);

    expect(chrome.tabs.update).toHaveBeenCalledWith(104, { url: 'https://new.example.com' });
  });

  it('never matches Object.prototype keys like "constructor" or "toString"', async () => {
    await loadBackground(EDGE_UA);
    await asMockEvent(chrome.tabs.onCreated).emit({ id: 1, windowId: 1 } as chrome.tabs.Tab);
    await flushPromises(30);
    vi.mocked(chrome.storage.sync.get).mockClear();

    for (const protoKey of ['constructor', 'toString', 'valueOf']) {
      await asMockEvent(chrome.webNavigation.onBeforeNavigate).emit({
        tabId: 105,
        frameId: 0,
        url: `https://www.bing.com/search?q=${protoKey}`,
      } as chrome.webNavigation.WebNavigationParentedCallbackDetails);
    }
    await flushPromises(30);

    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
  });
});

describe('10. Settings-change cleanup trigger', () => {
  it('does not run stale cleanup on the first settings write when stale fields match defaults', async () => {
    const { storage } = await loadBackground(CHROME_UA);
    const old = Date.now() - 100 * 86_400_000;
    syncStore[`${storage.SHORTCUT_PREFIX}old`] = {
      key: 'old',
      url: 'https://old.example',
      type: 'redirect',
      createdAt: old,
      lastUsed: old,
    };

    await chrome.storage.sync.set({
      [storage.SETTINGS_KEY]: { ...DEFAULT_SETTINGS, darkMode: true },
    });
    await flushPromises(50);

    expect(syncStore[`${storage.SHORTCUT_PREFIX}old`]).toBeDefined();
  });

  it('still runs cleanup when stale settings actually change', async () => {
    const { storage } = await loadBackground(CHROME_UA);
    const old = Date.now() - 100 * 86_400_000;
    syncStore[`${storage.SHORTCUT_PREFIX}old`] = {
      key: 'old',
      url: 'https://old.example',
      type: 'redirect',
      createdAt: old,
      lastUsed: old,
    };

    await chrome.storage.sync.set({
      [storage.SETTINGS_KEY]: { ...DEFAULT_SETTINGS, staleDays: 30 },
    });
    await flushPromises(60);

    expect(syncStore[`${storage.SHORTCUT_PREFIX}old`]).toBeUndefined();
  });
});
