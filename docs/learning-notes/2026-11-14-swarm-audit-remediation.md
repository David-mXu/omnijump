# Swarm audit remediation — 2026-11-14

## Why this work exists

A 13-agent Claude Code swarm audited OmniJump at commit `c8561f3` (v1.2.5) for
security, correctness, performance, accessibility, and release safety. Its
report is checked in as
[`security/swarm-audit-2026-11-14.md`](../../security/swarm-audit-2026-11-14.md).
The swarm produced 22 deduplicated findings (2 high, 8 medium, 12 low). This
change fixes them in dependency order, adds regression tests, and records the
parts left deliberately partial.

The key lens for an MV3 extension is **where state is written**. A rule can be
correct in a unit test and still fail in the product because three contexts —
the service worker, extension pages, and cross-device sync — each have a
different lifetime and can interleave. Most fixes below move validation and
ordering to a shared write boundary rather than patching individual forms.

## High-severity fixes

### Firefox AMO never uploaded a source archive (F1)

AMO requires a source archive for bundled/minified extensions. The automated
workflow ran `web-ext sign` with no `--upload-source-code`, so the automated
path could not reproduce the manual 1.2.4 submission. The workflow now zips the
rebuild inputs (`src`, `scripts`, `images`, lockfile, configs, and the new
[`BUILD.md`](../../BUILD.md)), passes the archive, and uses
`--approval-timeout=0` so the job submits instead of blocking on the default
15-minute review window. `src/release.test.ts` locks the flags and BUILD.md in
place.

### Import settings bypassed the overwrite confirmation (F2)

The importer wrote the file's settings **before** taking its collision
snapshot. On a first-ever settings write, the background's change listener saw
`oldValue === undefined`, treated it as a change, and ran stale cleanup. That
cleanup could delete the stale colliding record, so the later snapshot saw no
collision and silently overwrote it. Two ordering bugs compound:

1. `saveSettings()`/`importDailyCounts()` ran before the user chose
   Overwrite / Skip / Cancel.
2. `background.ts` compared `undefined` settings against the new object instead
   of the defaults.

The fix parses settings into `pendingSettings`, commits them only inside
`finishImport()`, and compares a missing old value against `DEFAULT_SETTINGS`.
Cancel is now a true no-op. The collision preview also uses
`describeTarget()`, so parameterized templates and bundle hosts are shown
instead of only the fallback `url`.

## Medium-severity fixes

- **Write-boundary caps (F3, F8).** `upsertShortcut`, `renameShortcut`, and
  `bulkWriteShortcuts` now call `assertShortcutWithinLimits`, and
  `sanitizeShortcut` rejects rather than truncates over-cap input. Limits cover
  key (40 / 28 parameterized), label, URL, bundle count, and a measured
  `MAX_SYNC_ITEM_BYTES` budget under Chrome Sync's 8 KB per-item cap. Quota
  errors now distinguish "this record is too large" from total storage quota.
  `restoreShortcuts` returns `{ restored, skipped }`, so Undo reports partial
  failures instead of claiming success.
- **Suggestion Save overwrite (F4).** Both popup and side panel suggestion
  handlers now use the same `hasShortcutTargetCollision` +
  `renderOverwriteConfirm` path as the forms, offering Overwrite or a free
  alternative key; the banner stays visible until the user chooses.
- **RE2 key budget (F5).** The audit measured per-engine maxima: 40 characters
  for redirects and 28 for parameterized keys. `MAX_KEY_LENGTH` and the new
  `MAX_PARAMETERIZED_KEY_LENGTH` encode those measurements. Legacy records
  longer than the new cap can still be edited and restored
  (`allowLegacyKeyLength`) so upgrades do not strand data.
- **Regex-rule quota (F6).** `buildRules()` orders shortcuts by `useCount`,
  then `lastUsed`, then storage order, so active keys win the ~142-key budget.
  Keys whose rules Chrome rejects are recorded in `chrome.storage.session`
  (`omnibar_dnr_skipped`) and surfaced as a count tooltip and a Settings hint.
- **List performance (F7).** Filter input is debounced only once the list is
  large; `useCount`/`lastUsed`-only storage changes patch the affected row in
  place instead of rebuilding every row.
- **Settings edit loss (F9).** Each Settings control is marked dirty on
  input/change, and `renderSettings()` skips dirty fields, so a background
  usage write cannot revert values the user is typing.
- **Startpage `?query=` (F10).** `SearchEngine` now carries `queryParams`;
  Startpage matches `q=` and `query=` and the `do/dsearch` path, and
  `extractQuery()` recognizes the documented parameter.

## Low-severity fixes

- `%s` in a path/fragment no longer produces a DNR capture rule (F11). DNR
  substitutes the engine's raw `+`-encoded query, which is wrong outside the
  query string; those templates now use the JS fallback, which
  `encodeURIComponent`s. Live check: `?q=wpath+new+york` produced
  `/wiki/new%20york`.
- `isSafeRedirectUrl` and `normalizeUrl` reject `%s` in the authority (host,
  username, password), and stored templates are re-normalized on read (F12).
- Shortcut writes are serialized through a promise queue, with a cross-context
  `navigator.locks` gate in real extension contexts (F13). A concurrent-create
  test at `maxShortcuts = 1` now leaves exactly one record.
- Delete-undo skips keys re-created during the toast window and reports the
  skip (F14).
- Bulk selection lives in a `Set` and is re-applied after re-renders, so the
  "Delete (N)" button cannot go stale (F15). Live-sync refresh no longer
  cancels a pending delete, and it defers list rendering while an inline editor
  is open (F16).
- Import enforces `maxShortcuts` and reports skipped entries (F17), and uses
  own-property checks so `constructor` is not a phantom collision (F18).
- Tabs implement the ARIA pattern: roving `tabindex`, ArrowLeft/Right/Home/End,
  and the list j/k handler ignores tab targets (F19).
- Light-mode success text and the search badge use emerald-700 (≥4.5:1) (F20);
  the count, no-results, suggestion banner, and pickers have live/disclosure
  semantics (F21); bundle URLs can be reordered with Alt+ArrowUp/Down (F22).

## Deliberately partial or deferred

- **No virtualization/keyed row cache.** Large-list work is limited to
  debouncing and stat-only patching. A full keyed/virtualized list is a larger
  redesign; noted here rather than risking a late structural change.
- **DNR capacity is mitigated, not eliminated.** Keys are capped to measured
  safe lengths and usage-ordered, but the UI does not hard-clamp
  `maxShortcuts` to 142, and rules are still built with host alternation rather
  than `condition.requestDomains`.
- **Cross-tab write races are best-effort.** The promise queue fixes one
  context; `navigator.locks` covers cooperating extension contexts, but two
  independent sync clients can still interleave.
- **Session-tier cold-start race** (`loadStoreFromTiers` retry caching a
  pre-mirror snapshot) from the earlier interrupted run is unchanged; it needs
  a serialization barrier and its own in-flight test.
- **Firefox-mode service-worker paths** are still only covered by manual
  validation (no `MODE=firefox` background test).

## Verification

- `npx tsc --noEmit` — clean.
- `npm test` — **255/255 passing in 11 files** (was 234/234). New coverage:
  settings coercion, every write cap, per-item byte budget, undo skip/report,
  concurrent creates, Startpage `query=`/`do/dsearch`, path-template fallback,
  quota priority, popup/panel suggestion overwrite, import settings consent,
  import cap, settings-cleanup trigger, and the Firefox release workflow.
- `npm run build:all` — both targets built.
- Live Playwright against the rebuilt extension:
  - redirect, parameterized search, and bundle extras still work;
  - `https://www.startpage.com/sp/search?query=<key>` redirects;
  - Startpage `?query=<key>+cats` substitutes `cats` into the target;
  - a path template emits no capture rule and the JS fallback produced
    `/wiki/new%20york` (correct percent-encoding, no `+`).

## Commands used

```bash
npx tsc --noEmit
npm test
npm run build:all
node <job-tmp>/oj-audit/smoke-harness.cjs
node <job-tmp>/oj-audit/live-regressions.cjs
```
