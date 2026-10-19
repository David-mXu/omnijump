# Preventing Search Shortcut Overrides on Scoped Subdomains

## 1. Problem Description
When typing a query like `docs homelab` in the browser address bar—where `docs` is a parameterized search shortcut pointing to Google Docs (`https://docs.google.com/document/u/0/?q=%s`) and `homelab` is a saved redirect shortcut—OmniJump navigated to the `homelab` shortcut target instead of searching Google Docs for "homelab". The redirect shortcut unexpectedly overrode the search query.

## 2. Root Cause & Underlying Concepts
- **Declarative Net Request (DNR)**: Chrome's Manifest V3 API (`chrome.declarativeNetRequest`) allows extensions to intercept network requests via pre-compiled rules without executing background JavaScript for every request.
- **Search Engine Scoping Regex**: To prevent redirecting standard website visits, OmniJump scopes dynamic redirect rules to search engine domains (`SEARCH_HOST_REGEX_SOURCE` in [`src/dnr.ts`](../../src/dnr.ts)).
- **The Defect**:
  `SEARCH_HOST_REGEX_SOURCE` previously used the pattern:
  ```regex
  ^https?://(?:[a-z0-9-]+\.)*(?:google\.[a-z]+(?:\.[a-z]+)?|bing\.com|duckduckgo\.com|...)/
  ```
  The wildcard subdomain prefix `(?:[a-z0-9-]+\.)*` matched all subdomains of Google, including `docs.google.com`, `drive.google.com`, `mail.google.com`, and `calendar.google.com`. Furthermore, the path expression `[^#]*[?&]q=key` allowed matching across any URL path.

  When `docs homelab` was executed:
  1. The parameterized rule for `docs` (priority 2) matched the initial address bar search on Google (`google.com/search?q=docs+homelab`) and redirected to `https://docs.google.com/document/u/0/?q=homelab`.
  2. Because `docs.google.com` matched `SEARCH_HOST_REGEX_SOURCE` and contained `?q=homelab`, DNR evaluated the redirected request and matched the exact redirect rule for `homelab` (priority 1).
  3. The browser redirected a second time to the `homelab` shortcut URL, overriding the user's intended Google Docs search.

## 3. Investigation & Implementation Steps
1. **Inspecting Shortcut Data & Rules**: Inspected user shortcut configuration and discovered `docs` was mapped to `https://docs.google.com/document/u/0/?q=%s`.
2. **Tracing URL Match Behavior**: Evaluated `buildQueryRegex("homelab")` and `buildParamQueryRegex("docs")` against Google Docs URLs in Node.js. Verified that `https://docs.google.com/document/u/0/?q=homelab` returned `true` for `homelab`'s query regex.
3. **Constraining Host & Path Scoping**:
   - Replaced the overly broad `(?:[a-z0-9-]+\.)*` subdomain matcher with `(?:www\.)?` for Google, scoping matches strictly to web search hostnames (`google.com`, `www.google.com`, and regional domains like `www.google.co.uk`).
   - Scoped allowed search paths explicitly (e.g. `/(?:search|webhp)?` for Google, `/search` for Bing, Kagi, Ecosia, and Brave).
   - Constrained query parameter delimiters in `buildQueryRegex` and `buildParamQueryRegex` to `(?:\?[^#]*&|\?)q=...` so non-search paths (e.g., `/maps`, `/finance`, `/document/u/0/`) cannot be bypassed by path-swallowing wildcards.
4. **Synchronizing Helper Functions**: Updated `SEARCH_HOST_REGEX` in [`src/dnr.ts`](../../src/dnr.ts) to anchor path boundaries with `(?:[?#]|$)`, ensuring `isSearchEngineUrl()` returns `false` for `docs.google.com` across both DNR dynamic rules and background navigation listeners (`handleJsRedirect`, `handleShortcutTouch`, and `handleBundleNavigation` in [`src/background.ts`](../../src/background.ts)).

## 4. Alternatives & Tradeoffs
- **Alternative 1: Tagging Redirect Requests with Query Params (e.g., `&noj=1`)**: We considered modifying search shortcut URL templates during expansion to append a bypass query parameter. This was rejected because modifying search URLs could break destinations that strictly validate query parameters, and it would not fix non-redirected visits to Google subdomains matching shortcut keys.
- **Alternative 2: Scoping Hostnames Only Without Paths**: Restricting Google to `(?:www\.)?google\.[a-z]+` prevented `docs.google.com` collisions, but still permitted paths like `google.com/maps?q=...` or `google.com/finance?q=...` to trigger shortcuts. Scoping search paths alongside hosts provides comprehensive isolation.

## 5. Verification
- **Automated Tests**:
  - Ran `npm test` (vitest): all 87 tests passed.
  - Added new test cases in [`src/dnr.test.ts`](../../src/dnr.test.ts):
    - Verified `docs.google.com`, `drive.google.com`, `mail.google.com`, `calendar.google.com`, and `google.com/maps` return `false` under `isSearchEngineUrl`.
    - Verified that search shortcut `docs` paired with redirect shortcut `homelab` successfully captures `homelab` from `google.com/search?q=docs+homelab` while ensuring `https://docs.google.com/document/u/0/?q=homelab` is not matched by `homelab`.
- **Type Check & Builds**:
  - `npx tsc --noEmit`: 0 errors.
  - `npm run build:all`: successfully built packages for both Chrome and Firefox targets into `dist/chrome` and `dist/firefox`.
