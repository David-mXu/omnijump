# Fixing the "regexFilter exceeded the 2KB memory limit" DNR failure

## The problem

The extension reported this in the service worker console, and **every keyword shortcut
stopped working**:

```
Failed to rebuild DNR rules Error: Rule with id 1 was skipped as the "regexFilter" value
exceeded the 2KB memory limit when compiled.
```

A second, unrelated error appeared at the same time:

```
Cannot load extension with file or directory name _metadata. Filenames starting with "_"
are reserved for use by the system.
```

## Concepts in plain language

- **DNR (declarativeNetRequest)**: the MV3 API that lets an extension say "when a request
  matches *this*, redirect it to *that*" without running code on each navigation.
  `src/dnr.ts` rebuilds the whole rule set whenever shortcuts change.
- **`regexFilter`**: the condition field that matches the request URL with a regular
  expression. Chrome compiles it with **RE2** (a linear-time regex engine) and caps the
  *compiled program* at **2 KB per rule**. This is a limit on the compiled machine code,
  not on your source string length — but alternations (`a|b|c`) and optional groups
  generate more instructions, so the compiled size grows faster than the text does.
- **Atomic updates**: `chrome.declarativeNetRequest.updateDynamicRules()` applies
  `removeRuleIds` + `addRules` as one transaction. If **one** rule is rejected, the whole
  call fails. That is why one oversized regex took out all shortcuts instead of one.

## Root cause

Every shortcut produced a rule whose `regexFilter` embedded the *entire* search-engine
host alternation, then appended `q=<keyword>`:

```
^https?://(?:(?:www\.)?google\.[a-z]+…|…bing\.com/search|…duckduckgo\.com/…|brave|kagi|ecosia|startpage)(?:\?[^#]*&|\?)q=gh(?:[&#]|$)
```

That source string was 341 characters. As engines were added over time (kagi, ecosia,
startpage, brave), the compiled program crossed Chrome's 2 KB ceiling, and because the
update is atomic, the rejection removed nothing less than everything.

## Investigation

I did not want to guess at the boundary, so I measured it in the real browser:

1. Built the extension (`npm run build:chrome`) and loaded `dist/chrome` into Chromium
   through Playwright's persistent context (`channel: 'chromium'`, `--load-extension=…`).
   Headless *shell* does not support extensions; the `chromium` channel's new headless
   mode does.
2. From the extension's service worker, called `updateDynamicRules` with candidate
   `regexFilter` values and recorded which were accepted — that is the only authority on
   the compiled-size limit.
3. Results (Chromium 141 via Playwright 1.64.1):

| Candidate | Pattern length | Result |
|---|---|---|
| Current all-engine regex | 341 | **rejected** (exact user-reported message) |
| 1 engine + query | 98 | accepted |
| 2 engines + query | 130 | accepted |
| 3 engines + query | 187 | **rejected** |
| Each of the 7 engines, one per regex, exact match | 69–112 | accepted |
| Google rule + 60-character keyword | 152 | accepted |
| Google rule + 120-character keyword | 212 | **rejected** |

The important finding: **two engines per regex is already at the cliff edge** (and fails
once a long keyword is appended), while **one engine per regex has comfortable margin**.
Grouping engines to save rules would have reproduced the same bug the first time a new
engine or a long keyword was added.

## The fix

`src/dnr.ts`:

- `SEARCH_ENGINES` is now a single list of `{ name, pattern }` objects. `buildRules()`
  emits **one rule per engine per shortcut** (7 rules for a redirect, 14 for a
  parameterized shortcut: 7 exact-match at priority 1, 7 capture-group at priority 2).
- `SEARCH_HOST_REGEX_SOURCE` is still built from that list, but only for
  `isSearchEngineUrl()` — a plain JavaScript `RegExp` used by the service worker's
  navigation listeners, where no compiled-memory cap applies.
- Rule IDs stay positional (`nextRuleId++`), so behaviour for the rest of the extension
  is unchanged.
- Added a `MAX_SAFE_REGEX_LENGTH = 160` warning for pathologically long keywords, plus a
  budget guard that stops adding rules beyond `MAX_DYNAMIC_RULES` (5000) instead of
  throwing.
- Added `applyRules()`: if the bulk call is rejected, it retries one rule at a time so a
  single bad rule loses only its own keyword. This turns "one bad rule = no shortcuts at
  all" into "one bad rule = one dead keyword". The fallback only runs on failure; the
  normal path is still a single atomic update.

Tradeoff: the number of dynamic rules grows ~7×. Rule IDs, priorities, and matching
behaviour are unchanged, and 5000 dynamic rules remain far beyond what the storage cap
(~511 shortcuts) can produce in practice.

## Verification

Observed, not assumed:

- `npx tsc --noEmit` → no errors.
- `npm test` → 111 tests pass, including new ones that assert every `regexFilter` is
  ≤ 160 characters, that each rule embeds exactly one engine, that all seven engines are
  covered, and two `applyRules()` recovery tests (bulk rejection → per-rule retry; one
  rejected rule → other rules survive).
- End-to-end in Chromium with the rebuilt extension and a 31-shortcut store: **371**
  dynamic rules installed (starters included), longest filter 116 characters.
- Functional redirect check with a shortcut `gh → https://github.com`:
  - `https://www.google.com/search?q=gh` → `https://github.com/`
  - `https://www.bing.com/search?q=gh&form=QBLH` → `https://github.com/`
  - `https://duckduckgo.com/?q=gh` → `https://github.com/`
  - `https://www.google.com/search?q=zzzz-nope` → unchanged (no false positive)

## The `_metadata` error is unrelated

Nothing in this repo's build emits `_metadata/`. Chrome adds that folder when it installs
an extension from the Web Store (`~/.config/google-chrome/Default/Extensions/<id>/<version>/`).
Pointing **Load unpacked** at that directory always fails, because `_`-prefixed names are
reserved inside an extension. For development, load `dist/chrome` (or `dist/firefox`)
instead — now noted in `AGENTS.md` / `CLAUDE.md`.

## Files touched

- `src/dnr.ts` — per-engine rules, regex-size warning, rule budget, `applyRules()` retry.
- `src/dnr.test.ts` — updated rule-count expectations, new regression and recovery tests.
- `AGENTS.md`, `CLAUDE.md` — architecture note on the 2 KB limit and the `_metadata` pitfall.
