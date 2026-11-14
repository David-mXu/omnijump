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

## Independent verification found real regressions (fixed)

Three fresh verifier agents reviewed commit `9ec5d2b` and returned **fail**. The
useful lesson is that lowering a limit in storage requires every other layer to
agree about which records are grandfathered. Fixed in the follow-up commit:

1. **Undo lost legacy records (high).** `restoreShortcuts` sanitized with the
   legacy allowance, then handed the records to `bulkWriteShortcuts`, which
   re-validated strictly and threw. A single 41–64-character key made a whole
   bulk undo restore nothing. `bulkWriteShortcuts` now accepts limit options,
   restore passes the legacy allowance, and a rejected batch is reported as
   `invalid` instead of throwing (no unhandled rejection in the Undo toast).
   Legacy over-cap bundles/labels also restore again, and `RestoreResult` now
   separates `skipped` (keyword in use) from `invalid` (unusable record).
2. **Read-time URL normalization disabled intranet shortcuts (medium).**
   `coerceStoredShortcut` used `normalizeUrl`, which rejects single-label hosts
   (`http://router/`) that the context-menu save path legitimately stores. The
   read path now only enforces the http(s) scheme and strips control
   characters; `urlTemplate` still goes through `normalizeUrl` to block
   authority placeholders.
3. **Legacy keys could not be edited (medium).** The inline editor and bundle
   form applied the new 40/28 caps to an *unchanged* legacy key, so a 1.2.5
   record could not have its label or URL changed. Both now allow up to 64 when
   the key is unchanged, mirroring `upsertShortcut`.
4. **Deferred render never replayed on Cancel (low).** `refresh()` skips
   rendering while an inline editor is open; `cancelRowEdit` now invokes the
   host render after Escape/Cancel, so live-sync changes are no longer stale.
5. **Picker focus steal (low).** `setPickerState` only returns focus when it
   actually closes an open panel, not when hiding an already-hidden sibling.

A second, focused re-check of the delta caught two more issues, fixed before
committing the follow-up:

6. **Add-alias focus race (new).** Replaying the deferred render in
   `cancelRowEdit` also restored focus to the rebuilt row, overriding
   `handleAlias`, which synchronously focuses the keyword input. Typing after
   Add alias would then be handled by the list's j/k/e/d shortcuts (two `d`
   presses could delete). Focus restoration is now opt-in: Escape and the
   Cancel button request it; the Add-alias path does not.
7. **Intranet undo/edit gap (residual).** Undo and inline editing still ran
   URLs through `normalizeUrl`, so `http://router/admin` could be read but not
   restored or edited. A shared `sanitizeStoredUrl()` keeps explicit http(s)
   URLs with single-label hosts and only rejects unsafe schemes; it is used by
   read coercion, restore sanitization, bundle items, and the inline redirect
   editor. Schemeless form input still goes through `normalizeUrl`.

The verifier also flagged missing tests and stale docs. Added: max-length
regex-size coverage, skipped-key session persistence, settings dirty-field
protection, stat-only row patching, single-label URL reads, legacy bulk undo,
legacy inline edits, and intranet undo. The Settings hint now says ~140
redirect / ~70 search shortcuts instead of a flat 142.

One residual is accepted: a legacy bundle with more than 32 URLs can be
restored verbatim, but saving it again through the bundle form requires
removing URLs down to the current cap.

One deliberate difference from a verifier probe: a direct
`bulkWriteShortcuts()` call still rejects a legacy key by default. Import must
stay strict, and import reaches this writer only after `sanitizeShortcut`;
undo is the one caller that opts into the legacy allowance.

## Verification

- `npx tsc --noEmit` — clean.
- `npm test` — **264/264 passing in 11 files** (was 234/234). New coverage:
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
