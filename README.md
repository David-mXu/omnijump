# OmniJump

**Instant address-bar shortcuts for redirects, tab bundles, and dynamic searches.**

**[Website](https://david-mxu.github.io/omnijump/)**

OmniJump is a Manifest V3 browser extension for Chrome (and Firefox) that lets you save short keywords and trigger them straight from the browser's address bar — no mouse, no bookmarks toolbar, no context switching.

---

## What it does

Type a keyword you've saved → hit Enter → you're there. That's it.

- Type `gh` → jumps to `github.com`
- Type `work` → opens your entire work tab bundle at once
- Type `yt cats` → searches YouTube for "cats"

---

## Key Features

| Feature | Description |
|---|---|
| **Redirect shortcuts** | Map any keyword to any URL. One keystroke, instant navigation. |
| **Tab bundles** | Save a set of URLs under one keyword and open them all at once. |
| **Search shortcuts** | Embed `{query}` in a URL template. Typing `yt dogs` searches YouTube for "dogs". |
| **Smart tip** | Detects sites you repeatedly search and suggests saving them as shortcuts. |
| **Side panel** | Full management panel — add, edit, delete, filter, and bulk-manage shortcuts. |
| **Options page** | Full-page equivalent of the side panel, accessible from `chrome://extensions`. |
| **Export / Import** | Back up and restore all shortcuts as JSON. |
| **Live sync** | Changes sync across all your signed-in Chrome devices via `chrome.storage.sync`. |
| **Stale auto-delete** | Optionally remove shortcuts that haven't been used in N days. |
| **Keyboard navigation** | j/k to move, Enter to open, e to edit, d to delete — all without a mouse. |
| **Context menu** | Right-click any page or link to save it as a shortcut instantly. |

---

## How it works

OmniJump intercepts address-bar searches that match a saved keyword using Chrome's [declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) (DNR) API. When you type a keyword into the omnibox, Chrome issues a search query to the default search engine — OmniJump's DNR rule matches on the `q=` parameter and redirects before the request ever leaves the browser.

For tab bundles, the service worker listens on `webNavigation.onBeforeNavigate` and opens the remaining URLs as background tabs after the DNR rule handles the first one.

All shortcut data lives in `chrome.storage.sync` — one key per shortcut (`omnibar_s_{key}`) — so it syncs across devices without hitting Chrome's 8 KB per-item limit.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Language** | TypeScript 5 |
| **Build** | Vite 5 + `@crxjs/vite-plugin` |
| **Extension API** | Manifest V3 — `declarativeNetRequest`, `storage`, `webNavigation`, `sidePanel`, `tabs`, `contextMenus` |
| **Targets** | Chrome 120+ · Firefox 128+ |
| **Testing** | Vitest (unit tests, Node environment, in-memory Chrome API mocks) |
| **CI** | GitHub Actions — type-check → test on every push |

---

## Project Structure

```
src/
  manifest.ts        # Programmatic manifest, target-aware (chrome/firefox)
  background.ts      # Service worker: DNR rebuild, bundle tabs, smart tips
  dnr.ts             # Builds declarativeNetRequest rules from the shortcut store
  storage.ts         # All chrome.storage read/write helpers + migration
  suggest.ts         # Key suggestion from URLs, deduplication
  types.ts           # Shared TypeScript types
  ui.ts              # Shared buildShortcutRow() component
  popup.ts/html      # Toolbar popup: quick-save current tab
  sidepanel.ts/html  # Side panel: full shortcut management (3 tabs)
  options.ts/html    # Full-page options: identical feature set to side panel
  privacy.html       # Privacy policy page
```

---

## Development

```bash
# Install dependencies
npm install

# Build for Chrome
npm run build:chrome

# Build for Firefox
npm run build:firefox

# Type-check only
npx tsc --noEmit

# Run tests
npm test

# Watch mode
npm run test:watch
```

Load the extension from `dist/chrome` or `dist/firefox` as an unpacked extension in your browser's developer mode.

---

## Scope & Limitations

- **Storage ceiling**: Chrome sync storage caps at 512 items; OmniJump enforces a configurable limit (default 500) to stay safe.
- **Search engine dependency**: The DNR approach intercepts the default search engine's `q=` parameter. Shortcuts only fire from the address bar, not from the search engine's own search box.
- **Firefox**: The side panel uses Firefox's `sidebar_action` API. The `sidePanel` permission is Chrome-only; the Firefox build omits it.
- **Sync**: Data syncs via `chrome.storage.sync`. Offline changes sync on reconnection; conflict resolution is last-write-wins.

---

## License

[MIT](LICENSE)
