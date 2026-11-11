# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
# Build for Chrome
npm run build:chrome

# Build for Firefox
npm run build:firefox

# Build both targets
npm run build:all

# Type-check only (no emit)
npx tsc --noEmit

# Run tests once
npm test

# Run tests in watch mode (re-runs on save)
npm run test:watch
```

### Dev loop (auto-reload, no chrome://extensions visits)

```bash
npm run dev          # Chrome: watch build -> dist/chrome, auto-reloads the extension
npm run dev:firefox  # same for Firefox -> dist/firefox
```

Load `dist/chrome` unpacked **once** (Windows Chrome under WSL: `\\wsl.localhost\Ubuntu\home\davidxu\Programming\Extensions\OmniJump\dist\chrome`) and leave `npm run dev` running. Never point "Load unpacked" at Chrome's Web Store install folder (`~/.config/google-chrome/Default/Extensions/<id>/<version>/`): Chrome writes a `_metadata/` folder there and refuses to load any extension containing files whose names start with `_`. Every rebuild (saves, commits, checkouts) pings a WebSocket on `localhost:35729` (`scripts/dev-reload-plugin.ts`); the service worker (`src/dev-reload.ts`, only active when `VITE_DEV_RELOAD=1`, compiled out of normal builds) calls `chrome.runtime.reload()`. Open extension pages (side panel, popup) close on reload — reopen them.
Ensure to commit and push changes when appropriate.

## Architecture

**OmniJump** is a Manifest V3 browser extension (Chrome + Firefox) that lets users save short keywords and trigger URL redirects or tab bundles by typing them into the browser's address bar.

**Build system**: Vite + `@crxjs/vite-plugin`. The manifest is generated programmatically from `src/manifest.ts` rather than being a static JSON file. `vite.config.ts` reads the `--mode` flag (`chrome` or `firefox`) and passes it to `createManifest()` for target-specific output. Output lands in `dist/{browser}`.

**Data flow**:

1. Shortcuts are stored in `chrome.storage.sync` as individual keys — `omnibar_s_{normalizedKey}` per shortcut, `omnibar_settings` for settings. This avoids the 8 KB per-item limit that a single-key approach would hit, while keeping cross-device sync. Practical ceiling is ~511 shortcuts (chrome.storage.sync's 512-item cap).
2. On every storage change, `background.ts` calls `rebuildDynamicRules()` from `dnr.ts`, which clears all existing DNR dynamic rules and re-adds rules built from the full current store. Rule IDs are positional (`index + 1`).
3. DNR rules match omnibar searches by intercepting the search engine URL (e.g. `https://google.com/search?q=gh`) via a regex on the `q=` query parameter and redirecting to the shortcut's target URL. **Each shortcut gets one rule per search engine** (`SEARCH_ENGINES` in `dnr.ts`), not one rule covering every engine: Chrome compiles `regexFilter` with RE2 and rejects any rule whose compiled program exceeds 2 KB, which the old combined host-alternation regex did — and because a bulk `updateDynamicRules` call is atomic, that single rejection silently disabled every shortcut. Keep per-rule regexes short; `src/dnr.test.ts` guards their length. `isSearchEngineUrl()` builds the same engine list into one uncompiled JS regex for the service worker's navigation listeners, so `?q=` on unrelated sites is never intercepted. If Chrome still rejects a bulk update, `applyRules()` retries rule by rule so only the offending keyword is lost.
4. For `bundle` shortcuts, the DNR rule redirects to the first URL. The service worker also listens on `webNavigation.onBeforeNavigate`, detects bundle keyword matches, and opens the remaining URLs as background tabs.
5. In Microsoft Edge (which suppresses extension DNR `redirect` rules on the configured default search engine origin), `background.ts` also runs `handleJsRedirect` on `webNavigation.onBeforeNavigate` backed by a 3-tier `getFastStore()` lookup (in-memory `cachedStore` → per-key `chrome.storage.session` mirror gated by `omnibar_store_meta` → `chrome.storage.sync`), pre-warmed on `tabs.onCreated` / `tabs.onActivated` / `windows.onFocusChanged` so cold MV3 service workers redirect without waiting on `storage.sync.get(null)` IPC, while keeping `webNavigation.onCommitted` as a deduplicated universal safety net.

**Shortcut types**:
- `redirect`: single URL target, handled entirely by DNR.
- `parameterized` (referred to as "search" in the UI): URL template containing `%s` (e.g., `https://www.youtube.com/results?search_query=%s`) with a fallback base `url`; generates 7 priority-1 exact-match DNR rules (for bare keyword) and 7 priority-2 capture-group `regexSubstitution` rules (for `keyword query`).
- `bundle`: multiple URL targets; DNR handles the first, service worker opens the rest.

**Key normalization**: `normalizeKey()` in `storage.ts` lowercases, trims, collapses spaces to hyphens, and strips non-alphanumeric characters. All storage lookups use normalized keys.

**UI entry points**:
- `popup.ts` / `popup.html` — quick-save the current tab as a redirect shortcut; auto-suggests a key from the hostname. Has an "Open Panel" button.
- `sidepanel.ts` / `sidepanel.html` — three-tab panel: Shortcuts, New Bundle, Settings.
- `options.ts` / `options.html` — full-page shortcut management page with 100% feature parity with `sidepanel.ts`.
- `src/panel-controller.ts` — shared controller powering both `sidepanel.ts` and `options.ts` with 100% feature parity (Shortcuts, New Bundle, Settings, import/export, filtering, and keyboard navigation).
- `onboarding.ts` / `onboarding.html` — first-run welcome page explaining the address-bar mechanic; opened from `onInstalled` when `details.reason === 'install'`. Not referenced by the manifest, so it's an explicit rollup input in `vite.config.ts`.
- `ui.ts` — shared `buildShortcutRow()` used by both the sidepanel and options page. Also exports `normalizeUrl()` (prepends `https://` if no protocol given), `openShortcut()` (opens a shortcut incl. all bundle tabs + touches stats), `showUndoToast()`, `renderOverwriteConfirm()`, and `savedStatusMessage()` (the first ≤3 saves teach the address-bar trick).

**Omnibox keyword**: the manifest registers `omnibox: { keyword: 'oj' }`. `background.ts` suggests up to 8 fuzzy-matched shortcuts on `onInputChanged` (usage-sorted when the input is empty; XML-markup descriptions on Chrome, plain text on Firefox) and resolves redirect/search/bundle navigation on `onInputEntered`, honoring the disposition. Works with any default search engine, unlike the DNR path.

**Shortcut lifecycle**:
- `createdAt` is set on first save, preserved on updates.
- `lastUsed` is updated via `touchShortcut()` in `storage.ts` each time a shortcut is activated via the omnibar (detected in `handleShortcutTouch` in `background.ts`).
- `cleanupStaleShortcuts()` runs on `onInstalled` and `onStartup`. A shortcut is deleted when `lastUsed` (or `createdAt` if never used) is older than `staleDays`. Records with neither timestamp get `createdAt` stamped now, so they age from that point.

**Side panel features**:
- **List order**: most-used first (`useCount`, then `lastUsed`, then key) — applied in both sidepanel and options `refresh()`.
- **Row interaction**: clicking a row (outside select mode) opens the shortcut in a new tab via `openShortcut()`; bundles open every URL. Keyboard: j/k navigate, Enter/l open, e edit, d delete (hints footer under the list).
- **Filter bar**: hidden until the shortcut count reaches `filterThreshold` (default 10, configurable in Settings). Searches key, URL, and label in real time.
- **Multi-select bulk delete**: "Select" button enters select mode; clicking a row or its checkbox toggles it. "Delete (N)" button appears when at least one is selected.
- **Delete undo**: single-row and bulk deletes show a 6-second toast whose Undo restores the records verbatim via `restoreShortcuts()` (keeps stats; `upsertShortcut` would reset them).
- **Overwrite protection**: saving a keyword that already points elsewhere (redirect/search/bundle forms, and the popup) renders an inline confirm — Overwrite, or save under a free alternative key. The popup no longer silently renames on collision.
- **Bundle & inline row editing**: "Edit" on a bundle row loads key/label/URLs into the New Bundle form (`handleEditBundle`); the submit button becomes "Update bundle" with a cancel button. Renames go through `renameShortcut`. The inline row editor supports editing keyword, URL/template, optional fallback URL (for search shortcuts), and optional label for non-bundle types (and bundles on pages without a bundle form).
- **Live sync**: `chrome.storage.onChanged` listener re-renders the list whenever any `omnibar_s_` or `omnibar_settings` key changes, so edits from another device appear immediately.
- **Add redirect form**: keyword + URL inputs with Enter key navigation (Enter in keyword → focus URL; Enter in URL → submit). Auto-focuses on panel open.
- **TIP suggestion banner**: the background counts visits per host (per-tab sessions, finalized on host change or tab close; counts live in `chrome.storage.session`). After 3 visits to a host that no shortcut already covers it stores a `Suggestion` in `chrome.storage.session`. The panel reads this on open and shows a dismissable banner: "You often visit {Site}. Save '{key}' as a shortcut?" — pre-filling the redirect form. Dismissing records the host in `omnibar_dismissed`. Gated by the `smartSuggestions` setting (off by default). `isBlocklisted()` in `background.ts` excludes hosts that must never be suggested: search engines (Google TLDs + `SEARCH_ENGINE_BLOCKLIST`) and loopback/local-dev hosts (`localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`). Loopback is excluded, not port-keyed: counting is per-hostname and the suggestion URL is rebuilt as `protocol//host/`, so a localhost suggestion would drop the port (`http://localhost/`, port 80) and create a dead shortcut.

**Bundle panel features**:
- "Add all open tabs" fills the URL list with all HTTP tabs in the current window.
- Tab picker: shows tabs with favicons and checkboxes (none pre-selected), then inserts the selected URLs.
- Drag to reorder: URL rows are draggable via the HTML drag-and-drop API; `dragover` handles insertion point calculation.

**Settings panel**:
- Max shortcuts cap (1–500)
- Filter threshold (number of shortcuts before the filter bar appears)
- Stale auto-delete toggle + number of days (7–365)
- Links to `chrome://extensions/shortcuts` to configure keyboard shortcuts

**Smart tip badge**: `background.ts` sets a `TIP` badge on the extension icon after the threshold is crossed. Counts survive service worker restarts because they are stored in `chrome.storage.session`.

**Bundle deduplication**: `shouldHandleBundle` in `background.ts` uses `chrome.storage.session` to record the last time extra tabs were opened for each tab ID. If the same tab triggers again within 1,500 ms it skips, preventing double-opens from redundant `onBeforeNavigate` events.

## Testing

Tests live alongside source files (`*.test.ts`) and use **Vitest** with a Node environment. Chrome APIs are mocked via `src/test/chrome-mock.ts`, which provides an in-memory implementation of `chrome.storage.sync/local/session` and `chrome.declarativeNetRequest`. Each test file creates a fresh mock in `beforeEach` via `createChromeMock()` and assigns it to `globalThis.chrome`.

| File | What it covers |
|------|----------------|
| `src/suggest.test.ts` | `normalizeKey`, `suggestKeyFromUrl`, `uniqueKey` |
| `src/fuzzy.test.ts` | Fuzzy matching, scoring, and ranking for omnibox autocomplete |
| `src/storage.test.ts` | `getStore`, `upsertShortcut`, `deleteShortcut`, `saveSettings`, `migrateFromLegacyStorage`, starter seeding, `chrome.storage.session` mirror coherence |
| `src/dnr.test.ts` | `rebuildDynamicRules`, rule IDs, parameterized rules, DNR regex correctness and RE2 length bounds |
| `src/background.test.ts` | Service worker listeners, `handleJsRedirect`, session-cache cold restart & pre-warming, bundle deduplication, smart tips, omnibox suggestions |
| `src/ui.test.ts` | `buildShortcutRow`, inline row editor (keyword, URL/template, fallback URL, label), `openShortcut`, undo toast |
| `src/popup.test.ts` | Quick-save popup flow, auto-suggested keys, overwrite confirmation |
| `src/sidepanel.test.ts` | Side panel & options controller (`panel-controller.ts`), tabs, filter bar, bulk select/delete, bundle editing |
| `src/onboarding.test.ts` | First-run onboarding page, starter shortcut pack restore |
| `src/manifest.test.ts` | Target-specific manifest generation (`chrome` vs `firefox`), permissions, keyboard commands |

CI runs on every push via `.github/workflows/ci.yml`: `npm ci` → `tsc --noEmit` → `npm test`.

## Releasing

The extension version lives only in `package.json` (`src/manifest.ts` imports it). `npm version patch && git push --follow-tags` pushes a `vX.Y.Z` tag, which triggers `.github/workflows/release.yml`: tests, builds both targets, uploads and auto-publishes the Chrome build to the Chrome Web Store via the official API, and attaches both zips to a GitHub release. Two additional stores follow the same pattern with prefixed tags: `firefox/v*` → `publish-firefox.yml` (AMO via `web-ext sign`) and `edge/v*` → `publish-edge.yml` (Edge Add-ons REST API v1.1, curl-only). All three jobs sit behind `environment:` gates (`chrome-store` / `firefox-addons` / `edge-addons`). One-time credential + listing setup per store is in `docs/publishing.md`. The Gecko ID is locked to `omnijump@example.com` by the existing AMO listing — never change it (AMO rejects mismatched IDs; changing it means deleting the listing).

## Known issues / remaining gaps

The 2026-11-05 red-team audit ([`security/red-team-audit-2026-11-05.md`](security/red-team-audit-2026-11-05.md)) found no runtime exploit; **all High/Medium/Low findings were remediated the same day** (import now has collision confirmation + strict sanitization, publish tools are npm-pinned, both publish jobs declare `environment:` gates, import can no longer flip behavior settings or plant far-future timestamps, Google DNR hosts are TLD-restricted, visit counting respects the smart-suggestions toggle, and storage boundaries re-validate). Open items before editing:

- **Environments configured (2026-11-06):** `chrome-store` / `firefox-addons` / `edge-addons` each require reviewer `David-mXu` before credentials are exposed to a publish job. Edge `EDGE_API_KEY` expires 2027-01-16 — rotate it before then (see `docs/publishing.md`).
- **Write boundaries:** all untrusted input must pass `sanitizeShortcut` (`src/storage.ts`) or the form-level validators + `MAX_KEY_LENGTH = 64` cap (`src/types.ts`); never write parsed JSON or sync data to `chrome.storage.sync` verbatim.
- **Import settings whitelist** is intentionally limited to `maxShortcuts` / `filterThreshold` / `darkMode` — do not re-add behavior toggles to it.
- **Publish tools stay pinned** (`chrome-webstore-upload-cli`, `web-ext` devDependencies); never reintroduce `npx ...@latest` in workflows next to store credentials.
- Deferred (documented in the report): vite 8 / rollup 4 major upgrades, CSP tightening, `regexSubstitution` `$`-semantics live probe, Edge back-navigation dedup wedge.

The exact status strings import tests assert: `Imported X shortcuts (N failed — check console for details).`, `Imported 1 shortcuts (kept 2 existing).`, `Imported 3 shortcuts (replaced 2 existing).`, `Import cancelled.`
