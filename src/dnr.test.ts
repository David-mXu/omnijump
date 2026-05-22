import { describe, it, expect, beforeEach } from 'vitest';
import { createChromeMock } from './test/chrome-mock';
import { rebuildDynamicRules } from './dnr';
import { SHORTCUT_PREFIX } from './storage';

let syncStore: Record<string, unknown>;
let dnrRules: chrome.declarativeNetRequest.Rule[];

beforeEach(() => {
  const mock = createChromeMock();
  globalThis.chrome = mock.chrome;
  syncStore = mock.syncStore;
  dnrRules = mock.dnrRules;
});

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
    expect(ids).toEqual([1, 2]);
  });

  it('creates one rule per shortcut pointing at the correct URL', async () => {
    syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
    syncStore[`${SHORTCUT_PREFIX}yt`] = { key: 'yt', url: 'https://youtube.com', type: 'redirect' };
    await rebuildDynamicRules();
    const urls = dnrRules.map(r => r.action.redirect?.url);
    expect(urls).toContain('https://github.com');
    expect(urls).toContain('https://youtube.com');
  });

  it('points a bundle rule at bundleUrls[0]', async () => {
    syncStore[`${SHORTCUT_PREFIX}work`] = {
      key: 'work', url: 'https://gmail.com', type: 'bundle',
      bundleUrls: ['https://gmail.com', 'https://calendar.google.com'],
    };
    await rebuildDynamicRules();
    expect(dnrRules[0].action.redirect?.url).toBe('https://gmail.com');
  });

  describe('generated regex', () => {
    beforeEach(async () => {
      syncStore[`${SHORTCUT_PREFIX}gh`] = { key: 'gh', url: 'https://github.com', type: 'redirect' };
      await rebuildDynamicRules();
    });

    function getRegex() {
      return new RegExp(dnrRules[0].condition.regexFilter ?? '');
    }

    it('matches ?q=key at the end of a URL', () => {
      expect(getRegex().test('https://google.com/search?q=gh')).toBe(true);
    });

    it('matches &q=key mid-URL', () => {
      expect(getRegex().test('https://google.com/search?hl=en&q=gh')).toBe(true);
    });

    it('matches ?q=key& when followed by another parameter', () => {
      expect(getRegex().test('https://google.com/search?q=gh&hl=en')).toBe(true);
    });

    it('does not match a partial key (prefix of a longer word)', () => {
      expect(getRegex().test('https://google.com/search?q=ghub')).toBe(false);
    });

    it('does not match a random URL without the key', () => {
      expect(getRegex().test('https://google.com/search?q=youtube')).toBe(false);
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

    it('creates two rules (priority 1 exact-match + priority 2 capture-group)', () => {
      expect(dnrRules).toHaveLength(2);
      expect(dnrRules[0].priority).toBe(1);
      expect(dnrRules[1].priority).toBe(2);
    });

    it('rule 1 (exact-match) redirects to fallback URL', () => {
      const rule1 = dnrRules.find(r => r.priority === 1);
      expect(rule1?.action.redirect?.url).toBe('https://youtube.com');
    });

    it('rule 2 (capture-group) uses regexSubstitution with \\1 placeholder', () => {
      const rule2 = dnrRules.find(r => r.priority === 2);
      expect(rule2?.action.redirect?.regexSubstitution).toBe('https://youtube.com/results?search_query=\\1');
    });

    it('rule 2 regex matches full Google URL with keyword + space + query', () => {
      const rule2 = dnrRules.find(r => r.priority === 2);
      const regex = new RegExp(rule2?.condition.regexFilter ?? '');
      expect(regex.test('https://google.com/search?q=yt+lofi')).toBe(true);
    });

    it('rule 2 regex does not match bare keyword (no query)', () => {
      const rule2 = dnrRules.find(r => r.priority === 2);
      const regex = new RegExp(rule2?.condition.regexFilter ?? '');
      expect(regex.test('https://google.com/search?q=yt')).toBe(false);
    });

    it('rule 2 regex captures query text for substitution', () => {
      const rule2 = dnrRules.find(r => r.priority === 2);
      const regex = new RegExp(rule2?.condition.regexFilter ?? '');
      const match = regex.exec('https://google.com/search?q=yt+lofi+hip+hop');
      expect(match?.[1]).toBe('lofi+hip+hop');
    });
  });
});
