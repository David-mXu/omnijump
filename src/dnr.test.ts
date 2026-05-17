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
});
