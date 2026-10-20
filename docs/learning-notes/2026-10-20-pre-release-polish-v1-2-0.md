# OmniJump Pre-Release Polish & UX Improvements (v1.2.0)

## 1. Problem Description & Feature Goal
Before deploying OmniJump v1.2.0 to the Chrome Web Store (following the v1.1.0 release), several UX rough edges and documentation gaps were identified:
1. **Omnibar Search Previews**: When typing `oj <keyword> <arguments>` in the address bar (e.g. `oj yt cats`), the autocomplete suggestion list showed the raw template `https://youtube.com/results?search_query=%s` rather than the live preview of where navigation would lead (`https://youtube.com/results?search_query=cats`).
2. **Search Shortcut Fallback URLs**: When creating or editing a parameterized search shortcut without an explicit fallback URL, the fallback was derived via a naive `template.replace('%s', '')`. For search engines with query parameters (e.g. `https://github.com/search?q=%s`), this left dangling query artifacts (`https://github.com/search?q=`), which often produced empty search pages rather than clean destination homepages.
3. **Keyboard Dismissal (`Escape` Key)**: Users editing a row in the shortcut list or opening tab/shortcut pickers in the New Bundle or New Shortcut forms could not dismiss or cancel the active mode by pressing `Escape`.
4. **Filter Threshold Visibility**: The shortcut search/filter input was hidden until a user accumulated 25 shortcuts, which was too high for users who manage 10–20 shortcuts and want quick filtering.
5. **Documentation Accuracy**: `README.md` still referenced `{query}` instead of `%s`, described smart tips as search-frequency tracking rather than visit-frequency tracking, and omitted key features like `oj` omnibox autocomplete and delete undo toasts.

## 2. Concepts & Architecture
- **Parameter Resolution (`resolveTarget`)**: Parameterized shortcuts in OmniJump store a `urlTemplate` containing `%s`. Resolving a target dynamically injects URI-encoded query tokens or falls back to the base `url`.
- **URL Parameter Normalization (`URL` & `searchParams`)**: Standard browser URL parsing decomposes a URL into `pathname`, `searchParams`, and `hash`. When deriving a clean fallback URL for a search template:
  - Any query parameter whose key or value contains `%s` must be deleted from `searchParams`.
  - Empty or dangling query delimiters (`?`, `&`, `#`) must be stripped if all parameters were removed.
  - Path and hash fragments containing `%s` are cleaned without leaving broken syntax.
- **Keyboard Event Accessibility**: In web extensions, modals and inline editing forms should adhere to standard accessibility expectations: pressing `Escape` cancels edit state, restores previous view state, and returns focus to the active row.

## 3. Investigation & Implementation Steps
1. **Live Omnibar Previews in [`src/background.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/background.ts)**:
   - In `chrome.omnibox.onInputChanged`, updated suggestion generation: passed the parsed search arguments (`args`) into `resolveTarget(s, args)` instead of an empty string, falling back to `s.urlTemplate ?? s.url ?? ''`.
   - Firefox uses plain text descriptions while Chrome uses XML-markup descriptions; both now display the real-time destination URL as users type queries.
2. **Robust Fallback Derivation in [`src/suggest.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/suggest.ts)**:
   - Implemented `deriveSearchFallbackUrl(template, explicitFallback?)` and exported `normalizeUrl` alongside it.
   - When an explicit fallback is provided, it is validated and normalized. When omitted, the template is parsed via `new URL()`, query parameters matching `%s` are removed from `searchParams`, hash/pathname tokens are cleaned, and trailing delimiters are pruned.
   - Integrated `deriveSearchFallbackUrl` into [`src/ui.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/ui.ts), [`src/sidepanel.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/sidepanel.ts), and [`src/options.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/options.ts).
3. **Escape Key Handling**:
   - In [`src/ui.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/ui.ts), tracked active `editingRow`, added `cancelRowEdit()` restoring row styling and returning keyboard focus to the item, and registered a document-level `Escape` listener.
   - In [`src/sidepanel.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/sidepanel.ts) and [`src/options.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/options.ts), updated the `keydown` listener to close open pickers (`tabPickerEl`, `redirectTabPickerEl`, `shortcutPickerEl`) and cancel bundle editing mode when `Escape` is pressed.
4. **Lower Filter Threshold**:
   - Changed default `filterThreshold` from 25 to 10 in `DEFAULT_SETTINGS` in [`src/types.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/types.ts), and updated the initial caches in [`src/sidepanel.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/sidepanel.ts) and [`src/options.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/options.ts).
5. **Updated Documentation in [`README.md`](file:///home/davidxu/Programming/Extensions/OmniJump/README.md)**:
   - Corrected template placeholder documentation to `%s`.
   - Updated smart tips to describe visit frequency tracking.
   - Documented the `oj` omnibox search keyword and the 6-second undo toast for deleted shortcuts.
6. **Version Bump to 1.2.0**:
   - Updated `package.json` and `package-lock.json` to version `1.2.0`.

## 4. Alternatives & Tradeoffs
- **URL Object vs. Regular Expression Parsing**: Using regex string manipulation alone often fails on edge cases with multiple query arguments (e.g. `?category=docs&q=%s` vs `?q=%s&category=docs`). Relying on the browser's native `URL` and `URLSearchParams` guarantees standards-compliant encoding and parameter deletion, while keeping a regex fallback only for unparseable URLs.
- **Global vs. Per-Input Key Listeners**: Binding the `Escape` handler at the document level ensures that whether the user is typing in a text input, focusing a picker button, or navigating rows with `j`/`k`, pressing `Escape` predictably dismisses the overlay without needing listeners attached to every input element.

## 5. Verification
- **Unit Tests**:
  - Added unit test suites for `normalizeUrl` and `deriveSearchFallbackUrl` covering query param stripping, hash cleaning, pathname handling, explicit fallbacks, and protocol inference in [`src/suggest.test.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/suggest.test.ts).
  - Executed `npm test` (vitest): all 97 tests passed across 4 test suites.
- **Type Checking**:
  - Ran `npx tsc --noEmit`: 0 TypeScript diagnostics.
- **Extension Builds**:
  - Ran `npm run build:all`: both `dist/chrome` and `dist/firefox` compiled cleanly. Inspected `dist/chrome/manifest.json` and verified `"version": "1.2.0"`.
- **Release Automation & OAuth Observation**:
  - Pushed commit `5873c6f` and git tag `v1.2.0`.
  - The `.github/workflows/release.yml` workflow ran automatically (run `39452904718`), passing all tests, typechecks, and package steps.
  - The CWS API upload failed with `400: invalid_grant` because the stored Google OAuth `REFRESH_TOKEN` expired. In Google Cloud Console, OAuth consent screens in "Testing" status enforce a 7-day expiration policy on refresh tokens. Switching the Google Cloud OAuth Consent Screen status from "Testing" to "In production" ensures permanent tokens.
  - Generated `dist/omnijump-chrome-v1.2.0.zip` (80 KB) and `dist/omnijump-firefox-v1.2.0.zip` (80 KB) ready for instant upload or manual CWS dashboard submission.
