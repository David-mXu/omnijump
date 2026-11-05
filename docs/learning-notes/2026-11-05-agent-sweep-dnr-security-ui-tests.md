# Comprehensive Agent Sweep: Edge DNR Mechanics, Security Hardening, Performance, UI/UX Parity, and Test Suite

## 1. Problem Description, Symptoms, and Goals
This sweep audited and hardened the entire **OmniJump** Manifest V3 browser extension across five areas:
1. **Microsoft Edge DNR vs. Fallback Latency**: When searching from the address bar in Microsoft Edge, shortcuts targeting the user's configured default search engine visibly loaded the search results page before redirecting (`webNavigation.onCommitted`), whereas non-default search engines redirected instantaneously via Declarative Net Request (`declarativeNetRequest` / DNR).
2. **Security & Input Validation Vulnerabilities**:
   - `showDeleteConfirmToast()` in [`src/ui.ts`](../../src/ui.ts) interpolated `key` directly into `text.innerHTML`, creating a DOM XSS sink if an unnormalized key entered `chrome.storage.sync`.
   - Parameterized search templates (`urlTemplate`) bypassed `normalizeUrl()` during creation and inline editing, and `deriveSearchFallbackUrl()` in [`src/suggest.ts`](../../src/suggest.ts) accepted non-HTTP schemes containing `://` (`chrome://`, `edge://`, `file://`).
   - `normalizeUrl()` only checked scheme prefixes without parsing via `new URL()`, allowing hostless URLs (`https://`), whitespace hostnames (`https://bad host`), or `%s` in the hostname (`https://%s`).
   - JSON import in [`src/sidepanel.ts`](../../src/sidepanel.ts) and [`src/options.ts`](../../src/options.ts) spread raw objects and crashed on `null` entries, numeric keys/labels, non-array `bundleUrls`, or `parameterized` shortcuts missing `%s`.
3. **Concurrency, Storage & Service Worker Bugs**:
   - Concurrent `rebuildDynamicRules()` calls in [`src/dnr.ts`](../../src/dnr.ts) raced on `getDynamicRules()` and positional rule IDs (`1..N`), risking duplicate rule ID errors.
   - `chrome.storage.onChanged` in [`src/background.ts`](../../src/background.ts) triggered a full DNR rule rebuild on every shortcut use (`touchShortcut` updating `useCount` and `lastUsed`) and on UI-only settings changes.
   - `renameShortcut()` in [`src/storage.ts`](../../src/storage.ts) unconditionally removed `oldKey` after setting `newKey`, deleting the shortcut when `newKey === oldKey`.
   - `upsertShortcut()` dropped `existing?.useCount` when updating an existing shortcut, and `touchShortcut()` incremented daily usage stats (`omnibar_daily`) even when the queried keyword was not a saved shortcut.
   - `handleJsRedirect`, `handleBundleNavigation`, and `handleShortcutTouch` normalized raw search tokens with `normalizeKey()`, stripping punctuation (`c++` → `c`, `gh?` → `gh`) and converting spaces to hyphens (`work docs` → `work-docs`), hijacking ordinary web searches.
4. **UI/UX & Sidepanel/Options Parity**:
   - Inline row editing in [`src/ui.ts`](../../src/ui.ts) could not edit shortcut labels and overwrote custom fallback URLs on parameterized search shortcuts.
   - [`src/options.ts`](../../src/options.ts) lacked alias grouping (`.alias-row`), the "Add alias" action, URL ancestor chips (`#redirectUrlAncestors`), hover-based keyboard shortcuts, and `dailyCounts` in JSON export/import.
   - Dark-mode primary buttons in [`src/theme.css`](../../src/theme.css) used `#ffffff` text on `#4da3ff` (`2.64:1` contrast ratio, below the WCAG AA `4.5:1` minimum).
5. **Test Coverage**: [`src/background.ts`](../../src/background.ts), [`src/manifest.ts`](../../src/manifest.ts), [`src/onboarding.ts`](../../src/onboarding.ts), [`src/sidepanel.ts`](../../src/sidepanel.ts), [`src/options.ts`](../../src/options.ts), and runtime logic in [`src/popup.ts`](../../src/popup.ts) had 0% automated test coverage.

---

## 2. Root Causes and Underlying Concepts

### Why Microsoft Edge Suppresses DNR Redirects on the Default Search Engine
- **Declarative Net Request (`chrome.declarativeNetRequest`)**: A browser-level rules engine that evaluates compiled RE2 regular expressions (`regexFilter`) or URL patterns (`urlFilter`) against network requests before they hit the network stack.
- **Live Edge Investigation**: By inspecting the running OmniJump extension in Microsoft Edge (`Edg/156.0`) via CDP (`browser-use`), we verified that:
  - All 567 dynamic rules were compiled and active in Edge (`chrome.declarativeNetRequest.getDynamicRules()`).
  - Navigations to non-default search engines (`https://www.bing.com/search?q=aistudio`, `https://duckduckgo.com/?q=aistudio`, `https://www.google.ca/search?q=aistudio`, `https://google.com/search?q=aistudio`) redirected at the network layer (`transitionQualifiers: ['server_redirect']`).
  - Navigations to the configured **default search engine origin** (`https://www.google.com/search?q=...`) allowed DNR `action: { type: 'block' }` (`net::ERR_BLOCKED_BY_CLIENT`), but **Edge's C++ network delegate intentionally ignores extension DNR `action: { type: 'redirect' }` rules on the user's configured default search engine origin** as an anti-hijacking measure.
  - Because `handleJsRedirect` had been moved to `webNavigation.onCommitted` (to avoid double-navigating on Chrome when `await getStore()` took ~20 ms), Edge had to complete the full DNS + TLS + SafeSearch `302` (`&safe=active&ssui=on`) + HTTP `200` round-trip (~250–600 ms) before redirecting.

### Token Normalization vs. Exact Keyword Matching
- `normalizeKey()` in [`src/storage.ts`](../../src/storage.ts) strips non-`[a-z0-9-]` characters and collapses spaces to hyphens. While appropriate when *saving* a user-chosen keyword, running `normalizeKey()` on raw search queries without checking `rawToken === normalized` caused queries containing punctuation (`c++`, `gh?`, `yt:`) or spaces (`work docs`) to match unrelated shortcuts in the service worker's `webNavigation` listeners.

---

## 3. Investigation and Implementation Steps

### Step 1: Live Edge Probing & Instant Pre-Network Redirect (`src/dnr.ts`, `src/background.ts`)
- **Evidence**: Live `webNavigation` tracing in Edge showed `onBeforeNavigate` fires at `T = 0 ms` (before any network request), whereas `onCommitted` fires at `T = 250–350 ms` after Google's SafeSearch redirect.
- **Implementation**:
  - Added an in-memory `cachedStore` (`getFastStore()`) in [`src/background.ts`](../../src/background.ts) invalidated on `chrome.storage.onChanged`, eliminating the 4× per-navigation `chrome.storage.sync.get(null)` IPC round-trips.
  - Detected Microsoft Edge (`IS_EDGE = /\bEdg\//i.test(globalThis.navigator?.userAgent ?? '')`) and invoked `handleJsRedirect` inside `webNavigation.onBeforeNavigate` on Edge with a per-tab `recentJsRedirects` deduplication guard (1,500 ms TTL), while keeping `webNavigation.onCommitted` as the universal safety net across all browsers.
  - Hardened DNR regexes in [`src/dnr.ts`](../../src/dnr.ts):
    - Allowed optional trailing slash on Bing (`(?:www\.|cn\.)?bing\.com/search/?`).
    - Allowed trailing encoded whitespace `(?:\+|%20)*` in `buildQueryRegex` so `gh ` in the omnibar matches native DNR.
    - Updated `buildParamQueryRegex` to `(?:\+|%20)+([^&#]+?)(?:[&#].*)?$` so multiple spaces after a keyword are collapsed and a trailing space (`?q=yt+&form=QBLH`) never crosses `&` to capture `&form=QBLH` as `\1`.
    - Escaped literal backslashes and replaced all `%s` placeholders in `regexSubstitution`.
    - Added a coalescing concurrency lock (`activeRebuild` / `rebuildQueued`) around `rebuildDynamicRules()`.

### Step 2: Security & Storage Hardening (`src/suggest.ts`, `src/storage.ts`, `src/manifest.ts`, `src/ui.ts`)
- **DOM XSS Fix**: Replaced `text.innerHTML` in `showDeleteConfirmToast()` ([`src/ui.ts`](../../src/ui.ts)) with `document.createTextNode`, `document.createElement('strong')`, and `document.createElement('kbd')` using `.textContent`, and added a clickable **Delete** confirmation button inside the toast.
- **URL & Template Validation**: Hardened `normalizeUrl()` and `deriveSearchFallbackUrl()` in [`src/suggest.ts`](../../src/suggest.ts) to strip ASCII control characters, block non-`http(s):` and protocol-relative URLs while permitting schemeless `host:port` (e.g. `localhost:8080`), and validate structure via `new URL()` (rejecting whitespace, hostless URLs, and `%s` in the hostname).
- **Storage Integrity**: Updated [`src/storage.ts`](../../src/storage.ts) to normalize keys loaded in `getStore()`, preserve `useCount` in `upsertShortcut()`, fix self-deletion when `newKey === oldKey` in `renameShortcut()`, serialize `touchShortcut()` via an in-memory promise queue while skipping `omnibar_daily` increments for non-existent shortcuts, cap `seedStarterShortcuts()` at `maxShortcuts`, and cap `omnibar_dismissed` at 200 hosts.
- **Manifest CSP**: Added `content_security_policy.extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none';"` in [`src/manifest.ts`](../../src/manifest.ts).

### Step 3: UI/UX, Shared Controller Deduplication & Sidepanel/Options Parity (`src/panel-controller.ts`, `src/ui.ts`, `src/sidepanel.*`, `src/options.*`, `src/popup.*`, `src/onboarding.*`, `src/theme.css`)
- **Shared Controller Extraction ([`src/panel-controller.ts`](../../src/panel-controller.ts))**: Extracted ~1,170 lines of duplicated logic between [`src/sidepanel.ts`](../../src/sidepanel.ts) and [`src/options.ts`](../../src/options.ts) into `initPanelController(options)`, shrinking both entry points to 7-line wrappers and cutting ~25 KB from the built bundle.
- **Full Inline Editing**: Exposed an optional **Label** input for all shortcut types and an optional **Fallback URL** input (pre-filled with `shortcut.url`) for parameterized search shortcuts in [`src/ui.ts`](../../src/ui.ts).
- **100% Parity**: Shared `groupShortcuts()` and `hasShortcutTargetCollision()` from [`src/ui.ts`](../../src/ui.ts), bringing alias grouping, "Add alias" (supporting both `redirect` and `parameterized` shortcuts), `#redirectUrlAncestors` chips, `hoveredRow` hotkeys, and `dailyCounts` export/import to both surfaces.
- **In-Place Store Cache Patching ([`src/background.ts`](../../src/background.ts))**: Updated `chrome.storage.onChanged` to patch `cachedStore` in-place via `applyChangesToCachedStore()` instead of invalidating the entire cache on every `touchShortcut()` write, keeping the store permanently hot in memory.
- **Accessibility & Contrast**: Set `--on-accent: #020c1b;` in `body.dark` ([`src/theme.css`](../../src/theme.css)) for WCAG AAA contrast on primary buttons, added ARIA tab/tabpanel/status roles and input labels, restricted row drag-and-drop initiation to `.drag-handle` so text inside `.url-input` remains selectable, and cached `omnijump_dark` in `localStorage` to prevent dark-mode FOUC.

---

## 4. Alternatives and Tradeoffs
- **Running `handleJsRedirect` on `onBeforeNavigate` for All Browsers vs. Edge-Only + `onCommitted` Universal Fallback**:
  - Running `chrome.tabs.update` inside `onBeforeNavigate` on Chrome (where DNR already redirects default search engine requests at the network layer) would race with the native DNR redirect. Restricting the `onBeforeNavigate` JS redirect to Edge (`IS_EDGE`) while keeping `onCommitted` as a deduplicated universal fallback gives Edge instant pre-network redirects (`~20 ms`, zero search-page flash) while keeping Chrome and Firefox on 100% native DNR.
- **Host:Port vs. Scheme Prefix Detection in `normalizeUrl()`**:
  - A naive `/^[a-z][a-z0-9+\-.]*:/i` regex blocks dangerous schemes (`javascript:`, `data:`) but also falsely rejects schemeless `localhost:8080` or `example.com:3000`. Exempting `^[a-z0-9.-]+:\d+(?:[/?#]|$)` before prepending `https://` allows `host:port` inputs while still blocking every non-HTTP scheme.

---

## 5. Verification
All checks were executed and observed directly:
- **TypeScript Type-Checking**: `npx tsc --noEmit` → **0 errors**.
- **Automated Test Suite**: `npm test` (`vitest run`) → **10 test suites passed, 192 tests passed** (up from 6 suites / 111 tests):
  - [`src/dnr.test.ts`](../../src/dnr.test.ts) (27 tests)
  - [`src/suggest.test.ts`](../../src/suggest.test.ts) (32 tests)
  - [`src/fuzzy.test.ts`](../../src/fuzzy.test.ts) (21 tests)
  - [`src/storage.test.ts`](../../src/storage.test.ts) (43 tests)
  - [`src/manifest.test.ts`](../../src/manifest.test.ts) (5 tests)
  - [`src/background.test.ts`](../../src/background.test.ts) (20 tests)
  - [`src/ui.test.ts`](../../src/ui.test.ts) (18 tests)
  - [`src/popup.test.ts`](../../src/popup.test.ts) (10 tests)
  - [`src/onboarding.test.ts`](../../src/onboarding.test.ts) (4 tests)
  - [`src/sidepanel.test.ts`](../../src/sidepanel.test.ts) (12 tests across both `sidepanel` and `options`)
- **Production Builds**: `npm run build:all` → built both `dist/chrome` and `dist/firefox` cleanly with zero warnings or errors.
