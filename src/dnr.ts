import { getStore } from './storage';
import { Shortcut } from './types';
import { isQueryOnlyTemplate } from './url';

// Session key the UI reads to mark shortcuts whose DNR rules were rejected by
// Chrome (too-long regex program or quota). They still work via the JS fallback.
export const DNR_SKIPPED_KEY = 'omnibar_dnr_skipped';

// Chrome's guaranteed total budget. Every rule OmniJump builds also uses a
// regexFilter, so the lower (by default 1,000) regex-specific quota applies.
const MAX_DYNAMIC_RULES = 5000;
const DEFAULT_MAX_REGEX_RULES = 1000;

function maxAvailableRegexRules(): number {
  // Firefox exposes both constants. Older @types/chrome declarations omit the
  // total-rule constant, so keep the documented fallback for both browsers.
  const dnr = chrome.declarativeNetRequest as typeof chrome.declarativeNetRequest & {
    MAX_NUMBER_OF_DYNAMIC_RULES?: number;
  };
  return Math.min(
    dnr.MAX_NUMBER_OF_DYNAMIC_RULES ?? MAX_DYNAMIC_RULES,
    dnr.MAX_NUMBER_OF_REGEX_RULES ?? DEFAULT_MAX_REGEX_RULES,
  );
}

// Chrome compiles regexFilter with RE2 and rejects any rule whose compiled
// program exceeds 2 KB. Alternations are expensive, so a regex that embeded the
// whole search-engine list needed ~7 branches and was rejected outright, which
// made rebuildDynamicRules fail for every shortcut. Each engine now gets its own
// rule, keeping every pattern small.
// Measured on Chromium 141 with the patterns below: ~94-152 char patterns
// compile fine, a 187 char (3-engine) pattern is rejected. Treat lengths above
// this as risky and warn, since long user keywords also inflate the pattern.
// Raised to 200 after the Google-host hardening above: per-engine patterns are
// alternation-free, so even ~200 chars compile to a RE2 program far under the
// 2 KB limit. Keywords are capped at 40 chars (28 for parameterized) on new
// writes, which keeps every pattern near this heuristic; the real limit is the
// compiled program size, which is why longer legacy keys can still lose rules.
const MAX_SAFE_REGEX_LENGTH = 200;

interface SearchEngine {
  name: string;
  /** Host + path fragment, anchored by the caller with `^https?://`. */
  pattern: string;
  /** Query parameter(s) that carry the search text. Most engines use `q`. */
  queryParams: string[];
}

// The `q=` parameter carries the omnibar query on these engines. Redirect rules
// are scoped to these hosts and search paths so unrelated services (e.g.
// docs.google.com, drive.google.com) with `?q=key` are never intercepted.
const SEARCH_ENGINES: SearchEngine[] = [
  // Google ran on google.<com|cat|eus|any ccTLD> optionally followed by a
  // second 2-letter level (co.uk, com.au...). The open `[a-z]+` form also
  // matched attacker-registerable hosts like google.evil.com — a page there
  // could observe which keywords a visitor owns — so TLDs are restricted to
  // the shapes Google actually uses. The mandatory `/` after the TLD stops
  // deeper suffixes (google.co.uk.evil.com still fails).
  { name: 'google', pattern: '(?:www\\.)?google\\.(?:com|cat|eus|[a-z]{2})(?:\\.[a-z]{2})?/(?:search|webhp)?', queryParams: ['q'] },
  { name: 'bing', pattern: '(?:(?:www|cn|www2|www4)\\.)?bing\\.com/search/?', queryParams: ['q'] },
  { name: 'duckduckgo', pattern: '(?:(?:www|html|lite)\\.)?duckduckgo\\.com/(?:html/|lite/)?', queryParams: ['q'] },
  { name: 'brave', pattern: 'search\\.brave\\.com/(?:search)?', queryParams: ['q'] },
  { name: 'kagi', pattern: '(?:www\\.)?kagi\\.com/(?:search)?', queryParams: ['q'] },
  { name: 'ecosia', pattern: '(?:www\\.)?ecosia\\.org/(?:search)?', queryParams: ['q'] },
  // Startpage's documented manual search string uses `query=`, while the
  // built-in browser engines use `q=`. The official extension uses do/dsearch.
  { name: 'startpage', pattern: '(?:www\\.)?startpage\\.com/(?:sp/search|do/search|do/dsearch|search)?', queryParams: ['q', 'query'] },
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

function queryParamPattern(engine: SearchEngine): string {
  return engine.queryParams.length === 1
    ? escapeRegex(engine.queryParams[0]!)
    : `(?:${engine.queryParams.map(escapeRegex).join('|')})`;
}

// `?q=key`, `&q=key` ... and rejects a partial word match (`q=ghub`).
function buildQueryRegex(engine: SearchEngine, key: string): string {
  return `^https?://${engine.pattern}(?:\\?[^#]*&|\\?)${queryParamPattern(engine)}=${escapeRegex(key)}(?:\\+|%20)*(?:[&#]|$)`;
}

// Same, but captures everything after `key ` so it can be substituted into the
// shortcut's URL template.
function buildParamQueryRegex(engine: SearchEngine, key: string): string {
  return `^https?://${engine.pattern}(?:\\?[^#]*&|\\?)${queryParamPattern(engine)}=${escapeRegex(key)}(?:\\+|%20)+([^&#]+?)(?:[&#].*)?$`;
}

function resolveShortcutUrl(shortcut: Shortcut): string | null {
  if (shortcut.type === 'bundle') {
    return shortcut.bundleUrls?.[0] ?? shortcut.url ?? null;
  }
  return shortcut.url;
}

const PLACEHOLDER_SENTINEL = '__omnijump_param__';

function isSafeRedirectUrl(url: string | undefined | null, allowPlaceholder = false): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (!lower.startsWith('http:') && !lower.startsWith('https:')) return false;
  try {
    const parsed = new URL(allowPlaceholder ? url.replace(/%s/g, PLACEHOLDER_SENTINEL) : url);
    // When a placeholder is allowed it must stay in the path/query. A
    // capture group in the authority could rewrite the redirect host.
    const authority = `${parsed.username}${parsed.password}${parsed.hostname}`;
    if (allowPlaceholder && authority.includes(PLACEHOLDER_SENTINEL)) return false;
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0 &&
      !/\s/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

interface BuiltRules {
  rules: chrome.declarativeNetRequest.Rule[];
  /** Keys left without rules, either malformed or over the rule budget. */
  skippedKeys: string[];
  /** Rule id -> keyword, used to name rules Chrome rejects at apply time. */
  keyByRuleId: Map<number, string>;
}

function buildRules(shortcuts: Shortcut[]): BuiltRules {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  const skippedKeys: string[] = [];
  const keyByRuleId = new Map<number, string>();
  const maxRegexRules = maxAvailableRegexRules();
  let id = 1;

  // The regex quota is positional, so spend it on the shortcuts the user
  // actually reaches for first instead of on storage iteration order.
  const ordered = shortcuts
    .map((shortcut, index) => ({ shortcut, index }))
    .sort(
      (a, b) =>
        (b.shortcut.useCount ?? 0) - (a.shortcut.useCount ?? 0) ||
        (b.shortcut.lastUsed ?? 0) - (a.shortcut.lastUsed ?? 0) ||
        a.index - b.index,
    )
    .map(({ shortcut }) => shortcut);

  const resourceTypes = ['main_frame'] as chrome.declarativeNetRequest.ResourceType[];
  const redirectAction = (url: string) => ({
    type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
    redirect: { url },
  });

  for (const shortcut of ordered) {
    // Skip (don't throw): one malformed record must not block every other rule.
    const url = resolveShortcutUrl(shortcut);
    if (!url || !isSafeRedirectUrl(url)) {
      console.warn(`OmniJump: skipping shortcut "${shortcut.key}" with no valid http(s) target.`);
      skippedKeys.push(shortcut.key);
      continue;
    }

    const parameterized = shortcut.type === 'parameterized' &&
      isSafeRedirectUrl(shortcut.urlTemplate, true) &&
      // Path/fragment templates cannot use a DNR capture group: the engine's
      // raw `+`-encoded query would be substituted literally. The JS fallback
      // percent-encodes correctly, so leave those to it.
      isQueryOnlyTemplate(shortcut.urlTemplate ?? '');
    const rulesPerShortcut = SEARCH_ENGINES.length * (parameterized ? 2 : 1);

    if (rules.length + rulesPerShortcut > maxRegexRules) {
      skippedKeys.push(shortcut.key);
      continue;
    }

    const exactRegexes = SEARCH_ENGINES.map((engine) => buildQueryRegex(engine, shortcut.key));
    const paramRegexes = parameterized
      ? SEARCH_ENGINES.map((engine) => buildParamQueryRegex(engine, shortcut.key))
      : [];
    if (
      exactRegexes.some((regex) => regex.length > MAX_SAFE_REGEX_LENGTH) ||
      paramRegexes.some((regex) => regex.length > MAX_SAFE_REGEX_LENGTH)
    ) {
      console.warn(
        `OmniJump: shortcut "${shortcut.key}" has a very long keyword; Chrome may reject its redirect rule.`,
      );
    }

    // Exact-match rules (no argument, or all non-parameterized types)
    SEARCH_ENGINES.forEach((engine, index) => {
      const ruleId = id++;
      keyByRuleId.set(ruleId, shortcut.key);
      rules.push({
        id: ruleId,
        priority: 1,
        action: redirectAction(url),
        condition: { regexFilter: exactRegexes[index], isUrlFilterCaseSensitive: false, resourceTypes },
      });
    });

    // Capture-group rules for parameterized shortcuts (keyword + argument)
    if (parameterized && shortcut.urlTemplate) {
      const substitution = shortcut.urlTemplate.replace(/\\/g, '\\\\').replace(/%s/g, '\\1');
      SEARCH_ENGINES.forEach((_engine, index) => {
        const ruleId = id++;
        keyByRuleId.set(ruleId, shortcut.key);
        rules.push({
          id: ruleId,
          priority: 2,
          action: {
            type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
            redirect: { regexSubstitution: substitution },
          },
          condition: {
            regexFilter: paramRegexes[index],
            isUrlFilterCaseSensitive: false,
            resourceTypes,
          },
        });
      });
    }
  }

  return { rules, skippedKeys, keyByRuleId };
}

// updateDynamicRules is atomic: one rejected rule (e.g. an over-long regex) fails
// the whole call and leaves zero redirects. Fall back to adding rules one by one
// so only the offending rules are lost.
async function applyRules(
  removeRuleIds: number[],
  rules: chrome.declarativeNetRequest.Rule[],
): Promise<number[]> {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
    return [];
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
    return dropped;
  }
}

async function runRebuildDynamicRules(): Promise<void> {
  const store = await getStore();
  const shortcuts = Object.values(store.shortcuts);

  const { rules, skippedKeys, keyByRuleId } = buildRules(shortcuts);

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);

  const droppedRuleIds = await applyRules(removeRuleIds, rules);
  for (const ruleId of droppedRuleIds) {
    const key = keyByRuleId.get(ruleId);
    if (key && !skippedKeys.includes(key)) skippedKeys.push(key);
  }

  if (skippedKeys.length > 0) {
    console.warn(
      `OmniJump: ${skippedKeys.length} shortcut(s) have no instant redirect rule ` +
      `(they still redirect after the search page loads): ${skippedKeys.join(', ')}`,
    );
  }
  try {
    await chrome.storage.session.set({ [DNR_SKIPPED_KEY]: skippedKeys });
  } catch {
    // Session storage is best-effort; the console warning above remains.
  }
}

let activeRebuild: Promise<void> | null = null;
let rebuildQueued = false;

export async function rebuildDynamicRules(): Promise<void> {
  if (activeRebuild) {
    rebuildQueued = true;
    return activeRebuild;
  }
  activeRebuild = (async () => {
    do {
      rebuildQueued = false;
      await runRebuildDynamicRules();
    } while (rebuildQueued);
  })().finally(() => {
    activeRebuild = null;
  });
  return activeRebuild;
}
