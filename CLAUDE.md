# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

No dev server is configured. Load the built extension from `dist/chrome` or `dist/firefox` in the browser's extension manager.
Ensure to commit and push changes when appropriate.

## Architecture

**OmniJump** is a Manifest V3 browser extension (Chrome + Firefox) that lets users save short keywords and trigger URL redirects or tab bundles by typing them into the browser's address bar.

**Build system**: Vite + `@crxjs/vite-plugin`. The manifest is generated programmatically from `src/manifest.ts` rather than being a static JSON file. `vite.config.ts` reads the `--mode` flag (`chrome` or `firefox`) and passes it to `createManifest()` for target-specific output. Output lands in `dist/{browser}`.

**Data flow**:

1. Shortcuts are stored in `chrome.storage.sync` as individual keys — `omnibar_s_{normalizedKey}` per shortcut, `omnibar_settings` for settings. This avoids the 8 KB per-item limit that a single-key approach would hit, while keeping cross-device sync. Practical ceiling is ~511 shortcuts (chrome.storage.sync's 512-item cap).
2. On every storage change, `background.ts` calls `rebuildDynamicRules()` from `dnr.ts`, which clears all existing DNR dynamic rules and re-adds rules built from the full current store. Rule IDs are positional (`index + 1`).
3. DNR rules match omnibar searches by intercepting the search engine URL (e.g. `https://google.com/search?q=gh`) via a regex on the `q=` query parameter and redirecting to the shortcut's target URL.
4. For `bundle` shortcuts, the DNR rule redirects to the first URL. The service worker also listens on `webNavigation.onBeforeNavigate`, detects bundle keyword matches, and opens the remaining URLs as background tabs.

**Shortcut types**:
- `redirect`: single URL target, handled entirely by DNR.
- `bundle`: multiple URL targets; DNR handles the first, service worker opens the rest.

**Key normalization**: `normalizeKey()` in `storage.ts` lowercases, trims, collapses spaces to hyphens, and strips non-alphanumeric characters. All storage lookups use normalized keys.

**UI entry points**:
- `popup.ts` / `popup.html` — quick-save the current tab as a redirect shortcut; auto-suggests a key from the hostname. Has an "Open Panel" button.
- `sidepanel.ts` / `sidepanel.html` — three-tab panel: Shortcuts, New Bundle, Settings.
- `options.ts` / `options.html` — full-page shortcut list (same feature set as the sidepanel's Shortcuts tab, shares `buildShortcutRow` from `ui.ts`).
- `ui.ts` — shared `buildShortcutRow()` used by both the sidepanel and options page. Also exports `normalizeUrl()` (prepends `https://` if no protocol given).

**Shortcut lifecycle**:
- `createdAt` is set on first save, preserved on updates.
- `lastUsed` is updated via `touchShortcut()` in `storage.ts` each time a shortcut is activated via the omnibar (detected in `handleShortcutTouch` in `background.ts`).
- `cleanupStaleShortcuts()` runs on `onInstalled` and `onStartup`. Shortcuts with `lastUsed` older than `staleDays` are deleted. Shortcuts with no `lastUsed` (brand new) get a grace period: their `lastUsed` is set to `Date.now()` rather than being immediately deleted.

**Side panel features**:
- **Filter bar**: hidden until the shortcut count reaches `filterThreshold` (default 25, configurable in Settings). Searches key, URL, and label in real time.
- **Multi-select bulk delete**: "Select" button enters select mode; clicking a row or its checkbox toggles it. "Delete (N)" button appears when at least one is selected.
- **Live sync**: `chrome.storage.onChanged` listener re-renders the list whenever any `omnibar_s_` or `omnibar_settings` key changes, so edits from another device appear immediately.
- **Add redirect form**: keyword + URL inputs with Enter key navigation (Enter in keyword → focus URL; Enter in URL → submit). Auto-focuses on panel open.
- **TIP suggestion banner**: the background tracks how many times the user searches a site (per-tab sessions, finalized on host change or tab close). After 3 visits it stores a `Suggestion` in `chrome.storage.session`. The panel reads this on open and shows a dismissable banner: "You often search {Site}. Save '{key}' as a shortcut?" — pre-filling the redirect form. The background detects multiple search params (`q`, `query`, `search_query`, `s`, etc.) to cover more search engines.

**Bundle panel features**:
- "Add all open tabs" fills the URL list with all HTTP tabs in the current window.
- Tab picker: shows tabs with favicons and checkboxes, then inserts the selected URLs.
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
| `src/storage.test.ts` | `getStore`, `upsertShortcut`, `deleteShortcut`, `saveSettings`, `migrateFromLegacyStorage` |
| `src/dnr.test.ts` | `rebuildDynamicRules`, rule IDs, DNR regex correctness |

CI runs on every push via `.github/workflows/ci.yml`: `npm ci` → `tsc --noEmit` → `npm test`.

## Known issues / remaining gaps

None currently known.
