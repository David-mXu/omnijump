import { getStore } from './storage';
import { Shortcut } from './types';

const MAX_DYNAMIC_RULES = 5000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildQueryRegex(key: string): string {
  const escapedKey = escapeRegex(key);
  return `.*[?&]q=${escapedKey}(?:&|$)`;
}

function resolveShortcutUrl(shortcut: Shortcut): string | null {
  if (shortcut.type === 'bundle') {
    return shortcut.bundleUrls?.[0] ?? shortcut.url ?? null;
  }
  return shortcut.url;
}

function buildRules(shortcuts: Shortcut[]): chrome.declarativeNetRequest.Rule[] {
  return shortcuts.map((shortcut, index) => {
    const url = resolveShortcutUrl(shortcut);
    if (!url) {
      throw new Error(`Shortcut ${shortcut.key} has no target URL.`);
    }

    return {
      id: index + 1,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: {
          url,
        },
      },
      condition: {
        regexFilter: buildQueryRegex(shortcut.key),
        resourceTypes: ['main_frame'],
      },
    };
  });
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
