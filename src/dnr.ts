import { getStore } from './storage';
import { Shortcut } from './types';

const MAX_DYNAMIC_RULES = 5000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildQueryRegex(key: string): string {
  const escapedKey = escapeRegex(key);
  return `[?&]q=${escapedKey}(?:&|$)`;
}

function buildParamQueryRegex(key: string): string {
  const escapedKey = escapeRegex(key);
  return `[?&]q=${escapedKey}(?:\\+|%20)(.+?)(?:&|$)`;
}

function resolveShortcutUrl(shortcut: Shortcut): string | null {
  if (shortcut.type === 'bundle') {
    return shortcut.bundleUrls?.[0] ?? shortcut.url ?? null;
  }
  return shortcut.url;
}

function buildRules(shortcuts: Shortcut[]): chrome.declarativeNetRequest.Rule[] {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let id = 1;

  for (const shortcut of shortcuts) {
    const url = resolveShortcutUrl(shortcut);
    if (!url) throw new Error(`Shortcut ${shortcut.key} has no target URL.`);

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
        resourceTypes: ['main_frame'] as chrome.declarativeNetRequest.ResourceType[],
      },
    });

    // Capture-group rule for parameterized shortcuts (keyword + argument)
    if (shortcut.type === 'parameterized' && shortcut.urlTemplate) {
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
          resourceTypes: ['main_frame'] as chrome.declarativeNetRequest.ResourceType[],
        },
      });
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

  const rules = buildRules(shortcuts);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: rules,
  });
}
