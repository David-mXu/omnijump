import { getStore } from './storage';
import { Shortcut } from './types';

// Chrome's guaranteed budget for dynamic rules.
const MAX_DYNAMIC_RULES = 5000;

// Chrome compiles regexFilter with RE2 and rejects any rule whose compiled
// program exceeds 2 KB. Alternations are expensive, so a regex that embeded the
// whole search-engine list needed ~7 branches and was rejected outright, which
// made rebuildDynamicRules fail for every shortcut. Each engine now gets its own
// rule, keeping every pattern small.
// Measured on Chromium 141 with the patterns below: ~94-152 char patterns
// compile fine, a 187 char (3-engine) pattern is rejected. Treat lengths above
// this as risky and warn, since long user keywords also inflate the pattern.
const MAX_SAFE_REGEX_LENGTH = 160;

interface SearchEngine {
  name: string;
  /** Host + path fragment, anchored by the caller with `^https?://`. */
  pattern: string;
}

// The `q=` parameter carries the omnibar query on these engines. Redirect rules
// are scoped to these hosts and search paths so unrelated services (e.g.
// docs.google.com, drive.google.com) with `?q=key` are never intercepted.
const SEARCH_ENGINES: SearchEngine[] = [
  { name: 'google', pattern: '(?:www\\.)?google\\.[a-z]+(?:\\.[a-z]+)?/(?:search|webhp)?' },
  { name: 'bing', pattern: '(?:www\\.|cn\\.)?bing\\.com/search' },
  { name: 'duckduckgo', pattern: '(?:(?:www|html|lite)\\.)?duckduckgo\\.com/(?:html/|lite/)?' },
  { name: 'brave', pattern: 'search\\.brave\\.com/(?:search)?' },
  { name: 'kagi', pattern: '(?:www\\.)?kagi\\.com/(?:search)?' },
  { name: 'ecosia', pattern: '(?:www\\.)?ecosia\\.org/(?:search)?' },
  { name: 'startpage', pattern: '(?:www\\.)?startpage\\.com/(?:sp/search|do/search|search)?' },
];

// Uncompiled JavaScript regex, only used to gate the service worker's listeners
// (no 2 KB limit applies here), so the whole alternation is fine in one pattern.
const SEARCH_HOST_REGEX_SOURCE = `^https?://(?:${SEARCH_ENGINES.map((e) => e.pattern).join('|')})`;
const SEARCH_HOST_REGEX = new RegExp(`${SEARCH_HOST_REGEX_SOURCE}(?:[?#]|$)`, 'i');

export function isSearchEngineUrl(url: string): boolean {
  return SEARCH_HOST_REGEX.test(url);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `?q=key`, `&q=key` ... and rejects a partial word match (`q=ghub`).
function buildQueryRegex(engine: SearchEngine, key: string): string {
  return `^https?://${engine.pattern}(?:\\?[^#]*&|\\?)q=${escapeRegex(key)}(?:[&#]|$)`;
}

// Same, but captures everything after `key ` so it can be substituted into the
// shortcut's URL template.
function buildParamQueryRegex(engine: SearchEngine, key: string): string {
  return `^https?://${engine.pattern}(?:\\?[^#]*&|\\?)q=${escapeRegex(key)}(?:\\+|%20)(.+?)(?:[&#].*)?$`;
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

interface BuiltRules {
  rules: chrome.declarativeNetRequest.Rule[];
  /** Keys left without rules, either malformed or over the rule budget. */
  skippedKeys: string[];
}

function buildRules(shortcuts: Shortcut[]): BuiltRules {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  const skippedKeys: string[] = [];
  let id = 1;

  const resourceTypes = ['main_frame'] as chrome.declarativeNetRequest.ResourceType[];
  const redirectAction = (url: string) => ({
    type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
    redirect: { url },
  });

  for (const shortcut of shortcuts) {
    // Skip (don't throw): one malformed record must not block every other rule.
    const url = resolveShortcutUrl(shortcut);
    if (!url || !isSafeRedirectUrl(url)) {
      console.warn(`OmniJump: skipping shortcut "${shortcut.key}" with no valid http(s) target.`);
      skippedKeys.push(shortcut.key);
      continue;
    }

    const parameterized = shortcut.type === 'parameterized' && isSafeRedirectUrl(shortcut.urlTemplate);
    const rulesPerShortcut = SEARCH_ENGINES.length * (parameterized ? 2 : 1);

    if (rules.length + rulesPerShortcut > MAX_DYNAMIC_RULES) {
      skippedKeys.push(shortcut.key);
      continue;
    }

    const exactRegexes = SEARCH_ENGINES.map((engine) => buildQueryRegex(engine, shortcut.key));
    if (exactRegexes.some((regex) => regex.length > MAX_SAFE_REGEX_LENGTH)) {
      console.warn(
        `OmniJump: shortcut "${shortcut.key}" has a very long keyword; Chrome may reject its redirect rule.`,
      );
    }

    // Exact-match rules (no argument, or all non-parameterized types)
    SEARCH_ENGINES.forEach((engine, index) => {
      rules.push({
        id: id++,
        priority: 1,
        action: redirectAction(url),
        condition: { regexFilter: exactRegexes[index], isUrlFilterCaseSensitive: false, resourceTypes },
      });
    });

    // Capture-group rules for parameterized shortcuts (keyword + argument)
    if (parameterized && shortcut.urlTemplate) {
      const substitution = shortcut.urlTemplate.replace('%s', '\\1');
      for (const engine of SEARCH_ENGINES) {
        rules.push({
          id: id++,
          priority: 2,
          action: {
            type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
            redirect: { regexSubstitution: substitution },
          },
          condition: {
            regexFilter: buildParamQueryRegex(engine, shortcut.key),
            isUrlFilterCaseSensitive: false,
            resourceTypes,
          },
        });
      }
    }
  }

  return { rules, skippedKeys };
}

// updateDynamicRules is atomic: one rejected rule (e.g. an over-long regex) fails
// the whole call and leaves zero redirects. Fall back to adding rules one by one
// so only the offending rules are lost.
async function applyRules(removeRuleIds: number[], rules: chrome.declarativeNetRequest.Rule[]): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
  } catch (error) {
    console.warn('OmniJump: bulk DNR update was rejected; retrying rule by rule.', error);

    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });

    const dropped: number[] = [];
    for (const rule of rules) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
      } catch {
        dropped.push(rule.id);
      }
    }

    if (dropped.length > 0) {
      console.error(
        `OmniJump: Chrome rejected ${dropped.length} DNR rule(s); those keywords will not redirect.`,
        dropped,
      );
    }
  }
}

export async function rebuildDynamicRules(): Promise<void> {
  const store = await getStore();
  const shortcuts = Object.values(store.shortcuts);

  const { rules, skippedKeys } = buildRules(shortcuts);
  if (skippedKeys.length > 0) {
    console.warn(
      `OmniJump: ${skippedKeys.length} shortcut(s) have no redirect rule: ${skippedKeys.join(', ')}`,
    );
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);

  await applyRules(removeRuleIds, rules);
}
