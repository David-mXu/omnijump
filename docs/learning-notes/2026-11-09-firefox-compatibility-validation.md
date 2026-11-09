# Firefox compatibility validation and the DNR quota fix

## Goal and outcome

The goal was to verify that OmniJump's Firefox users get the same working experience as Chrome users, rather than relying on a Firefox-looking manifest and Chrome API mocks.

The investigation found and fixed one real compatibility bug: the redirect-rule builder budgeted only the **5,000 total dynamic rules**, although every rule it generated was a **regex rule**, subject to a separate **1,000-rule quota**. The builder now budgets for both quotas, keeping every shortcut that fits fully covered rather than falling back to a large per-rule repair cycle.

The shipped Firefox artifact and Chrome build both pass after the change. The tests also prompted a documentation correction: the manifest already requires Firefox 140+, while the README incorrectly said 128+.

## Concepts: two different DNR budgets

[Declarative Net Request (DNR)](../../src/dnr.ts) lets an extension define browser-side request redirects. OmniJump generates one rule per shortcut per supported search engine. Parameterized shortcuts generate exact and argument-capturing rules, so they use twice as many.

There are two relevant limits:

- **Total dynamic rules:** up to 5,000 in the tested runtime.
- **Regex rules:** 1,000 in Firefox 159.0.1, as well as in Chrome's usual configuration.

A rule can count against the second budget without approaching the first. Before this change, adding 143 ordinary redirect shortcuts requested 1,001 regex rules. The real Firefox run exposed rejection followed by the recovery loop's many sequential updates. Partial coverage was possible because rules were grouped by engine within each shortcut.

The fix in [src/dnr.ts](../../src/dnr.ts) uses the browser's `MAX_NUMBER_OF_DYNAMIC_RULES` and `MAX_NUMBER_OF_REGEX_RULES` constants when available, retaining documented fallbacks. It reserves the **whole** seven- or fourteen-rule group for each shortcut. If that group will not fit, that shortcut is skipped and reported through the existing warning path; no partial engine group is generated. The existing navigation fallback remains available when no DNR rule handles a search.

I deliberately chose pre-checking the budget over relying on the per-rule rejection repair path. The latter is still needed for other rejected rules, but using it for every predictable quota overflow is expensive and could leave inconsistent coverage.

## Investigation and implementation, in order

### 1. Establish a baseline

The starting code passed:

- `npm test` — **216 tests passed**, 10 files.
- `npx tsc --noEmit` — passed.
- `npm run build:firefox` — succeeded.
- `npx web-ext lint --source-dir dist/firefox` — **0 errors, 6 warnings**.

The warnings are one Firefox for Android minimum-version notice and five `innerHTML` inspection warnings. They were retained rather than misreported as validation errors.

### 2. Test the artifact in actual Firefox

No Firefox executable was installed. With approval, I downloaded **Firefox 159.0.1** from Mozilla's official release CDN and **geckodriver 0.36.0** from Mozilla's official GitHub release. They and the test profiles were isolated under `/tmp`. No normal Chrome, Edge, Firefox, or sync profile was used.

The extension was installed as a **temporary unsigned test addon**, the normal development workflow. I did not disable Firefox's extension-signature enforcement or Safe Browsing. Privileged browser UI access was enabled only for the approved disposable test profile. A local HTTP fixture served deterministic redirect, parameterized-search, bundle, and smart-tip destinations. Public search-engine URLs carried synthetic keywords only.

Early observations:

- The Firefox manifest installed without errors and first-run onboarding opened.
- **17 starter shortcuts** rendered.
- Firefox accepted the expected **154 starter DNR rules**.
- The event page was live and the reported regex-rule limit was 1,000.

The real UI also disproved two tempting static-audit hypotheses:

- JSON export produced a complete 143-shortcut file even with immediate Blob URL revocation, so I did not change working code based on a speculative download-lifetime issue.
- Firefox already hides the Chrome-only shortcut-settings button and displays the correct `about:addons` instructions. The internal Chrome settings URL was unreachable dead code, not a user-facing failure. The testing-only edit to that handler was reverted.

### 3. Fix the quota and add regression tests

The main implementation is in [src/dnr.ts](../../src/dnr.ts).

[src/dnr.test.ts](../../src/dnr.test.ts) now covers:

- The normal **1,000-regex budget**, including a deliberate 1,001-rule input. Only 994 rules are accepted, one atomic update is submitted, and the final shortcut does not receive a partial engine set.
- Deducting both exact and parameterized rules. Seventy-one parameterized shortcuts fit fully; the next requires fourteen additional rules and is skipped.
- The separate **5,000 total-rule ceiling** with a simulated higher regex quota.

[src/sidepanel.test.ts](../../src/sidepanel.test.ts) adds two test variants—side panel and options page—to preserve the Firefox behavior that hides the Chrome-only customization control and reveals its `about:addons` instructions. Vite environment overrides are reset after each test.

The README now agrees with the existing Firefox 140 minimum and describes storage sync browser-neutrally.

### 4. Verify real behavior, then use targeted diagnostics

All of the following ran with real Firefox and real extension APIs. The management suite passed **11/11** assertions; the navigation suite passed **15/15** assertions.

| Area | Observed result |
|---|---|
| Redirects | Google, Bing, DuckDuckGo, Brave, Kagi, Ecosia, and Startpage all reached the intended fixture. |
| Parameterized search | Arguments, escaping, and the no-argument fallback URL worked. A native DNR substitution used `+` for spaces; decoded query values were correct, so the test checks URL semantics rather than requiring one equivalent encoding. |
| Bundles | Direct search and `oj` each opened all three destinations exactly once per invocation, without duplicate extra tabs from that invocation. |
| Actual address bar | A plain keyword, fuzzy `oj` lookup, arguments, and a bundle worked. Firefox suggestions were plain text, with no Chrome XML markup. |
| Stats | Redirect, parameterized, and bundle activations incremented usage metadata. |
| Real toolbar popup | Saved `ffpopup` against the correct HTTP fixture through the browser's public `action.openPopup()` path and native pointer input. |
| Native Firefox sidebar | The rendered panel showed the live list. `sidebarfix` was entered and saved successfully, then read back from `chrome.storage.sync`. |
| Management UI | Redirects, collision alternatives, inline edit, search creation, bundle editing/renaming, cross-view live updates, settings, export, sanitized import, bulk delete, Undo, filtering, and row keyboard actions passed. |
| Context menus | Firefox's real page and link menus saved `con` and `lin` to the correct, distinct URLs. |
| Smart tips | Three actual visits created `sma`, the expected site URL, and a live `TIP` badge. Native toolbar Save also created the requested record and cleared its suggestion/badge. |
| Restart and background lifecycle | A restart from the validated profile retained shortcuts and usage. Forcing the event page from `running` to `stopped`, then navigating, woke it to `running` and increased `ftest` useCount from 9 to 10. |
| Quota | The fixed artifact generated **994** rules, gave **142** shortcuts complete seven-engine coverage, and skipped exactly one whole shortcut. |

Browser storage returned the fixture keys lexicographically: `k0`, `k1`, `k10`, …, `k142`, `k15`, …, `k99`. The skipped key was `k99`, not the numerically last fixture key. The final assertion checks all included groups and the skipped count instead of assuming insertion order. This was an important distinction between a genuine quota defect and a test assertion with the wrong ordering assumption.

An apparent duplicate `oj` bundle was another useful diagnostic correction. A temporary event-tracing build showed one `onInputEntered` event and one current-tab navigation. The earlier direct-bundle test had left tabs open; those legitimate tabs, plus the new bundle, made some URLs appear twice. Testing the **new tabs produced by the second invocation** fixed the assertion, not the application. The temporary instrumentation was then removed and the production package rebuilt and retested.

For native sidebar input, a headed Firefox screenshot showed the panel and its live rows. The inner browser's bounds are relative to its outer browser frame. Adding both frame offsets allowed a real click into keyword and URL fields and successful saving. This is preferable to treating a missed click as an application failure.

Undo was checked with explicit prior usage and timestamps so the assertion was independent of asynchronous shortcut creation. A focused undo run and the concluding full management suite both preserved the record exactly.

## Final verification

The final, production-source checks were:

```text
npx tsc --noEmit
npm test
npm run build:all
npx web-ext lint --source-dir dist/firefox
```

Observed results:

- Type-check passed.
- **220 tests passed** in 10 files.
- Chrome and Firefox builds completed.
- Firefox lint: **0 errors**, the same **6 warnings** as baseline.
- The production Firefox package repeated all **15/15** navigation assertions.

Temporary WebDriver fixtures, diagnostic profiles, and event-tracing scripts were kept outside the repository. They are not part of the extension or its normal build.

## Limits and remaining checks

This is substantial desktop Firefox verification, not a claim that every Firefox environment has been tested:

- **Cloud Firefox Sync** was not verified. No signed-in Firefox account or second device was available. Two extension pages did receive changes from real `chrome.storage.sync` without reload, but that does not test server synchronization or conflict resolution across devices.
- Firefox's live `commands.getAll()` and XUL elements reported the expected `Alt+Shift+A` and `Alt+Shift+S` bindings. Generating physical browser-level shortcut activation was not reliable through WebDriver, so this is registration evidence, not an end-to-end physical-keyboard pass.
- The native Smart-tip **Dismiss** button could not be targeted reliably by the available popup automation. Its handler passed the component test covering session removal and local suppression, but a real native-button activation remains unverified. Save, non-tip quick-save, and smart-tip generation were verified separately.
- The control flow was exercised on **Firefox Desktop 159.0.1 on Linux/WSL**, not every earlier supported release, Firefox for Android, or every desktop OS. Firefox-for-Android metadata compatibility is not implied by those runs.

Several apparent defects were ultimately harness issues: wrong URL-normalization expectations, discarded driver tabs, API calls from ordinary web pages, and incorrect frame coordinates. I have not treated those as product bugs or claimed an unexecuted native activation as passing.

## Commit and release scope

The intended source change is small: the quota guard, regression tests, corrected documentation, and this learning note. Diagnostic background tracing was removed. No release version was bumped and no store publish or version tag was triggered by the validation work.
