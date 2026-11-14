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

    it('matches when the query has trailing encoded whitespace (?q=gh+ or ?q=gh%20)', () => {
      expect(regexOf(googleRuleFor('gh')).test('https://google.com/search?q=gh+')).toBe(true);
      expect(regexOf(googleRuleFor('gh')).test('https://google.com/search?q=gh%20&hl=en')).toBe(true);
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

    it('capture-group regex stops before trailing query parameters (&oq=... or &form=QBLH)', () => {
      const param = dnrRules.find(
        r => r.priority === 2 && r.condition.regexFilter?.startsWith('^https?://(?:www\\.)?google\\.'),
      );
      expect(
        regexOf(param).exec('https://www.google.com/search?q=yt+lofi+beats&oq=yt+lofi&ie=UTF-8')?.[1],
      ).toBe('lofi+beats');
    });

    it('capture-group regex collapses multiple spaces after keyword without capturing leading +', () => {
      const param = dnrRules.find(
        r => r.priority === 2 && r.condition.regexFilter?.startsWith('^https?://(?:www\\.)?google\\.'),
      );
      expect(regexOf(param).exec('https://www.google.com/search?q=yt++lofi')?.[1]).toBe('lofi');
      expect(regexOf(param).exec('https://www.google.com/search?q=yt+%20lofi')?.[1]).toBe('lofi');
    });

    it('does not capture &form=QBLH when keyword has trailing space and no search query (?q=yt+&form=QBLH)', () => {
      const bingParam = dnrRules.find(
        r => r.priority === 2 && r.condition.regexFilter?.includes('bing\\.com'),
      );
      const bingExact = dnrRules.find(
        r => r.priority === 1 && r.condition.regexFilter?.includes('bing\\.com'),
      );
      expect(regexOf(bingParam).test('https://www.bing.com/search?q=yt+&form=QBLH')).toBe(false);
      expect(regexOf(bingExact).test('https://www.bing.com/search?q=yt+&form=QBLH')).toBe(true);
    });

    it('escapes literal backslashes and replaces all %s occurrences in regexSubstitution', async () => {
      syncStore[`${SHORTCUT_PREFIX}multi`] = {
        key: 'multi',
        url: 'https://example.com',
        type: 'parameterized',
        urlTemplate: 'https://example.com/?q=%s&r=%s&p=a\\b',
      };
      await rebuildDynamicRules();
      const param = dnrRules.find(
        r => r.priority === 2 && r.condition.regexFilter?.includes('q=multi'),
      );
      expect(param?.action.redirect?.regexSubstitution).toBe('https://example.com/?q=\\1&r=\\1&p=a\\\\b');
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
    expect(isSearchEngineUrl('https://www.bing.com/search/?q=x&form=QBLH')).toBe(true);
    expect(isSearchEngineUrl('https://cn.bing.com/search?q=x')).toBe(true);
    expect(isSearchEngineUrl('https://www2.bing.com/search?q=x')).toBe(true);
    expect(isSearchEngineUrl('https://www4.bing.com/search/?q=x')).toBe(true);
    expect(isSearchEngineUrl('https://example.com/?q=x')).toBe(false);
    expect(isSearchEngineUrl('https://docs.google.com/document/u/0/?q=x')).toBe(false);
    expect(isSearchEngineUrl('https://drive.google.com/drive/u/0/search?q=x')).toBe(false);
    expect(isSearchEngineUrl('https://www.google.com/maps?q=x')).toBe(false);
  });
});

describe('Google host hardening (TLD restriction)', () => {
  it('still matches the Google host shapes Google actually operates', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    await rebuildDynamicRules();
    for (const url of [
      'https://google.com/search?q=gh',
      'https://www.google.com/search?q=gh',
      'https://www.google.co.uk/search?q=gh',
      'https://google.com.au/search?q=gh',
      'https://www.google.co.in/search?q=gh',
      'https://google.ca/search?q=gh',
      'https://google.de/search?q=gh',
      'https://www.google.cat/search?q=gh',
      'https://google.co/search?q=gh',
      'https://www.google.com/webhp?q=gh',
    ]) {
      expect(matchesAnyRule(url)).toBe(true);
    }
  });

  it('rejects attacker-registerable google.* lookalike hosts', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    await rebuildDynamicRules();
    for (const url of [
      'https://google.evil.com/search?q=gh',
      'https://www.google.evil.com/search?q=gh',
      'https://google.evil.co/?q=gh',
      'https://google.co.uk.evil.com/search?q=gh',
      'https://www.google.de.evil.com/search?q=gh',
      'https://google.net.evil.io/search?q=gh',
    ]) {
      expect(matchesAnyRule(url)).toBe(false);
    }
  });

  it('isSearchEngineUrl shares the hardened pattern', () => {
    expect(isSearchEngineUrl('https://www.google.co.in/search?q=x')).toBe(true);
    expect(isSearchEngineUrl('https://google.com.au/search?q=x')).toBe(true);
    expect(isSearchEngineUrl('https://google.evil.com/search?q=x')).toBe(false);
    expect(isSearchEngineUrl('https://www.google.evil.com/search?q=x')).toBe(false);
    expect(isSearchEngineUrl('https://google.co.uk.evil.com/search?q=x')).toBe(false);
  });
});

describe('malformed records and concurrency', () => {
  it('skips a shortcut with no URL or unsafe/malformed URL instead of aborting the rebuild', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await chrome.storage.sync.set({
      [`${SHORTCUT_PREFIX}bad`]: { key: 'bad', url: '', type: 'redirect' },
      [`${SHORTCUT_PREFIX}js`]: { key: 'js', url: 'javascript:alert(1)', type: 'redirect' },
      [`${SHORTCUT_PREFIX}data`]: { key: 'data', url: 'data:text/html,hi', type: 'redirect' },
      [`${SHORTCUT_PREFIX}file`]: { key: 'file', url: 'file:///etc/passwd', type: 'redirect' },
      [`${SHORTCUT_PREFIX}hostless`]: { key: 'hostless', url: 'https://', type: 'redirect' },
      [`${SHORTCUT_PREFIX}spaces`]: { key: 'spaces', url: 'https://bad host', type: 'redirect' },
      [`${SHORTCUT_PREFIX}ok`]: { key: 'ok', url: 'https://ok.com', type: 'redirect' },
    });
    await expect(rebuildDynamicRules()).resolves.toBeUndefined();
    warn.mockRestore();
    expect(dnrRules).toHaveLength(ENGINE_COUNT);
    expect(dnrRules[0].condition.isUrlFilterCaseSensitive).toBe(false);
  });

  it('serializes concurrent rebuildDynamicRules calls without duplicate rule ID collisions', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    syncStore[`${SHORTCUT_PREFIX}yt`] = { key: 'yt', url: 'https://youtube.com', type: 'redirect' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await Promise.all([rebuildDynamicRules(), rebuildDynamicRules(), rebuildDynamicRules()]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    const ids = dnrRules.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(dnrRules).toHaveLength(ENGINE_COUNT * 2);
  });

  it('caps rules at MAX_DYNAMIC_RULES (5000) when the regex quota is higher', async () => {
    Object.defineProperty(chrome.declarativeNetRequest, 'MAX_NUMBER_OF_REGEX_RULES', {
      configurable: true,
      value: 5000,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 720; i++) {
      syncStore[`${SHORTCUT_PREFIX}k${i}`] = {
        key: `k${i}`,
        url: `https://example.com/${i}`,
        type: 'redirect',
      };
    }
    await expect(rebuildDynamicRules()).resolves.toBeUndefined();
    expect(dnrRules.length).toBeLessThanOrEqual(5000);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('caps rules at the real 1,000-regex Firefox quota without partial engine coverage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const update = vi.mocked(chrome.declarativeNetRequest.updateDynamicRules);
    for (let i = 0; i < 143; i++) {
      syncStore[`${SHORTCUT_PREFIX}k${i}`] = {
        key: `k${i}`,
        url: `https://example.com/${i}`,
        type: 'redirect',
      };
    }
    await rebuildDynamicRules();

    expect(dnrRules).toHaveLength(994);
    expect(dnrRules).toHaveLength(142 * ENGINE_COUNT);
    expect(dnrRules.some(rule => rule.condition.regexFilter?.includes('q=k142'))).toBe(false);
    expect(warn.mock.calls.some(call => String(call[0]).includes('k142'))).toBe(true);
    // Do not enter the per-rule recovery loop for an over-quota bulk update.
    expect(update).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('deducts both exact and parameterized rules from the regex quota', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 72; i++) {
      syncStore[`${SHORTCUT_PREFIX}p${i}`] = {
        key: `p${i}`,
        url: 'https://example.com/',
        urlTemplate: `https://example.com/search?q=%s&page=${i}`,
        type: 'parameterized',
      };
    }
    await rebuildDynamicRules();

    expect(dnrRules).toHaveLength(71 * ENGINE_COUNT * 2);
    expect(dnrRules.some(rule => rule.condition.regexFilter?.includes('q=p71'))).toBe(false);
    expect(warn.mock.calls.some(call => String(call[0]).includes('p71'))).toBe(true);
    warn.mockRestore();
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
      if (adds.length > 1 || adds.some((r) => (r.condition.regexFilter ?? '').includes('=bad('))) {
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

describe('audit regressions: Startpage parameters, path templates, and quota priority', () => {
  it('intercepts Startpage ?query= and the do/dsearch path shape', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    await rebuildDynamicRules();

    const startpage = dnrRules.find(
      r => r.priority === 1 && r.condition.regexFilter?.includes('startpage\\.com'),
    );
    expect(startpage).toBeTruthy();
    const re = regexOf(startpage);
    expect(re.test('https://www.startpage.com/sp/search?q=gh')).toBe(true);
    expect(re.test('https://www.startpage.com/sp/search?query=gh')).toBe(true);
    expect(re.test('https://www.startpage.com/do/dsearch?q=gh&cat=web&language=english')).toBe(true);
    expect(re.test('https://www.startpage.com/sp/search?query=github')).toBe(false);
  });

  it('emits capture rules for a Startpage query= template', async () => {
    syncStore[`${SHORTCUT_PREFIX}sp`] = {
      key: 'sp',
      url: 'https://www.startpage.com',
      urlTemplate: 'https://www.startpage.com/sp/search?query=%s',
      type: 'parameterized',
    };
    await rebuildDynamicRules();

    const capture = dnrRules.find(
      r => r.priority === 2 && r.condition.regexFilter?.includes('startpage\\.com'),
    );
    expect(capture).toBeTruthy();
    expect(regexOf(capture).test('https://www.startpage.com/sp/search?query=sp+cats')).toBe(true);
    expect(capture?.action.redirect?.regexSubstitution).toBe('https://www.startpage.com/sp/search?query=\\1');
  });

  it('does not emit a DNR capture rule for %s in a path segment', async () => {
    syncStore[`${SHORTCUT_PREFIX}wiki-path`] = {
      key: 'wikipath',
      url: 'https://en.wikipedia.org',
      urlTemplate: 'https://en.wikipedia.org/wiki/%s',
      type: 'parameterized',
    };
    await rebuildDynamicRules();

    expect(dnrRules.filter(r => r.priority === 1 && r.condition.regexFilter?.includes('=wikipath'))).toHaveLength(ENGINE_COUNT);
    expect(dnrRules.some(r => r.priority === 2 && r.condition.regexFilter?.includes('=wikipath'))).toBe(false);
  });

  it('spends the regex quota on the most-used shortcuts rather than storage order', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 143; i++) {
      syncStore[`${SHORTCUT_PREFIX}k${i}`] = {
        key: `k${i}`,
        url: `https://example.com/${i}`,
        type: 'redirect',
        useCount: i === 142 ? 5 : 0,
      };
    }
    await rebuildDynamicRules();
    expect(dnrRules.some(r => r.condition.regexFilter?.includes('q=k142'))).toBe(true);
    expect(dnrRules.some(r => r.condition.regexFilter?.includes('q=k141'))).toBe(false);
    vi.restoreAllMocks();
  });
});
