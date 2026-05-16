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
```

No dev server, test suite, or linter is configured. Load the built extension from `dist/chrome` or `dist/firefox` in the browser's extension manager.

## Architecture

**Omnibar Shortcuts** is a Manifest V3 browser extension (Chrome + Firefox) that lets users save short keywords and trigger URL redirects or tab bundles by typing them into the browser's address bar.

**Build system**: Vite + `@crxjs/vite-plugin`. The manifest is generated programmatically from `src/manifest.ts` rather than being a static JSON file. `vite.config.ts` reads the `--mode` flag (`chrome` or `firefox`) and passes it to `createManifest()` for target-specific output. Output lands in `dist/{browser}`.

**Data flow**:

1. Shortcuts are stored in `chrome.storage.local` under the single key `omnibarShortcuts` (see `storage.ts`). `local` is used instead of `sync` because `sync` has an 8 KB per-item limit that is impractical for a shortcut store.
2. On every storage change, `background.ts` calls `rebuildDynamicRules()` from `dnr.ts`, which clears all existing DNR dynamic rules and re-adds rules built from the full current store. Rule IDs are positional (`index + 1`).
3. DNR rules match omnibar searches by intercepting the search engine URL (e.g. `https://google.com/search?q=gh`) via a regex on the `q=` query parameter and redirecting to the shortcut's target URL.
4. For `bundle` shortcuts, the DNR rule redirects to the first URL. The service worker also listens on `webNavigation.onBeforeNavigate`, detects bundle keyword matches, and opens the remaining URLs as background tabs.

**Shortcut types**:
- `redirect`: single URL target, handled entirely by DNR.
- `bundle`: multiple URL targets; DNR handles the first, service worker opens the rest. Bundle creation is only in the side panel.

**Key normalization**: `normalizeKey()` in `storage.ts` lowercases, trims, collapses spaces to hyphens, and strips non-alphanumeric characters. All storage lookups use normalized keys.

**UI entry points**:
- `popup.ts` / `popup.html` — quick-save the current tab as a redirect shortcut; auto-suggests a key from the tab's hostname.
- `sidepanel.ts` / `sidepanel.html` — two-tab panel: shortcut list with delete, and a "New Bundle" form.
- `options.ts` / `options.html` — full-tab shortcut list with delete (no add form).

**Smart tip badge**: `background.ts` tracks how many times a search query has been used without a matching shortcut. After 3 uses it shows a `TIP` badge on the extension icon for that tab. Counts survive service worker restarts because they are stored in `chrome.storage.session` (persists for the browser session, cleared on browser close).

**Bundle deduplication**: `shouldHandleBundle` in `background.ts` uses `chrome.storage.session` to record the last time extra tabs were opened for each tab ID. If the same tab triggers again within 1,500 ms it skips, preventing double-opens from redundant `onBeforeNavigate` events during a DNR redirect.

## Remaining gaps

**No redirect-add form in the side panel**: To add a redirect shortcut, users must use the popup or the context menu. The side panel only supports listing/deleting shortcuts and creating bundles.

**`options.ts` and the side panel's Shortcuts tab are duplicated**: Both render the same shortcut list with delete buttons. `options.ts` also doesn't handle the `bundle` type correctly — it shows `shortcut.url` (the first bundle URL) rather than a label or URL count.

**Context menu saves silently**: The `contextMenus.onClicked` handler saves the shortcut with a green ✓ badge for 2.5 seconds, but there is no way to see or edit what key was assigned from within the context menu flow.
