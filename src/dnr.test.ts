import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock } from './test/chrome-mock';
import { isSearchEngineUrl, rebuildDynamicRules } from './dnr';
import { SHORTCUT_PREFIX, upsertShortcut } from './storage';

let syncStore: Record<string, unknown>;
let dnrRules: chrome.declarativeNetRequest.Rule[];

// Every shortcut gets one rule per search engine (each regexFilter must stay
// small enough for Chrome to compile it - see dnr.ts).
const ENGINE_COUNT = 7;

beforeEach(() => {
  const mock = createChromeMock();
  globalThis.chrome = mock.chrome;
  syncStore = mock.syncStore;
  dnrRules = mock.dnrRules;
});

function regexOf(rule: chrome.declarativeNetRequest.Rule | undefined): RegExp {
  return new RegExp(rule?.condition.regexFilter ?? '');
}

function matchesAnyRule(url: string): boolean {
  return dnrRules.some((rule) => regexOf(rule).test(url));
}

function exactRulesFor(key: string): chrome.declarativeNetRequest.Rule[] {
  return dnrRules.filter((rule) => rule.priority === 1 && rule.condition.regexFilter?.includes(`q=${key}(?:`));
}

function googleRuleFor(key: string): chrome.declarativeNetRequest.Rule | undefined {
  return exactRulesFor(key).find((rule) =>
    rule.condition.regexFilter?.startsWith('^https?://(?:www\\.)?google\\.'),
  );
}

describe('rebuildDynamicRules', () => {
  it('removes all existing rules when the store is empty', async () => {
    dnrRules.push({
      id: 99, priority: 1,
      action: { type: 'redirect' as chrome.declarativeNetRequest.RuleActionType, redirect: { url: 'https://old.com' } },
      condition: { regexFilter: 'old', resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType] },
    });
    await rebuildDynamicRules();
    expect(dnrRules).toHaveLength(0);
  });

  it('assigns sequential IDs starting at 1', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    syncStore[`${SHORTCUT_PREFIX}yt`] = { key: 'yt', url: 'https://youtube.com', type: 'redirect' };
    await rebuildDynamicRules();
    const ids = dnrRules.map(r => r.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: ENGINE_COUNT * 2 }, (_, i) => i + 1));
  });

  it('creates one rule per search engine pointing at the shortcut URL', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    syncStore[`${SHORTCUT_PREFIX}yt`] = { key: 'yt', url: 'https://youtube.com', type: 'redirect' };
    await rebuildDynamicRules();
    expect(dnrRules).toHaveLength(ENGINE_COUNT * 2);
    const ghRules = dnrRules.filter(r => r.action.redirect?.url === 'https://github.com');
    const ytRules = dnrRules.filter(r => r.action.redirect?.url === 'https://youtube.com');
    expect(ghRules).toHaveLength(ENGINE_COUNT);
    expect(ytRules).toHaveLength(ENGINE_COUNT);
  });

  it('points a bundle rule at bundleUrls[0]', async () => {
    syncStore[`${SHORTCUT_PREFIX}work`] = {
      key: 'work', url: 'https://gmail.com', type: 'bundle',
      bundleUrls: ['https://gmail.com', 'https://calendar.google.com'],
    };
    await rebuildDynamicRules();
    expect(dnrRules).toHaveLength(ENGINE_COUNT);
    expect(dnrRules.every(r => r.action.redirect?.url === 'https://gmail.com')).toBe(true);
  });

  describe('generated regex', () => {
    beforeEach(async () => {
      syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
      await rebuildDynamicRules();
    });

    it('matches ?q=key at the end of a URL', () => {
      expect(regexOf(googleRuleFor('gh')).test('https://google.com/search?q=gh')).toBe(true);
    });

    it('matches &q=key mid-URL', () => {
      expect(regexOf(googleRuleFor('gh')).test('https://google.com/search?hl=en&q=gh')).toBe(true);
    });

    it('matches ?q=key& when followed by another parameter', () => {
      expect(regexOf(googleRuleFor('gh')).test('https://google.com/search?q=gh&hl=en')).toBe(true);
    });

    it('does not match a partial key (prefix of a longer word)', () => {
      expect(regexOf(googleRuleFor('gh')).test('https://google.com/search?q=ghub')).toBe(false);
    });

    it('does not match a random URL without the key', () => {
      expect(regexOf(googleRuleFor('gh')).test('https://google.com/search?q=youtube')).toBe(false);
    });

    // Regression: Chrome rejects rules whose compiled regex exceeds 2 KB, and
    // alternations are what blow that budget. One engine per rule keeps every
    // pattern far below the limit that used to reject the whole rule set.
    it('keeps every regexFilter small enough for Chrome to compile', () => {
      for (const rule of dnrRules) {
        expect((rule.condition.regexFilter ?? '').length).toBeLessThanOrEqual(160);
      }
    });

    it('embeds exactly one search engine per rule', () => {
      const signatures = [
        'google\\.', 'bing\\.com', 'duckduckgo\\.com', 'brave\\.com',
        'kagi\\.com', 'ecosia\\.org', 'startpage\\.com',
      ];
      for (const rule of dnrRules) {
        const filter = rule.condition.regexFilter ?? '';
        expect(signatures.filter((signature) => filter.includes(signature))).toHaveLength(1);
      }
    });
  });

  describe('parameterized shortcut', () => {
    beforeEach(async () => {
      syncStore[`${SHORTCUT_PREFIX}yt`] = {
        key: 'yt',
        url: 'https://youtube.com',
        type: 'parameterized',
        urlTemplate: 'https://youtube.com/results?search_query=%s',
      };
      await rebuildDynamicRules();
    });

    it('creates an exact-match and a capture-group rule per engine', () => {
      expect(dnrRules).toHaveLength(ENGINE_COUNT * 2);
      expect(dnrRules.filter(r => r.priority === 1)).toHaveLength(ENGINE_COUNT);
      expect(dnrRules.filter(r => r.priority === 2)).toHaveLength(ENGINE_COUNT);
    });

    it('exact-match rules redirect to the fallback URL', () => {
      const exact = dnrRules.find(r => r.priority === 1);
      expect(exact?.action.redirect?.url).toBe('https://youtube.com');
    });

    it('capture-group rules use regexSubstitution with \\1 placeholder', () => {
      const param = dnrRules.find(r => r.priority === 2);
      expect(param?.action.redirect?.regexSubstitution).toBe('https://youtube.com/results?search_query=\\1');
    });

    it('capture-group regex matches a Google URL with keyword + query', () => {
      const param = dnrRules.find(
        r => r.priority === 2 && r.condition.regexFilter?.startsWith('^https?://(?:www\\.)?google\\.'),
      );
      expect(regexOf(param).test('https://google.com/search?q=yt+lofi')).toBe(true);
    });

    it('capture-group regex does not match bare keyword (no query)', () => {
      const param = dnrRules.find(
        r => r.priority === 2 && r.condition.regexFilter?.startsWith('^https?://(?:www\\.)?google\\.'),
      );
      expect(regexOf(param).test('https://google.com/search?q=yt')).toBe(false);
    });

    it('capture-group regex captures query text for substitution', () => {
      const param = dnrRules.find(
        r => r.priority === 2 && r.condition.regexFilter?.startsWith('^https?://(?:www\\.)?google\\.'),
      );
      expect(regexOf(param).exec('https://google.com/search?q=yt+lofi+hip+hop')?.[1]).toBe('lofi+hip+hop');
    });
  });
});

describe('search-engine host scoping', () => {
  it('does not match ?q=key on a non-search-engine host', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    await rebuildDynamicRules();
    expect(matchesAnyRule('https://docs.example.com/page?q=gh')).toBe(false);
    expect(matchesAnyRule('https://www.google.co.uk/search?q=gh')).toBe(true);
    expect(matchesAnyRule('https://www.bing.com/search?q=gh&form=x')).toBe(true);
  });

  it('covers every supported search engine', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    await rebuildDynamicRules();
    for (const url of [
      'https://www.google.com/search?q=gh',
      'https://www.bing.com/search?q=gh',
      'https://duckduckgo.com/?q=gh',
      'https://search.brave.com/search?q=gh',
      'https://kagi.com/search?q=gh',
      'https://www.ecosia.org/search?q=gh',
      'https://www.startpage.com/sp/search?q=gh',
    ]) {
      expect(matchesAnyRule(url)).toBe(true);
    }
  });

  it('does not match Google subdomains like docs.google.com or drive.google.com', async () => {
    await upsertShortcut({ key: 'homelab', url: 'https://homelab.local', type: 'redirect' });
    await rebuildDynamicRules();
    expect(matchesAnyRule('https://docs.google.com/document/u/0/?q=homelab')).toBe(false);
    expect(matchesAnyRule('https://drive.google.com/drive/u/0/search?q=homelab')).toBe(false);
    expect(matchesAnyRule('https://mail.google.com/mail/u/0/?q=homelab')).toBe(false);
    expect(matchesAnyRule('https://calendar.google.com/calendar/u/0/r?q=homelab')).toBe(false);
    expect(matchesAnyRule('https://www.google.com/maps?q=homelab')).toBe(false);
    expect(matchesAnyRule('https://www.google.com/finance?q=homelab')).toBe(false);
  });

  it('allows parameterized search shortcuts pointing to Google Docs without shortcut override', async () => {
    await upsertShortcut({
      key: 'docs',
      url: 'https://docs.google.com',
      urlTemplate: 'https://docs.google.com/document/u/0/?q=%s',
      type: 'parameterized',
    });
    await upsertShortcut({
      key: 'homelab',
      url: 'https://homelab.local',
      type: 'redirect',
    });
    await rebuildDynamicRules();

    const docsParamRule = dnrRules.find(
      r => r.priority === 2 &&
        r.condition.regexFilter?.includes('q=docs') &&
        r.condition.regexFilter.startsWith('^https?://(?:www\\.)?google\\.'),
    );
    expect(docsParamRule).toBeDefined();
    expect(regexOf(docsParamRule).exec('https://www.google.com/search?q=docs+homelab')?.[1]).toBe('homelab');

    const homelabRule = googleRuleFor('homelab');
    expect(homelabRule).toBeDefined();
    // The Google Docs search URL must NOT be intercepted by the homelab rule
    expect(regexOf(homelabRule).test('https://docs.google.com/document/u/0/?q=homelab')).toBe(false);
  });

  it('isSearchEngineUrl recognises search hosts only', () => {
    expect(isSearchEngineUrl('https://www.google.com/search?q=x')).toBe(true);
    expect(isSearchEngineUrl('https://google.com/search?q=x')).toBe(true);
    expect(isSearchEngineUrl('https://duckduckgo.com/?q=x')).toBe(true);
    expect(isSearchEngineUrl('https://www.bing.com/search?q=x')).toBe(true);
    expect(isSearchEngineUrl('https://example.com/?q=x')).toBe(false);
    expect(isSearchEngineUrl('https://docs.google.com/document/u/0/?q=x')).toBe(false);
    expect(isSearchEngineUrl('https://drive.google.com/drive/u/0/search?q=x')).toBe(false);
    expect(isSearchEngineUrl('https://www.google.com/maps?q=x')).toBe(false);
  });
});

describe('malformed records', () => {
  it('skips a shortcut with no URL instead of aborting the rebuild', async () => {
    await chrome.storage.sync.set({
      [`${SHORTCUT_PREFIX}bad`]: { key: 'bad', url: '', type: 'redirect' },
      [`${SHORTCUT_PREFIX}ok`]: { key: 'ok', url: 'https://ok.com', type: 'redirect' },
    });
    await expect(rebuildDynamicRules()).resolves.toBeUndefined();
    expect(dnrRules).toHaveLength(ENGINE_COUNT);
    expect(dnrRules[0].condition.isUrlFilterCaseSensitive).toBe(false);
  });
});

describe('rejected rule recovery', () => {
  it('retries rule by rule when Chrome rejects the bulk update', async () => {
    const dnr = chrome.declarativeNetRequest;
    const original = dnr.updateDynamicRules.bind(dnr);
    let bulkAttempts = 0;

    dnr.updateDynamicRules = vi.fn(async (options: { removeRuleIds?: number[]; addRules?: chrome.declarativeNetRequest.Rule[] }) => {
      if ((options.addRules?.length ?? 0) > 1) {
        bulkAttempts++;
        throw new Error('Rule with id 1 was skipped as the "regexFilter" value exceeded the 2KB memory limit');
      }
      return original(options);
    }) as unknown as typeof dnr.updateDynamicRules;

    await chrome.storage.sync.set({
      [`${SHORTCUT_PREFIX}gh`]: { key: 'gh', url: 'https://github.com', type: 'redirect' },
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(rebuildDynamicRules()).resolves.toBeUndefined();
    warn.mockRestore();

    expect(bulkAttempts).toBe(1);
    // The atomic update failed, but the fallback still installed every rule.
    expect(dnrRules).toHaveLength(ENGINE_COUNT);
  });

  it('keeps the surviving rules when one rule alone is rejected', async () => {
    const dnr = chrome.declarativeNetRequest;
    const original = dnr.updateDynamicRules.bind(dnr);

    dnr.updateDynamicRules = vi.fn(async (options: { removeRuleIds?: number[]; addRules?: chrome.declarativeNetRequest.Rule[] }) => {
      const adds = options.addRules ?? [];
      if (adds.length > 1 || adds.some((r) => r.condition.regexFilter?.includes('q=bad'))) {
        throw new Error('Rule skipped');
      }
      return original(options);
    }) as unknown as typeof dnr.updateDynamicRules;

    await chrome.storage.sync.set({
      [`${SHORTCUT_PREFIX}bad`]: { key: 'bad', url: 'https://bad.example', type: 'redirect' },
      [`${SHORTCUT_PREFIX}ok`]: { key: 'ok', url: 'https://ok.com', type: 'redirect' },
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await rebuildDynamicRules();
    warn.mockRestore();
    error.mockRestore();

    expect(dnrRules).toHaveLength(ENGINE_COUNT);
    expect(dnrRules.every((r) => r.action.redirect?.url === 'https://ok.com')).toBe(true);
  });
});
