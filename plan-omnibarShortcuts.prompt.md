## Plan: Omnibar Shortcuts roadmap

Draft plan to turn the current popup-only extension into a full MV3 omnibar shortcut engine. I'll start by aligning manifest/background architecture, then define storage and matching logic, then layer UI and context menus, and finally add bundles and smart suggestions. This keeps core interception stable before building UX polish.

### Steps 4
1. Audit existing manifests and popup behavior in [manifest.json](manifest.json), [manifest.firefox.json](manifest.firefox.json), [popup.html](popup.html), and [src/popup.ts](src/popup.ts) to align MV3 vs MV2 expectations and define background/service worker entrypoints.
2. Design the data schema in `chrome.storage.sync` (keywords, targets, bundle sets, dynamic `%s` templates) and the matching algorithm used by the interception engine.
3. Plan the interception flow using `chrome.webNavigation` or `declarativeNetRequest`, defining exact URL patterns to intercept and redirect without search fallback.
4. Outline UI and context menu workflows: popup creation flow, auto-suggestion, right-click saves, export/import, and bundle editor.

### Further Considerations 2
1. Confirm primary browser target:  Chrome + Firefox support with separate manifest
2. use interception mechanism `declarativeNetRequest` (faster but more rigid).
