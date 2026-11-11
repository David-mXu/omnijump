# 2026-11-11 — Edge cold-start redirect: `chrome.storage.session` mirroring + event pre-warming

## Problem

In Microsoft Edge, extension `declarativeNetRequest` (`DNR`) `redirect` rules are intentionally suppressed by Edge's C++ network layer whenever the request targets the user's configured **Default Search Engine** origin (`edge://settings/search`). To work around this, [`src/background.ts`](../../src/background.ts) intercepts search-engine navigations inside `webNavigation.onBeforeNavigate` (`T = 0 ms`) and redirects via `chrome.tabs.update()` using an in-memory `cachedStore` (documented in [`2026-11-05-agent-sweep-dnr-security-ui-tests.md`](./2026-11-05-agent-sweep-dnr-security-ui-tests.md)).

When the background service worker was already warm, that pre-network redirect beat the search engine round-trip cleanly. However, **after ~30 seconds of inactivity, Chromium terminates Manifest V3 service workers**:

1. Every time a user typed a saved keyword after >30 seconds idle, Edge began sending the search HTTP request in parallel while waking `background.ts` from scratch.
2. On cold wake, `cachedStore` was `null`, forcing `getFastStore()` to await `chrome.storage.sync.get(null)` (~30–80 ms IPC + parsing) on top of V8 worker startup (~50–100 ms).
3. Combined with Edge's speculative address-bar search preloading, that cold-start window was long enough for Bing or Google search results to visibly render before redirecting.

## Root cause & underlying concepts

- **MV3 ephemeral worker memory vs. browser-session RAM**: Module-level variables (`cachedStore`) live inside the extension service worker's V8 isolate and vanish whenever the worker goes idle. By contrast, `chrome.storage.session` lives in the browser process's RAM for the entire browser session (~10 MB quota, zero per-minute write rate limit, ~1 ms IPC) and survives service worker terminations.
- **User navigation cadence**: Almost every address-bar shortcut jump happens right after opening a new tab (`Ctrl+T` → `tabs.onCreated`), switching tabs (`tabs.onActivated`), or focusing a browser window (`windows.onFocusChanged`) — typically 500–1,500 ms *before* the user finishes typing a keyword and presses `Enter`. Without top-level listeners on those events, the worker stayed asleep until `Enter` was pressed.
- **Multi-context cache coherence**: In MV3, extension UI surfaces (`popup.html`, `sidepanel.html`, `options.html`) can write to `chrome.storage.sync` while the background service worker is terminated. Relying solely on the service worker's `chrome.storage.onChanged` listener risks serving a pre-edit `chrome.storage.session` snapshot on the next wake if the write surface itself did not update the session mirror.

## Investigation and implementation, in order

### 1. Mapping every `chrome.storage.sync` write boundary
- **Evidence**: Auditing all 34 `chrome.storage` call sites across `src/` showed that every shortcut/settings mutation flowed through [`src/storage.ts`](../../src/storage.ts) except one batched JSON import write (`chrome.storage.sync.set(chosenWrites)`) in `finishImport` inside [`src/panel-controller.ts`](../../src/panel-controller.ts).
- **Choice**: Extracted `bulkWriteShortcuts()` in [`src/storage.ts`](../../src/storage.ts) and routed `panel-controller.ts` through it so `src/storage.ts` serves as the single write choke point.

### 2. Per-key `chrome.storage.session` mirror instead of a monolithic blob
- **Evidence**: Storing the entire `ShortcutStore` under one `omnibar_store_cache` session key would require every mutation to read-modify-write the whole blob, risking lost updates when two writes (e.g., rapid saves or popup + background context menu) overlap. Worse, full-snapshot purges computed from pre-write snapshots can delete concurrently saved keys.
- **Implementation ([`src/storage.ts`](../../src/storage.ts))**:
  - Mirrored `chrome.storage.sync`'s exact per-key layout (`omnibar_s_{key}` + `omnibar_settings`) in `chrome.storage.session`, gated by a versioned sentinel key `omnibar_store_meta: { v: 1 }` (`SESSION_STORE_META_KEY`).
  - Extracted a single shared parser, `parseStoreFromRecords()`, used by both `getStore()` (`sync`) and `readSessionStore()` (`session`) so every record passes through `coerceStoredShortcut()` (clamping timestamps and coercing malformed fields) regardless of tier, while ignoring unrelated session keys (`bundleTriggers`, `tabActiveSessions`, `searchVisitCounts`, `suggestion_*`).
  - Added serialized `mirrorSessionDelta(changes, { hydrateIfMissing })` write-through calls across `upsertShortcut`, `saveSettings`, `migrateFromLegacyStorage`, `deleteShortcut`, `deleteShortcuts`, `bulkWriteShortcuts`, `restoreShortcuts`, `touchShortcut`, `renameShortcut`, `clearAllStats`, `cleanupStaleShortcuts`, and `seedStarterShortcuts`. When the sentinel is already present, each mutator applies only its own idempotent key `set`/`remove` delta without purging sibling keys.

### 3. 3-tier `getFastStore()` with generation fencing & event pre-warming
- **Implementation ([`src/background.ts`](../../src/background.ts))**:
  - Upgraded `getFastStore()` to resolve across three tiers coalesced by `storeLoadPromise`:
    1. **Tier 1 (`cachedStore`)**: in-memory object (`0 ms`).
    2. **Tier 2 (`readSessionStore()`)**: browser-RAM `chrome.storage.session` mirror (`~1 ms` after worker idle termination).
    3. **Tier 3 (`getStore()`)**: `chrome.storage.sync.get(null)`, hydrating Tier 1 and Tier 2 on browser launch.
  - Added a monotonic `storeGeneration` counter bumped on `invalidateStoreCache()` and on `chrome.storage.onChanged` (`area === 'sync'`) before patching `cachedStore` and forwarding deltas to `mirrorSessionDelta(changes)` (even when `cachedStore === null`, so cross-device deletes arriving on a cold worker still purge the session mirror). Any in-flight Tier 2/3 read whose captured generation no longer matches discards its stale snapshot and retries.
  - Serialized `runtime.onStartup` and `runtime.onInstalled` via `enqueueBootTask`, invalidating both memory and session caches before and after migrations/starter seeding so pre-migration snapshots cannot poison the mirror.
  - Added top-level `warmStore()` listeners on `chrome.tabs.onCreated`, `chrome.tabs.onActivated`, and `chrome.windows.onFocusChanged` (ignoring `WINDOW_ID_NONE = -1` on window blur) across all browsers — requiring zero new manifest permissions while waking the worker and priming Tier 1 *before* the user finishes typing.
  - Replaced bracket lookups (`store.shortcuts[key]`) with prototype-safe `findShortcut()` (`Object.prototype.hasOwnProperty.call`) so searches like `?q=constructor` or `?q=toString` never match `Object.prototype` properties.

## Alternatives considered

- **Persisting the cache in `chrome.storage.local`**: `storage.local` survives full browser restarts, whereas `storage.session` clears on browser close (meaning the very first wake per browser session still reads `storage.sync` once, masked by `onStartup` / tab pre-warming). However, `storage.local` is disk-backed (SQLite/LevelDB I/O) rather than pure RAM and creates a persistent second copy on disk that can drift across crashes. `storage.session` gives pure-RAM latency and automatic cleanup on browser exit.
- **Timer/alarm keep-alives**: Keeping the MV3 service worker permanently awake via periodic ports or alarms wastes idle memory and risks store review pushback. Event-driven pre-warming on tab creation, tab switch, and window focus aligns directly with moments preceding address-bar input with zero background timers.
- **Edge DNR `block` + JS redirect**: Edge honors DNR `block` rules on the default search engine even though it ignores DNR `redirect`. Blocking exact shortcut queries in DNR would prevent any search request from leaving the browser even on a stone-cold worker, at the tradeoff of potentially flashing an `ERR_BLOCKED_BY_CLIENT` frame during cold wakeups and altering non-default search engine behavior. Left as an optional future enhancement if cold-start network suppression is ever needed beyond pre-warming.

## Verification

All checks were executed and observed directly:

- **TypeScript type-checking**: `npx tsc --noEmit` → **0 errors**.
- **Automated test suite**: `npm test` (`vitest run`) → **10 test suites passed, 234 tests passed** (up from 220):
  - [`src/test/chrome-mock.ts`](../../src/test/chrome-mock.ts): added `tabs.onCreated`, `windows.onFocusChanged`, `windows.WINDOW_ID_NONE = -1`, and `resetListeners()` for realistic MV3 service worker restart simulation.
  - [`src/storage.test.ts`](../../src/storage.test.ts): verified sentinel validation, full snapshot writes & ghost-key purging, write-through coherence across all mutators, concurrent `Promise.all([upsertShortcut, upsertShortcut])` race safety, unhydrated partial-delta safety, and graceful degradation when `storage.session` throws quota errors or is absent.
  - [`src/background.test.ts`](../../src/background.test.ts): verified cold-restarted Edge `onBeforeNavigate` redirects with zero full `sync.get(null)` reads (even when `storage.sync.get` hangs indefinitely), Tier 1 memory pre-warming on `tabs.onCreated` / `tabs.onActivated` / `windows.onFocusChanged`, `WINDOW_ID_NONE` ignore, cold cross-device delete propagation, mid-flight `onChanged` generation invalidation, and `Object.prototype` (`constructor`/`toString`) lookup immunity.
- **Multi-target production builds**: `npm run build:all` → built both `dist/chrome` and `dist/firefox` cleanly with zero warnings or errors.

## Files touched

- [`src/storage.ts`](../../src/storage.ts) — shared `parseStoreFromRecords()`, per-key `chrome.storage.session` mirror helpers (`readSessionStore`, `writeSessionStore`, `mirrorSessionDelta`, `clearSessionStore`), `bulkWriteShortcuts()`, and write-through hooks across all mutators.
- [`src/background.ts`](../../src/background.ts) — 3-tier `getFastStore()` with `storeGeneration` epoch guard, `bootQueue` lifecycle serialization, cold `onChanged` session delta forwarding, prototype-safe `findShortcut()`, and `tabs.onCreated` / `tabs.onActivated` / `windows.onFocusChanged` pre-warming.
- [`src/panel-controller.ts`](../../src/panel-controller.ts) — routed batched JSON import writes through `bulkWriteShortcuts()`.
- [`src/test/chrome-mock.ts`](../../src/test/chrome-mock.ts) — added `tabs.onCreated`, `windows.onFocusChanged`, `WINDOW_ID_NONE`, and `resetListeners()`.
- [`src/storage.test.ts`](../../src/storage.test.ts) & [`src/background.test.ts`](../../src/background.test.ts) — 14 new unit and concurrency tests covering cold worker restarts, pre-warming, epoch races, and mirror coherence.
- [`AGENTS.md`](../../AGENTS.md), [`CLAUDE.md`](../../CLAUDE.md), [`README.md`](../../README.md) — updated Edge redirect architecture and test table documentation.
