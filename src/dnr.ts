import { getStore } from './storage';
import { Shortcut } from './types';

const MAX_DYNAMIC_RULES = 5000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Search engines whose `q=` parameter carries the omnibar query. Redirect
// rules are scoped to these hosts so an unrelated page with `?q=key` is
// never intercepted.
const SEARCH_HOST_REGEX_SOURCE =
  '^https?://(?:[a-z0-9-]+\\.)*(?:google\\.[a-z]+(?:\\.[a-z]+)?|bing\\.com|duckduckgo\\.com|search\\.brave\\.com|kagi\\.com|ecosia\\.org|startpage\\.com)/';

const SEARCH_HOST_REGEX = new RegExp(SEARCH_HOST_REGEX_SOURCE, 'i');

export function isSearchEngineUrl(url: string): boolean {
  return SEARCH_HOST_REGEX.test(url);
}

function buildQueryRegex(key: string): string {
  const escapedKey = escapeRegex(key);
  return `${SEARCH_HOST_REGEX_SOURCE}[^#]*[?&]q=${escapedKey}(?:&|$)`;
}

function buildParamQueryRegex(key: string): string {
  const escapedKey = escapeRegex(key);
  return `${SEARCH_HOST_REGEX_SOURCE}[^#]*[?&]q=${escapedKey}(?:\\+|%20)(.+?)(?:&.*)?$`;
}

function resolveShortcutUrl(shortcut: Shortcut): string | null {
  if (shortcut.type === 'bundle') {
    return shortcut.bundleUrls?.[0] ?? shortcut.url ?? null;
  }
  return shortcut.url;
}

function isSafeRedirectUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.startsWith('http:') || lower.startsWith('https:');
}

function buildRules(shortcuts: Shortcut[]): chrome.declarativeNetRequest.Rule[] {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let id = 1;

  for (const shortcut of shortcuts) {
    // Skip (don't throw): one malformed record must not block every other rule.
    const url = resolveShortcutUrl(shortcut);
    if (!url || !isSafeRedirectUrl(url)) {
      console.warn(`OmniJump: skipping shortcut "${shortcut.key}" with no valid http(s) target.`);
      continue;
    }

    // Exact-match rule (no argument, or all non-parameterized types)
    rules.push({
      id: id++,
      priority: 1,
      action: {
        type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
        redirect: { url },
      },
      condition: {
        regexFilter: buildQueryRegex(shortcut.key),
        isUrlFilterCaseSensitive: false,
        resourceTypes: ['main_frame'] as chrome.declarativeNetRequest.ResourceType[],
      },
    });

    // Capture-group rule for parameterized shortcuts (keyword + argument)
    if (shortcut.type === 'parameterized' && shortcut.urlTemplate) {
      if (isSafeRedirectUrl(shortcut.urlTemplate)) {
        rules.push({
          id: id++,
          priority: 2,
          action: {
            type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
            redirect: {
              regexSubstitution: shortcut.urlTemplate.replace('%s', '\\1'),
            },
          },
          condition: {
            regexFilter: buildParamQueryRegex(shortcut.key),
            isUrlFilterCaseSensitive: false,
            resourceTypes: ['main_frame'] as chrome.declarativeNetRequest.ResourceType[],
          },
        });
      }
    }
  }

  return rules;
}

export async function rebuildDynamicRules(): Promise<void> {
  const store = await getStore();
  const shortcuts = Object.values(store.shortcuts);

  if (shortcuts.length > MAX_DYNAMIC_RULES) {
    throw new Error(`Shortcut limit exceeded (${MAX_DYNAMIC_RULES}).`);
  }

  const rules = buildRules(shortcuts).filter((rule) => {
    const redirectUrl = rule.action.redirect?.url || rule.action.redirect?.regexSubstitution || '';
    return isSafeRedirectUrl(redirectUrl);
  });
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: rules,
  });
}
