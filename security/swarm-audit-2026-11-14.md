# OmniJump Audit Report — 2026-11-14

**Repository:** `/home/davidxu/Programming/Extensions/OmniJump`
**Commit audited:** `c8561f3` (`feat(edge): pre-warm MV3 service worker and mirror store in storage.session`), working tree clean
**Extension version:** `1.2.5`
**Report status:** final (continuation of the prior swarm audit)

## Baseline re-verified in this continuation

| Check | Result |
|---|---|
| `git status --porcelain` | clean |
| `git rev-parse --short HEAD` | `c8561f3` |
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 234 / 234 passed in 10 files (Vitest 4.1.12, ~0.8 s) |
| `dist/chrome` | built from HEAD; previously proven live for DNR redirect, parameterized search, and bundle extras |
| `dist/firefox` | built from HEAD; used for `web-ext lint` evidence in F1 |

No repository files were modified while producing this report. All reports, probes, and artifacts live under
`/home/davidxu/.claude-brayden-deepseek/jobs/b595c2b1/tmp/oj-audit/`.

## Inputs and deduplication

The audit pipeline supplied **30 confirmed finding entries** with **69 verifier verdicts**
(68 confirmations and 1 refutation of a single premise). Several entries described the same
root defect from different flows (static audit, live popup, live sidepanel, code-path lens).
This report deduplicates them into **22 distinct findings**.

Counting rule used below: a finding is **distinct** if fixing it requires a different code change
or a different test. Near-duplicates are merged and the input slugs are listed in
[Appendix A](#appendix-a--deduplication-map). Verdict-severity dissent is preserved in each
finding so readers can see when a verifier rated a defect lower than the finder did.

**Severity summary**

| Severity | Count | Findings |
|---|---:|---|
| High | 2 | F1 Firefox release, F2 import overwrite |
| Medium | 8 | F3 write-boundary caps, F4 suggestion overwrite, F5 RE2 key budget, F6 regex quota, F7 list jank, F8 bundle item quota, F9 settings overwrite, F10 Startpage |
| Low | 12 | F11–F22 |
| **Total** | **22** | |

**Known-findings file:** the task referenced
`/home/davidxu/.claude-brayden-deepseek/jobs/b595c2b1/tmp/oj-audit/known-findings.txt`, but that file
**does not exist** in the workspace. Prior-audit separation therefore relies on the explicit
`alreadyKnown` flags in the inputs plus named remediation history (H1, L2, known #10, open question #2).
This is recorded again as a coverage gap.

---

## High severity

### F1. Firefox AMO auto-publish never uploads the source archive AMO requires for the minified build

- **Severity:** High — release-blocking (verifier severities: high, medium, medium)
- **Category:** release
- **Status:** NEW
- **Primary location:** `.github/workflows/publish-firefox.yml:53` (`web-ext sign`, lines 45–56)

**Observed behavior.** The Firefox publish job builds `dist/firefox` with Vite/esbuild minification and
submits it with:

```yaml
npx web-ext sign \
  --channel=listed \
  --source-dir=dist/firefox \
  --artifacts-dir=web-ext-artifacts
```

There is no `--upload-source-code`, no `.web-ext-config*`, and no `BUILD.md`. `web-ext lint` on the
HEAD-built package reports **11 `metadata.unknownMinifiedFiles`** (for example
`assets/background.ts-*.js` at one line / ~13.5 KB with mangled identifiers). The repository's own
history documents that 1.2.4 was submitted **with** a source archive because reviewers require it
for minified builds (`docs/publishing.md:99-100`;
`docs/learning-notes/2026-11-05-store-auto-publish-setup.md:79-81`). The pending `firefox/v1.2.5`
run (`42280684760`) has the test job green and the publish job waiting on the `firefox-addons`
environment, so the defect is live but not yet exercised end-to-end.

**Root cause.** The automated path never replicated the manual source-submission step. Two
compounding issues:

1. `web-ext` 10.8.0 supports `--upload-source-code` (help line 22) but the workflow never passes it.
2. The default approval wait is `900000 ms` and `sign.js` falls back to `--timeout` when
   `--approval-timeout` is absent, so the job blocks only 15 minutes on human review before failing.

**Minimal fix direction.**

1. Add a `Package source archive` step before submission that zips the rebuild inputs:
   `src/`, `scripts/`, `images/`, `package.json`, `package-lock.json`, `tsconfig.json`,
   `vite.config.ts`, and a new root `BUILD.md`.
2. `BUILD.md` must state the environment and exact commands (`node 24`, `npm ci`,
   `npm run build:firefox`), note that Vite/@crxjs is a module bundler producing `dist/firefox`,
   and state that `package-lock.json` is required for reproducibility.
3. Pass `--upload-source-code=firefox-source.zip`.
4. Pass `--approval-timeout=0` (submit and return, log the version edit URL) so the job does not
   fail on review latency.
5. Update `docs/publishing.md` so the manual source step is described as a requirement the
   automation now replicates.

**Regression test.** A CI/unit check that parses the workflow and asserts it contains
`--upload-source-code` and `--approval-timeout`, plus a release dry run on an unlisted channel.

**Decisive evidence.**

- `grep -rn upload-source-code .github/` → no match; `find . -name BUILD.md` → none.
- `npx web-ext --version` → `10.8.0`; `npx web-ext sign --help` prints the flag.
- `npx web-ext lint --source-dir=dist/firefox --output=json` → 11 unknown minified files.
- Workflow lines 45–56 reproduced above; docs lines reproduced above.
- Input runs: `gh run view 42280684760 --json status,conclusion,headSha,jobs`.

---

### F2. Import with a settings object silently overwrites a colliding shortcut (regression of the H1 overwrite guard)

- **Severity:** High — security / import trust (verifier severities: high, medium, medium, medium)
- **Category:** security / import trust
- **Status:** NEW regression of the prior H1 remediation
- **Primary locations:** `src/panel-controller.ts:966` (settings write), `:1055-1058` (collision snapshot),
  `:1108` (unconditional finish), `src/background.ts:486-492` (cleanup trigger)

**Observed behavior.** On a clean profile with an existing `omnibar_s_mail = https://mail.google.com`,
importing:

```json
{ "version": 1,
  "shortcuts": [{ "key": "mail", "url": "https://evil.example/" }],
  "settings": { "maxShortcuts": 500, "filterThreshold": 10, "darkMode": false } }
```

produces the status `Imported 1 shortcuts.`, **zero** prompt buttons, and leaves
`omnibar_s_mail.url = https://evil.example/`. The identical file with `settings: {}` renders
`1 imported keyword would replace existing ones: "mail" → evil.example. Overwrite all · Skip existing · Cancel`,
and Cancel leaves mail intact. A single recognized preference (`darkMode: true` alone) is enough;
behavioral-only settings (`smartSuggestions`, `staleAutoDelete`, `staleDays`) are ignored and do not
trigger it. Reproduction was 7/7 in the finder's runs; an independent verifier reproduced 5/5 when the
existing record is stale and no `omnibar_settings` key exists yet.

**Root cause (corrected by independent verifiers).** The finder's stated mechanism
("`saveSettings` makes the later `getStore()` return a partial store") was **not** reproduced by
multiple verifiers. The confirmed mechanism is a cleanup race plus write ordering:

1. The import handler writes the file's settings at `panel-controller.ts:966`, **before** taking the
   collision snapshot at `:1055`.
2. On the first-ever settings write, `background.ts:486-492` sees
   `oldSettings?.staleAutoDelete !== newSettings?.staleAutoDelete` with `oldSettings === undefined`
   and spuriously calls `cleanupStaleShortcuts()`.
3. That cleanup deletes the stale colliding record (for example `createdAt` > 90 days), so the later
   `getStore()` diff no longer sees a collision. The import then writes the attacker URL with no
   confirmation.
4. Independently of the race, `saveSettings()` and `importDailyCounts()` commit before the user
   chooses Overwrite / Skip / Cancel, so Cancel is **not** a true no-op on platforms where the prompt
   does appear.

The same ordering is why a first settings save (including a dark-mode toggle) can silently delete
stale shortcuts: `oldValue === undefined` is treated as a settings change.

**Minimal fix direction.**

1. Take the collision snapshot **once at handler entry**, before any write:
   `const snapshot = await getStore();` and diff imported keys against `snapshot.shortcuts`.
2. Move `saveSettings(...)` and `importDailyCounts()` into `finishImport()` so they execute only after
   the user resolves collisions. Apply settings only for Overwrite all / Skip existing; Cancel writes
   nothing.
3. Fix `background.ts:486-492`: when `oldValue` is `undefined`, compare against
   `DEFAULT_SETTINGS` (or only run cleanup when both values exist and actually differ).
4. Keep settings sanitization where it is; only defer the commit.

**Regression tests.**

- Import a payload containing both a colliding key and one recognized setting → prompt must render.
- Cancel → both the existing record and settings remain byte-identical.
- First settings write alone (dark-mode toggle) → must not delete a stale shortcut.
- Import a colliding key when the existing record is stale → must still prompt.

**Decisive evidence.**

- `panel-controller.ts:966` write precedes `:1055-1058` snapshot; `:1108` unconditional
  `finishImport(writes, 0, 0)`.
- `background.ts:486-492` undefined-`oldValue` comparison.
- `verify/C7-0/impact/repeat.cjs` (5/5 prompt=false with stale record), `results2.json`,
  `verify/C7-0/reproduce/probe.cjs`, `stale-cause.cjs`, `cleanup-proof.cjs`,
  `verify/C7-0/impact/probe3.cjs` (change stream: settings write → stale mail removed → evil mail written).
- `git status` clean before/after; `npx tsc --noEmit` clean; `npm test` 234/234.

---

## Medium severity

### F3. Interactive writers bypass `MAX_URL_LENGTH` / `MAX_LABEL_LENGTH` / `MAX_BUNDLE_URLS`; Undo and export→import then silently drop or truncate the saved record

- **Severity:** Medium — data integrity (verifier severities: medium, medium, low, low, low)
- **Category:** correctness / data integrity
- **Status:** NEW (the bundle-over-cap-undo-truncation variant was previously known and is broadened here)
- **Primary locations:** `src/storage.ts:390-418` (`upsertShortcut`), `:589` (`renameShortcut`),
  `:517-523` (`bulkWriteShortcuts`), `:530-540` (`restoreShortcuts`), `:207` / `:161` / `:176-178`
  (`sanitizeShortcut` caps); `src/panel-controller.ts:386`, `:731-733`; `src/ui.ts:303`;
  `src/popup.ts:168`, `:186-194`; `src/types.ts:65-71`

**Observed behavior.** Every interactive surface accepts over-cap values and persists them, while the
undo/import validator later rejects or truncates the same record:

| Input | Stored | Delete + Undo | Export → import |
|---|---|---|---|
| 3,031-char redirect URL (cap 2,048) | yes | record silently absent | `failed — missing or too-long URL` |
| 500-char label (cap 256) | yes | restored truncated to 256 | truncated |
| 40-URL bundle (cap 32) | yes | restored with 32 | truncated |
| 2,994-char search `urlTemplate` (cap 2,048) | yes | record silently absent | rejected |
| 65-char "Save as" alt key (cap 64) | yes | record silently absent | rejected |
| 9,020-char popup URL | no | — | misleading `Storage quota exceeded. Delete some shortcuts to free up space.` |

`types.ts:65-68` explicitly claims these limits are "shared by every write surface (forms, import,
popup, editor)". No shipped HTML input has a `maxlength` attribute.

**Root cause.** The caps live only in `sanitizeShortcut`, which is applied on import, restore, and
migration — not on interactive writes. `upsertShortcut` and `renameShortcut` validate only emptiness,
`maxShortcuts`, and collisions, then `chrome.storage.sync.set` the record verbatim. `normalizeUrl`
(`src/url.ts:4-39`) has no length cap. `uniqueKey` appends digits without re-checking `MAX_KEY_LENGTH`.
`restoreShortcuts` filters failed records and returns nothing, so the toast implies success.

**Minimal fix direction.**

1. Export a shared `validateShortcutLimits(s)` (or reuse `sanitizeShortcut` and compare) and call it
   at the top of `upsertShortcut`, `renameShortcut`, and `bulkWriteShortcuts`.
2. Reject with actionable messages: URL/template > 2048, label > 256, bundle count > 32, each bundle
   item > 2048, key > 64.
3. Make `restoreShortcuts` return `{ restored, skipped }` and have `showUndoToast` report partial
   failure instead of claiming success.
4. Add `maxlength` attributes and pre-submit checks in the forms/popup/inline editor.
5. Distinguish `QUOTA_BYTES_PER_ITEM` from total quota in the catch block (see also F8).

**Regression tests.** Boundary tests per field on `upsertShortcut` / `renameShortcut` / import /
restore; popup 3,020- and 9,020-char URLs; 65-char alt key; 33-URL bundle; assert undo is lossless or
reports a skip.

**Decisive evidence.**

- `storage.ts:390-418` writes verbatim; `:589-618` rename unvalidated.
- `panel-controller.ts:386-391`, `:731-740`; `ui.ts:275-359`; `popup.ts:167-177`, `:186-194`.
- `grep -rni maxlength src/` → no matches.
- `verify/C1-0/{code-path,reproduce,impact}/probe.*`; `verify/C2-1/reproduce/probe.cjs`
  (10/10 PASS); `verify/C3-1/reproduce`; `verify/C3-2/{code-path,reproduce}/probe.*`;
  `verify/C6-0/{code-path,reproduce}/probe.*`.
- Live popup: `verify/C3-2/reproduce/realchrome.cjs`; live options: `verify/C6-0/reproduce/repro.cjs`.

---

### F4. Suggestion banner "Save it" silently overwrites an existing same-key shortcut in both the popup and the side panel

- **Severity:** Medium — data integrity / trust bypass (verifier severities: medium ×3, low ×2)
- **Category:** correctness / security-adjacent UX
- **Status:** KNOWN root cause, with confirmed new surfaces/reachability (popup.ts:101 was already flagged; the panel path and bundle/parameterized destruction are new confirmations)
- **Primary locations:** `src/popup.ts:101` (handler `:92-109`); `src/panel-controller.ts:1265`
  (handler `:1258-1270`)

**Observed behavior.** With an existing `omnibar_s_hn = https://clone.example/` and a seeded session
suggestion `{key:'hn', url:'https://news.ycombinator.com/'}`, clicking the banner's **Save it**:

- reports `Saved! Type "hn" ...` with no confirmation buttons,
- repoints `omnibar_s_hn.url` to the suggestion URL,
- preserves `createdAt` / `useCount` / `lastUsed` (so the change is easy to miss), and
- drops the existing `label`, and can destroy a bundle/parameterized record's other fields.

The same page's form path correctly renders `"hn" already points to ... Overwrite · Save as "hn2"`.
Both popup and sidepanel handlers call `upsertShortcut({key, url, type:'redirect'})` directly and
never call `hasShortcutTargetCollision` / `renderOverwriteConfirm`.

**Root cause.** The suggestion save path bypasses the H1 overwrite guard. Reachability is stronger
than "only if the key became taken": the popup's own form is pre-filled with the suggested key, and
the suggestion survives in `chrome.storage.session` until saved/dismissed, so saving through the form
and then clicking the still-visible banner reproduces it.

**Minimal fix direction.** In both handlers, read the current store/`shortcutCache`, build the
candidate, and if `existing && hasShortcutTargetCollision(existing, candidate)`, render the existing
`renderOverwriteConfirm` flow (Overwrite / Save as `uniqueKey(...)`) in a status area. Do **not**
remove the session suggestion or hide the banner until the user chooses.

**Regression tests.** Seed an existing key + suggestion in popup and panel; assert a prompt appears
and Cancel/Save-as preserve the record. Include a bundle/parameterized existing record to assert
type-specific fields survive an Overwrite-only choice.

**Decisive evidence.**

- `popup.ts:101` direct upsert vs guarded form at `:186-194`.
- `panel-controller.ts:1265` direct upsert vs guarded form at `:395-406`.
- `verify/C8-0/code-path/repro.cjs` + `reachability.cjs`; `verify/C9-0/impact/repro.cjs`,
  `repro-inline.cjs`, `repro-types.cjs`; `verify/C2-5/reproduce/repro.cjs` + `evidence.json`.

---

### F5. Keywords of 44–64 characters lose most per-engine DNR rules silently (Chrome RE2 2 KB program limit)

- **Severity:** Medium — correctness (verifier severities: medium, medium, low)
- **Category:** correctness / capacity
- **Status:** NEW; resolves the prior audit's open question about the RE2 program-size cliff, and disproves the L2 64-char safety premise
- **Primary locations:** `src/dnr.ts:33` (`MAX_SAFE_REGEX_LENGTH = 200`), `:135-153` (rule build + warn),
  `:192-216` (`applyRules` drops with console only); `src/types.ts:68` (`MAX_KEY_LENGTH = 64`);
  `src/popup.ts:174`

**Observed behavior.** On the harness Chromium (153.0.8010.12 / 158.0.8127.18), the popup accepts a
44–64-char keyword and reports **Saved**. The real background rebuild then retains fewer rules:

| Key length | Redirect rules surviving | Engines lost |
|---:|---:|---|
| 40 | 7/7 | none |
| 43 | 6/7 | Startpage |
| 44 | 5/7 | Google, Startpage |
| 64 | 1/7 | all except Kagi |
| Parameterized 32 | 5/7 | Google, Startpage |

Chrome's own error is
`Rule with id ... was skipped as the "regexFilter" value exceeded the 2KB memory limit when compiled`;
`isRegexSupported()` returns `{isSupported:false, reason:"memoryLimitExceeded"}`. The 64-char Google
regex is only 187 chars, below the 200-char warning heuristic, so the warning never fires. The
`onCommitted` JS fallback can still rescue navigation after the search page commits, but the DNR
network-layer interception is gone and the keyword is sent to the search engine first.

**Root cause.** Each engine's regex embeds the literal keyword plus a host alternation; RE2's compiled
program size, not the regex character length, is the limiting factor. `MAX_KEY_LENGTH = 64` and
`MAX_SAFE_REGEX_LENGTH = 200` are not valid proxies for that budget, and `applyRules` silently drops
rejected rules.

**Minimal fix direction.**

1. Preflight every generated regex with
   `chrome.declarativeNetRequest.isRegexSupported({regex, isCaseSensitive:false})`; when unsupported,
   reject the save or mark the shortcut inactive in the UI instead of dropping rules.
2. Better: move engine-host matching into `condition.requestDomains` and keep only a short `q=` regex,
   removing host alternation from the RE2 program.
3. If retaining the current shape, lower `MAX_KEY_LENGTH` to the measured worst case
   (≤40 redirect, ≤28 parameterized) and lower `MAX_SAFE_REGEX_LENGTH` to the real limit.

**Regression tests.** Assert per-engine rule counts at key lengths 32/40/41/43/44/64 and parameterized
28/31/32; assert `isRegexSupported` is consulted before every add.

**Decisive evidence.**

- `dnr.ts:33,135-153,192-216`; `types.ts:65-71`; `popup.ts:174`.
- `verify/C3-0/code-path/verify_c3_0.cjs`, `verify_c3_0_seed.cjs`; `verify/C3-0/reproduce/probe.cjs`,
  `threshold.cjs`, `swconsole.cjs`; `verify/C3-0/impact/rx-direct.cjs`, `e2e-popup.cjs`, `nav6.cjs`.
- Measured maxima: `{google:43,bing:54,ddg:44,brave:62,kagi:64,ecosia:63,startpage:40}`;
  parameterized `{google:31,startpage:28}`.

---

### F6. The 500-shortcut setting exceeds Chrome's 1,000 regex-rule quota; beyond ~142 redirects shortcuts lose DNR and leak their keyword to the search engine

- **Severity:** Medium — capacity / privacy (verifier severities: medium ×3)
- **Category:** capacity
- **Status:** NEW
- **Primary locations:** `src/dnr.ts:135-139` (quota skip), `:222-227` (console warning only);
  `src/types.ts:30` (default `maxShortcuts: 500`); `src/sidepanel.html:330` / `src/options.html:335`
  (max 500); `src/background.ts:740-742`, `:748-756` (fallback only after commit on non-Edge)

**Observed behavior.** Chrome reports
`MAX_NUMBER_OF_DYNAMIC_RULES = 30000`, `MAX_NUMBER_OF_REGEX_RULES = 1000`. Each redirect shortcut
consumes 7 rules (one per engine); each parameterized shortcut consumes 14. With 500 redirects the
rebuild produces **994 rules**, covering only **142 keys** (`hk000`–`hk141`); **358** are silently
skipped. Differential navigation:

- included `hk000` → 0 Google requests, target reached directly;
- skipped `hk142` → 1 Google request (`google.com/search?q=hk142`), then the target after commit.

Parameterized shortcuts cap at **71** keys. Which keys survive follows storage iteration order, not
usage, so the shortcuts a user relies on most may be the skipped ones. The only signal is a
`console.warn`.

**Root cause.** `buildRules` stops adding once the next shortcut would exceed the regex quota and
pushes the rest into `skippedKeys`; the UI still advertises and displays 500. There is no budget
calculation, no usage prioritization, and no user-visible skipped state.

**Minimal fix direction.**

1. Compute `floor(maxAvailableRegexRules() / rulesPerShortcut)` (142 worst case for redirects,
   71 for parameterized) and clamp/validate `maxShortcuts` and imports to it; show that effective
   ceiling in Settings.
2. Sort shortcuts by `useCount` desc, then `lastUsed` desc before building rules so active keys win
   the budget. Rule IDs are rebuilt positionally, so reordering is safe.
3. Persist/surface `skippedKeys` in the panel and options page ("no instant redirect" badge).
4. Optionally trim `SEARCH_ENGINES` per entry once the budget is exhausted; the JS fallback still
   covers those engines.

**Regression tests.** 500 redirects → 994 rules / 142 keys; 500 parameterized → 71 keys; usage-sorted
ordering picks the expected keys; UI shows the effective cap and skipped badges.

**Decisive evidence.**

- `dnr.ts:135-139,222-227`; `background.ts:740-742,748-756`; `types.ts:30`.
- `verify/C4-1/code-path/quota_diff.cjs`; `verify/C4-1/reproduce/repro.cjs` + `evidence/result.json`;
  `verify/C4-1/impact/probe.mjs`, `live2.cjs`, `constants.cjs`.
- Live constants `{MAX_DYNAMIC:30000, MAX_REGEX:1000}`.

---

### F7. A full 500-row rebuild runs on every filter keystroke and every storage change

- **Severity:** Medium — performance (verifier severities: medium, low, medium)
- **Category:** performance
- **Status:** NEW
- **Primary locations:** `src/panel-controller.ts:184-203` (`renderList`, `replaceChildren`),
  `:238` (input listener), `:233-236` (`scheduleRefresh` 50 ms), `:1228-1231` (`storage.onChanged`)

**Observed behavior.** With 500 seeded shortcuts the cold list is **16,189 DOM elements**
(16,000 inside `#shortcutList`), 5,500 focusable nodes, and a 29,015 px document height. A single
filter keystroke took 100–333 ms synchronously; `PerformanceObserver` long tasks reached 209–425 ms.
A `touchShortcut`-style storage write triggered a full 500-row rebuild 90–274 ms after the write.
`replaceChildren` alone is ~39 ms.

**Root cause.** `renderList()` builds a brand-new row for every shortcut via `buildShortcutRow()` and
calls `listEl.replaceChildren(frag)`; it is bound directly to the filter input with no debounce; any
`omnibar_s_*` change schedules the same full refresh. Every shortcut activation writes
`useCount`/`lastUsed`, so the pattern fires during normal browsing.

**Minimal fix direction.**

1. Coalesce filter input with `requestAnimationFrame` or a ~100 ms debounce.
2. Keep a keyed row cache (`Map<key, HTMLLIElement>`) and patch/reorder rows in place, or virtualize
   the list to a viewport window.
3. In `storage.onChanged`, treat stat-only changes (`useCount`/`lastUsed`) as in-place text updates;
   reserve full refresh for add/delete/rename/settings changes.
4. Skip a full render while the filter input is focused if the result set is unchanged.

**Regression tests.** At 500 shortcuts, assert one render per typing burst, retained row nodes > 0,
and a stat-only write updates one row without replacing the list.

**Decisive evidence.**

- `panel-controller.ts:184-203,233-238,1228-1231`.
- `verify/C4-0/reproduce/results.json`, `results2.json`, `results3.json`; `probe.cjs`/`probe2.cjs`/`probe3.cjs`;
  `verify/C4-0/impact/repro.cjs`, `throttle.cjs`; screenshots
  `evidence/c4-0-500-rows.png`, `verify-c4-0-options-500.png`.

---

### F8. A bundle can exceed `chrome.storage.sync`'s 8 KB per-item cap; the failure is reported as "delete some shortcuts"

- **Severity:** Medium — capacity (verifier severities: medium ×3)
- **Category:** capacity
- **Status:** NEW
- **Primary locations:** `src/panel-controller.ts:731-740` (bundle submit), `:701-765` (`persistBundle`);
  `src/storage.ts:418-427` (quota mapping), `:175-178` (sanitize only caps count/URL length, not bytes)

**Observed behavior.** On a store with only 40 shortcuts (`bytesInUse ≈ 5,007 / 102,400`):

- 3 × 1,900-char URLs → `Bundle "bundle3x" saved.` with a 7,693–7,820-byte record;
- 4 × 1,900 and 5 × 1,900 → `Storage quota exceeded. Delete some shortcuts to free up space.`, no record;
- importing a sanitize-legal 32 × 2,000-char bundle (66,166 bytes) → `Storage quota exceeded — import failed...`, no record.

The actual limit hit is `QUOTA_BYTES_PER_ITEM = 8192`, not total quota, so the advice is wrong and the
user cannot discover the cause from the message.

**Root cause.** `MAX_BUNDLE_URLS × MAX_URL_LENGTH` intentionally permits ~65 KB per item, which can
never fit Chrome Sync. No write path computes the serialized item size before writing; the catch block
maps every "quota" error to the generic message.

**Minimal fix direction.**

1. Add a shared per-record byte budget (e.g. `MAX_SYNC_ITEM_BYTES = 7900`, measured as
   `key.length + JSON.stringify(record).length`, leaving headroom under 8192) and enforce it in
   `sanitizeShortcut`, `upsertShortcut`, `renameShortcut`, and `bulkWriteShortcuts`.
2. Enforce `MAX_BUNDLE_URLS` and per-URL length in the bundle form itself.
3. Return a specific error: "This bundle is too large for Chrome Sync — remove URLs or shorten one."
4. Show a live size indicator in the bundle form; distinguish per-item from total-quota errors.

**Regression tests.** 3 × 1,900 succeeds; 4 × 1,900 fails with the specific message; 32 × 2,000 import
fails with the specific message; total-quota failure still uses its own message.

**Decisive evidence.**

- `panel-controller.ts:731-740`; `storage.ts:418-427`; `sanitizeShortcut` caps at `:175-178`.
- `verify/C4-2/code-path/repro.cjs`; `verify/C4-2/reproduce/c4-2-repro.cjs`;
  `verify/C4-2/impact/live.cjs`, `probe.mjs`; `overquota-import.json`.
- Sync constants `{QUOTA_BYTES:102400, QUOTA_BYTES_PER_ITEM:8192, MAX_ITEMS:512}`.

---

### F9. Any storage change silently overwrites in-progress Settings edits while the field is focused

- **Severity:** Medium — UX / data loss (verifier severities: medium ×3)
- **Category:** UX
- **Status:** NEW
- **Primary locations:** `src/panel-controller.ts:206-213` (`renderSettings`), `:215-229` (`refresh`),
  `:1228-1231` (`onChanged`); `src/storage.ts:544-587` (`touchShortcut`)

**Observed behavior.** On the Settings tab, typing `123 / 42 / 30` into max / filter threshold /
stale days and then performing one background `chrome.storage.sync.set` of a shortcut record caused
the values to revert to `500 / 10 / 90` within ~700 ms, while `document.activeElement` was still the
max input. Continued typing appends to the reverted value; clicking Save persists a number the user
never chose and reports "Saved."

**Root cause.** `refresh()` calls `renderSettings()` unconditionally; `renderSettings` assigns every
input value and checkbox state with no focus/dirty check. `storage.onChanged` schedules `refresh()` for
**any** `omnibar_s_*` or settings change, and every shortcut activation writes `touchShortcut()`.

**Minimal fix direction.** Never touch a field the user is editing. Track per-field dirty state and
the last rendered/saved value; skip assignment when the input is focused or dirty. Render settings
only when the Settings tab is opened or `SETTINGS_KEY` itself changes; keep `renderList()` on the
generic refresh path.

**Regression tests.** Type values, trigger a background shortcut write, assert values and focus are
preserved; then save and assert the typed values persist. Also cover a user's own save on another
settings card.

**Decisive evidence.**

- `panel-controller.ts:206-213,215-229,1228-1231`; `storage.ts:544-587`.
- `verify/C4-3/code-path/repro.cjs`; `verify/C4-3/reproduce/repro.cjs`, `repro-harm.cjs`;
  `verify/C4-3/impact/repro.cjs`.

---

### F10. Startpage interception does not match Startpage's documented `?query=` search URL (DNR and JS fallback both hardcode `q=`)

- **Severity:** Medium–Low — correctness, with limited reachability (verifier severities: medium, medium, low; **one verifier refuted the "dead" premise**)
- **Category:** correctness
- **Status:** NEW (impact caveat below)
- **Primary locations:** `src/dnr.ts:57` (Startpage pattern), `:75` / `:81` (hardcoded `q=`),
  `src/background.ts:156-159` (`searchParams.get('q')`), `src/onboarding.html:261-262` (support claim),
  `src/dnr.test.ts:241` (synthetic `?q=` fixture)

**Observed behavior.** The Startpage DNR regex emitted from HEAD is:

```
^https?://(?:www\.)?startpage\.com/(?:sp/search|do/search|search)?(?:\?[^#]*&|\?)q=gh(?:...)
```

It matches `https://www.startpage.com/sp/search?q=gh` but does **not** match:

- `https://www.startpage.com/sp/search?query=gh` (Startpage's documented `query=%s` string),
- `https://www.startpage.com/do/dsearch?q=gh&cat=web&language=english` (the official Chrome extension path shape).

Live runs confirm the `query=` URL stays on the search page (no redirect, no bundle tabs, no use-count
increment), while the `q=` control redirects and touches stats. The existing suite passes because its
fixture uses the synthetic `?q=gh` URL.

**Root cause.** The query-parameter name is not part of the `SearchEngine` model; `buildQueryRegex`,
`buildParamQueryRegex`, and `extractQuery` hardcode `q`. The Startpage path alternation also omits
`do/dsearch`.

**Reachability caveat (important).** One verifier checked Chromium's prepopulated engine data and
Firefox's `search-config-v2` and found that **both built-in Startpage engines ship `q=`**. The
practical impact is therefore limited to users who add Startpage manually using Startpage's
documented `query=%s` string, or who use the official `do/dsearch` extension shape — not to every
user whose default engine is Startpage. The code defect is real; the headline "Startpage interception
is dead" is overstated. Product decision: either support both parameter names (low cost) or scope the
support claim in `onboarding.html`.

**Minimal fix direction.** Add `queryParams: string[]` to `SearchEngine` (`['q']` for existing,
`['q','query']` for Startpage), interpolate in both regex builders, and make `extractQuery`
engine-aware (`get('q') ?? get('query')`). Add `do/dsearch` to the Startpage pattern. Keep per-engine
regexes short so each remains under the RE2 budget.

**Regression tests.** Match `sp/search?query=gh`, `sp/search?q=gh` (control), and
`do/dsearch?q=gh&cat=web`; assert parameterized and bundle paths for each. Add a `query=` case to
`dnr.test.ts` rather than changing the existing `q=` control.

**Decisive evidence.**

- `dnr.ts:57,75,81`; `background.ts:156-159`; `onboarding.html:261-262`; `dnr.test.ts:241`.
- `verify/C0-0/reproduce/probe.cjs` and `impact/probe-output.txt`, `upstream-evidence.txt`.
- `verify/C10-0/reproduce/dnr-rules.json`, `match-probe.cjs`, `e2e-results.json`;
  `verify/C10-0/impact/probe2.cjs`.
- Official Startpage support article "Search strings": `https://www.startpage.com/sp/search?query=%s`;
  Chromium prepopulated engine data and Firefox `search-config-v2` show `q=` for the built-in engine.

---

## Low severity

### F11. DNR inserts raw `+` for spaces when `%s` is in a path segment, diverging from the `encodeURIComponent` fallback

- **Severity:** Low (verifier severities: low, low)
- **Status:** NEW
- **Locations:** `src/dnr.ts:81` (captures `([^&#]+?)`), `:167` (`%s` → `\1`); `src/background.ts:622`, `:657` (JS fallback uses `encodeURIComponent`); `src/url.ts:65-67`; `src/storage.ts:188-200` accepts path templates
- **Observed behavior.** For `https://en.wikipedia.org/wiki/%s` and `q=wiki+new+york`, the DNR target is
  `/wiki/new+york`; the JS fallback produces `/wiki/new%20york`. In a path, `+` is a literal plus, so
  the DNR result is wrong. Query-position `%s` (all starter shortcuts) is unaffected.
- **Root cause.** The DNR capture preserves the engine's raw query encoding and substitutes it verbatim
  into any `%s` position; `regexSubstitution` cannot transform captures.
- **Minimal fix.** Only emit priority-2 capture rules when every `%s` occurrence is in the query
  component (parse a marker-substituted template); reject path/host `%s` at write time with a clear
  message, or route expansion through the JS fallback on all browsers. Add a path-template regression
  test asserting no DNR capture rule (or correct encoding).
- **Evidence:** `verify/C0-1/reproduce/logic-check.cjs`, `live-path-param.cjs`; `verify/C0-1/code-path/probe.cjs`;
  live final URL `/wiki/new+york`.

### F12. `isSafeRedirectUrl(allowPlaceholder)` accepts `%s` in the hostname, so a poisoned record builds an arbitrary-authority substitution

- **Severity:** Low — defense-in-depth for sync-poisoned data (verifier severities: low, low)
- **Status:** NEW variant of known finding #10 (userinfo case); separate validator, so fixing the userinfo case does not fix this
- **Locations:** `src/dnr.ts:91-105` (`new URL(url.replace(/%s/g,'param'))`, checks only protocol/hostname length/whitespace), `:167`; `src/url.ts:19-31` (write validator rejects host placeholder but is bypassed by coercion); `src/storage.ts:86-126`, `:217-227` (`coerceStoredShortcut` does not call `normalizeUrl`)
- **Observed behavior.** A record `{key:'evil', type:'parameterized', url:'http://localhost/', urlTemplate:'http://%s/'}`
  written directly to `chrome.storage.sync` yields `regexSubstitution: http://\1/`. Navigating to
  `google.com/search?q=evil+attacker.example` lands on `http://attacker.example/`; the live control
  hit `http://127.0.0.1:PORT/`. Forms/import reject the same template.
- **Root cause.** The sink validator trusts a placeholder-substituted host; the read/coerce path does
  not reapply the write validator.
- **Minimal fix.** In `isSafeRedirectUrl(allowPlaceholder=true)`, substitute a sentinel and reject if
  `parsed.hostname`/`username`/`password` contains it; optionally require the template host to equal
  the fallback host; route `urlTemplate` through `normalizeUrl` in `coerceStoredShortcut`.
- **Evidence:** `verify/C0-2/code-path/probe.cjs`, `live.cjs`; `verify/C0-2/reproduce/probe2.cjs`, `live.cjs`.

### F13. `maxShortcuts` enforcement is a non-atomic read-then-write (TOCTOU)

- **Severity:** Low (verifier severities: low, low)
- **Status:** NEW
- **Locations:** `src/storage.ts:391` (`getStore`), `:398-403` (cap check), `:418` (`set`); no queue, unlike `touchQueue` at `:542`
- **Observed behavior.** With `maxShortcuts = 1`, `Promise.allSettled([upsertShortcut(raceA), upsertShortcut(raceB)])`
  returns two fulfilled results and leaves **2** records. A sequential control rejects the second with
  `Shortcut limit reached (1).`
- **Root cause.** Read, check, and write are separated by awaits with no serialization. Every UI save
  path is async/re-entrant, and popup + sidepanel/options can race.
- **Minimal fix.** Serialize writes through a module-level promise queue (like `touchQueue`) and, for
  the cross-context case, use `navigator.locks.request('omnijump-shortcut-write', ...)` or a post-write
  re-read that removes the just-written key when the count now exceeds the cap.
- **Regression test:** concurrent upserts at the cap; assert exactly `max` records.
- **Evidence:** `verify/C1-1/reproduce/probe.cjs` (3 runs), `verify/C1-1/code-path/probe.cjs`, `control.cjs`.

### F14. Delete-undo restores over a keyword re-created during the undo window

- **Severity:** Low — lost update (verifier severities: low, low)
- **Status:** NEW
- **Locations:** `src/storage.ts:530-540` (`restoreShortcuts`), `:517-523` (`bulkWriteShortcuts`);
  `src/ui.ts:444-447`; `src/panel-controller.ts:266-269`
- **Observed behavior.** Delete `gh` (GitHub), re-create `gh` as GitLab within the 6 s toast window
  (no overwrite prompt because the key is currently absent), then click the still-visible Undo:
  final record is GitHub, with the old `createdAt`; the GitLab record is silently destroyed.
- **Root cause.** `restoreShortcuts` sanitizes and bulk-writes with no existence check; undo callers
  pass the record captured at delete time, and nothing invalidates the toast on a new save.
- **Minimal fix.** Read the current store before restoring and skip keys that now exist; return
  `{restored, skipped}` and surface "N restored, M skipped — keyword already in use", or route
  collisions through `renderOverwriteConfirm`. Apply to single and bulk undo.
- **Evidence:** `verify/C2-0/code-path/probe-undo-clobber.cjs` + `evidence-undo-clobber.json`;
  `verify/C2-0/reproduce/probe.cjs`.

### F15. Re-render drops bulk-delete selections but leaves a stale "Delete (N)" button that deletes 0

- **Severity:** Low (verifier severities: low, low)
- **Status:** NEW
- **Locations:** `src/panel-controller.ts:238` (input → renderList), `:199-203` (`replaceChildren`),
  `:250-254` (button update only on `change`), `:256-259` (reads checked boxes at click), `:1228-1231`
- **Observed behavior.** Select 2 rows → `Delete (2)` visible. Type in the filter (or receive any
  live-sync write) → selection becomes 0 but the button still says `Delete (2)`. Clicking it shows
  `Deleted 0 shortcuts` and nothing is deleted.
- **Root cause.** Selection lives only in checkbox DOM nodes, which `renderList` replaces; the button
  state is never recomputed by `renderList`/`refresh`.
- **Minimal fix.** Keep `selectedKeys: Set<string>` in controller state; re-apply checks in
  `renderList`; recompute `deleteSelectedBtn.hidden`/text at the end of render; click handler reads the
  set and hides the button if empty.
- **Evidence:** `verify/C2-2/reproduce/probe.cjs` + `independent-probe.json`.

### F16. A live-sync refresh discards an open inline edit (typed values lost, focus dropped) and cancels a pending delete confirmation

- **Severity:** Low (verifier severities: low ×4)
- **Status:** NEW
- **Locations:** `src/panel-controller.ts:203` (`replaceChildren`), `:215-229` (`refresh` →
  `cancelPendingDelete()` + `renderList()`), `:1228-1231`; `src/ui.ts:228`, `:267-273`
- **Observed behavior.** Open an inline editor, type `typed-but-not-saved`, then one background sync
  write (the same shape as `touchShortcut`): the editor disappears, the input reverts to a fresh row,
  and `document.activeElement` becomes `BODY`. The same trigger clears a pending delete confirmation
  and its toast before the 4 s timer.
- **Root cause.** `refresh()` unconditionally cancels pending deletes and rebuilds every row;
  `editingRow` is module-private state pointing at a detached node.
- **Minimal fix.** Remove `cancelPendingDelete()` from the generic refresh path; snapshot the editing
  key/values/focus before `replaceChildren` and re-open/restore after; preferably patch rows in place
  and add a stat-only fast path.
- **Evidence:** `verify/C2-3/reproduce/edit-sync.cjs` + `evidence.json`, `control.cjs`;
  `verify/C4-4/reproduce/c4-4-probe.cjs` + `.out`.

### F17. JSON import writes past the configured `maxShortcuts` cap

- **Severity:** Low (verifier severities: low, low)
- **Status:** NEW
- **Locations:** `src/storage.ts:398-403` (cap only in upsert), `:517-523` (`bulkWriteShortcuts`);
  `src/panel-controller.ts:1024-1025` (`finishImport`), `:190` (count display)
- **Observed behavior.** Set `maxShortcuts = 3`, import a 5-entry file → status `Imported 5 shortcuts.`,
  count label `5 / 3`, 5 records in sync; the next Add fails with `Shortcut limit reached (3).`
- **Root cause.** `finishImport` calls `bulkWriteShortcuts`, which has no cap check; only
  `upsertShortcut`/`seedStarterShortcuts` enforce it.
- **Minimal fix.** At the import call site, compute
  `headroom = cap - existingCount + collidingKeysBeingReplaced`, keep only that many non-colliding
  entries, and report `Imported N, skipped M over the shortcut limit`. Do not add the check inside
  `bulkWriteShortcuts` unconditionally, because `restoreShortcuts` (undo) also uses it.
- **Evidence:** `verify/C2-4/reproduce/probe.cjs`, `browser-probe.cjs` + `browser-evidence.json`;
  `verify/C2-4/code-path/probe-output.json`.

### F18. Import treats the inherited `constructor` property as an existing shortcut

- **Severity:** Low (verifier severities: low, low)
- **Status:** KNOWN root cause (same prototype-truthiness class previously flagged at `popup.ts:181`); import path newly confirmed
- **Locations:** `src/panel-controller.ts:1058` (`Boolean(existingStore.shortcuts[k])`), `:1094`
  (`!existingStore.shortcuts[shortcut.key]`); `src/storage.ts:233` (`shortcuts = {}`);
  `normalizeKey` at `:64-71` preserves `constructor`
- **Observed behavior.** Importing `{key:'constructor', url:'https://constructor.example.com'}` into
  an empty store renders
  `1 imported keyword would replace existing ones: "constructor" → constructor.example.com`,
  although no record exists. Choosing **Skip existing** reports
  `Imported 0 shortcuts (kept 1 existing).` and stores nothing. `Object.prototype` is not polluted.
- **Root cause.** Truthiness on a plain-object map resolves inherited prototype properties.
- **Minimal fix.** Use `Object.prototype.hasOwnProperty.call(existingStore.shortcuts, k)` in both
  places (the project targets ES2020, so avoid `Object.hasOwn`), or build the map with
  `Object.create(null)`/`Map`.
- **Evidence:** `verify/C2-6/reproduce/repro.cjs` + `import-constructor.json`, `evidence.json`;
  `verify/C2-6/code-path/probe.cjs`.

### F19. ARIA tablist has no roving tabindex or arrow-key handling

- **Severity:** Low — accessibility (verifier severities: low, low)
- **Status:** NEW
- **Locations:** `src/sidepanel.html:191-194`, `src/options.html:196-199`;
  `src/panel-controller.ts:124-138` (`showTab`), `:1178-1181` (document arrow handler)
- **Observed behavior.** All three `role="tab"` buttons keep `tabIndex=0` (three Tab stops).
  ArrowRight/ArrowLeft/Home/End on a focused tab do nothing; ArrowDown is worse — the document-level
  j/k handler moves focus into the first shortcut row. Click/Enter/Space still switch tabs.
- **Root cause.** No roving tabindex is applied in `showTab`, and no keydown handler implements the
  APG tabs pattern.
- **Minimal fix.** Set `tabIndex` to 0 only on the selected tab and -1 on the rest in `showTab`; add
  ArrowLeft/ArrowRight/Home/End on the tablist to focus+activate; early-return the document list
  handler when the event target is inside `[role=tablist]`.
- **Evidence:** `verify/C4-5/reproduce/probe.cjs`, `detail.cjs`, `result.json`; `verify/C4-5/code-path/probe.cjs`.

### F20. Light-mode search badge and success text fail WCAG AA contrast

- **Severity:** Low — accessibility (verifier severities: low, low)
- **Status:** NEW
- **Locations:** `src/theme.css:43` (`--success:#16a34a`), `:72-73`
  (`--badge-search-bg:#ecfdf5`, `--badge-search-fg:#059669`), `:351-355` (`.badge-search`),
  `:523-525` (`.form-status` / `.success`)
- **Observed behavior.** `.badge-search` is **3.58:1** (#059669 on #ecfdf5, 10 px/600);
  `.form-status.success` is **3.30:1** (#16a34a on white, 11 px). Both fail the 4.5:1 AA threshold for
  normal text. Dark mode passes (9.31:1); muted text passes (4.76:1).
- **Root cause.** Light-mode emerald tokens were chosen for borders/fills, then reused as small text
  colors.
- **Minimal fix.** In light mode set `--success: #047857` and `--badge-search-fg: #047857`
  (5.48:1 on white, 5.21:1 on #ecfdf5). Leave dark-mode overrides unchanged. Optionally add a token
  contrast unit test.
- **Evidence:** `verify/C4-6/reproduce/contrast.cjs`, `live-probe.cjs`, `live-computed.json`;
  `verify/C4-6/code-path/a11y-c46.cjs`, `fixcheck.cjs`.

### F21. Filter results, the TIP suggestion banner, and picker opens are not announced

- **Severity:** Low — accessibility (verifier severities: low, low)
- **Status:** NEW
- **Locations:** `src/sidepanel.html:227` (`#count`), `:240` (`#noResults`), `:199-205` (`#suggestion`);
  `src/panel-controller.ts:190`, `:194-196`, `:238`, `:1245-1247`, pickers at `:539`, `:599`, `:651`
- **Observed behavior.** `#count` and `#noResults` have no `role`/`aria-live`; live filtering hides the
  list and shows "Nothing matches your filter." with no announcement and focus left in the filter.
  The TIP banner is unhidden and its text set with no live region and no focus move, so a screen-reader
  user can miss it entirely. Picker triggers toggle panels with no `aria-expanded`/`aria-controls`;
  focus falls to `<body>` on close.
- **Root cause.** Dynamic updates are visual-only; no live regions or disclosure semantics.
- **Minimal fix.** Add a visually hidden polite status region updated from `renderList` with the
  filtered count / no-match text; add `role="status" aria-live="polite"` to the suggestion banner;
  add `aria-expanded`/`aria-controls` to pickers and restore focus to the trigger on close.
- **Evidence:** `verify/C4-7/reproduce/probe.cjs`, `probe-suggestion2.cjs`, `probe-picker.cjs`,
  `probe-results.json`; `verify/C4-7/code-path/probe4.cjs`.

### F22. Bundle URL reordering is pointer-drag only, with no keyboard alternative

- **Severity:** Low — accessibility (verifier severities: low, low)
- **Status:** NEW
- **Locations:** `src/panel-controller.ts:424-431` (`dragover`), `:433-468` (`addUrlRow`: span handle,
  `aria-hidden="true"`, `mousedown` only sets `draggable`), `:460-464`
- **Observed behavior.** The drag handle is a `<span class="drag-handle" aria-hidden="true" tabindex=-1>`
  with `title="Drag to reorder"`; it cannot be focused or activated by keyboard. Tab traversal through
  the bundle form visits only inputs, remove buttons, and Add URL. Alt/Ctrl/Shift + ArrowUp/Down on a
  row's inputs does nothing, so keyboard users cannot reorder bundle tabs.
- **Root cause.** Reordering is implemented solely with HTML5 drag-and-drop; no focusable control or
  key handler exists.
- **Minimal fix.** Add per-row Move up/Move down buttons (or a real button handle with
  Alt+ArrowUp/Down) reusing the `dragover` insertion logic; keep pointer drag; announce the new
  position via `bundleStatus` (already `role="status"`).
- **Evidence:** `verify/C4-8/reproduce/probe.cjs`, `drag-probe.cjs`; `verify/C4-8/code-path/probe.cjs`.

---

## Prior-audit known / deferred items

The explicit `known-findings.txt` was **missing**, so this section is reconstructed from the input
metadata and the remediation history named in the findings. Treat it as indicative, not exhaustive.

| Item | Status in this audit | Cross-reference |
|---|---|---|
| H1 remediation: overwrite confirmation on save | **Regression confirmed** — import settings path and both suggestion banners bypass it | F2, F4 |
| L2 "64-char keys keep DNR rules under the RE2 limit" | **Premise disproved** — measured limits are 40–63 chars depending on engine | F5 |
| Known #10: `%s` in URL userinfo / authority | Userinfo case remains; host-position variant confirmed in a different validator | F12 |
| Bundle over-cap undo truncation | Confirmed and broadened to redirect URL, search template, label, key, and per-item bytes | F3, F8 |
| Popup suggestion "Save it" overwrite (`popup.ts:101`) | Confirmed; panel path and record-type destruction are additional confirmations | F4 |
| Import `constructor` prototype truthiness (`popup.ts:181` class) | Confirmed in the import path | F18 |
| Prior audit open question #2: RE2 program-size cliff | **Answered** — measured per-engine maxima and live rule counts | F5 |
| Prior deferred: none enumerated | Unknown due to missing known-findings file | — |

---

## Coverage gaps and claims that still need live verification

1. **Prior-knowledge separation is incomplete.** `known-findings.txt` is absent, so the difference
   between this sweep and earlier audits cannot be proven from disk.
2. **Firefox AMO publishing has not run end-to-end.** The `firefox/v1.2.5` run's publish job is
   waiting on the `firefox-addons` environment. The post-F1 fix needs a real unlisted dry run (or a
   fork tag) to prove the source archive is accepted and the approval-timeout change returns.
3. **Real Firefox runtime is untested.** Only `web-ext lint` and static quota reasoning cover Firefox
   140+; DNR regex-quota behavior, the sidebar, `browser_specific_settings`, and manifest differences
   need a manual Firefox run of redirect / parameterized / bundle.
4. **Real Microsoft Edge is untested.** Edge suppresses DNR redirects on the default engine origin;
   the `IS_EDGE` JS fallback (`onBeforeNavigate` → `getFastStore` → `handleJsRedirect`) was reasoned
   about and emulated but not exercised on Edge itself.
5. **Native omnibox path not exercised.** Most probes used search URLs/DNR or seeded records; the
   `omnibox.onInputChanged` / `onInputEntered` suggestions, disposition handling, and
   `handleShortcutTouch` path still need real address-bar testing.
6. **Native docked side panel not exercised.** Probes loaded `sidepanel.html` as a tab and proxied
   `chrome.tabs.query` / `tabs.onActivated`. Suggestion rendering and active-tab behavior in a real
   docked panel remain unverified.
7. **Popup was tested as a tab/proxy, not a native popup window.** The suggestion overwrite is proven
   at code level and via a `tabs.query` shim; native popup lifecycle/focus behavior is unverified.
8. **Cross-device `chrome.storage.sync` conflict/timing is untested.** Cross-context races and the
   stale-cleanup race were approximated with two pages plus the service worker.
9. **Browser-version coverage is narrow.** Regex program budgets and quota constants were measured on
   Chrome for Testing 153/158; `minimum_chrome_version` is 120. Thresholds may differ on older Chrome
   and on Firefox.
10. **Storage hard limits are not stress-tested.** Total sync quota (102,400 bytes), the 512-item cap,
    and write-rate quotas (`MAX_WRITE_OPERATIONS_PER_MINUTE`) were not exercised end-to-end.
11. **Accessibility was DOM-verified, not assistive-tech-verified.** No NVDA/VoiceOver session, no
    axe-core sweep, and no keyboard-trap testing on the tablist or pickers.
12. **Untested flows:** onboarding, context-menu save, legacy-storage migration, dev-reload, Firefox/
    Edge manifest differences, Chrome Web Store and Edge Add-ons publishing automation.
13. **Automated test gaps:** no `panel-controller`/`renderList` tests; no cap round-trip tests; no
    per-engine rule-count tests at boundary key lengths; no import/suggestion overwrite regression
    tests; no `isRegexSupported` preflight test in `dnr.test.ts`.
14. **F2 mechanism:** one verifier dissented from the "partial store" explanation. A single canonical
    regression test must pin the corrected cleanup-race mechanism so future fixes do not chase the
    wrong cause.
15. **F10 reachability:** built-in Chrome/Firefox Startpage engines use `q=`. The `query=` path is
    reachable via Startpage's documented manual string and `do/dsearch`; product must decide whether
    to support it or narrow the onboarding claim.
16. **Release automation:** Chrome Web Store auto-publish (`release.yml`) and Edge Add-ons
    (`publish-edge.yml`) were not exercised in this sweep.

---

## Recommended fix order

1. **F1** — restore AMO source submission (`--upload-source-code`, `BUILD.md`) and `--approval-timeout=0`.
   This is the only item that blocks signed releases.
2. **F2** — take the import collision snapshot before any write, defer settings/count commits to
   `finishImport`, and fix the undefined-`oldValue` cleanup trigger. This is a security regression of
   the H1 guard.
3. **F3 + F8** — enforce all caps and a per-item byte budget at the write choke points; make undo/
   import loss visible. This removes the largest class of silent data loss.
4. **F4** — route both suggestion banners through the existing overwrite confirmation.
5. **F5 + F6** — preflight `isRegexSupported`, move hosts to `requestDomains`, order by usage, clamp
   and surface the rule budget.
6. **F7 + F9 + F15 + F16** — make the list/settings UI state-preserving: keyed rows or virtualization,
   debounced filtering, stat-only updates, dirty/focus guards, persistent selection, and editor/
   delete-confirmation preservation.
7. **F10** — support Startpage `query=`/`do/dsearch` or scope the support claim.
8. **F11–F14, F17–F22** — harden validators, undo/import invariants, and accessibility.

---

## Appendix A — Deduplication map

| Report ID | Input slugs merged |
|---|---|
| F1 | `firefox-publish-missing-source-archive` |
| F2 | `import-settings-bypasses-collision-confirm` (4 verdicts) |
| F3 | `interactive-writes-bypass-field-caps-silent-undo-loss`, `form-length-caps-bypassed-undo-import-loss`, `forms-exceed-sanitize-caps-undo-drops-record`, `popup-url-length-unvalidated-data-loss`, `popup-save-as-alt-key-bypasses-max-key-length` |
| F4 | `suggestion-save-silent-overwrite` (panel), `suggestion-save-silent-overwrite` (popup), `panel-suggestion-save-bypasses-overwrite` |
| F5 | `popup-64-char-key-exceeds-chrome-re2-budget` |
| F6 | `dnr-regex-quota-silent-fallback-over-142` |
| F7 | `shortcut-list-rerender-jank-at-500` |
| F8 | `bundle-record-exceeds-sync-item-quota` |
| F9 | `settings-inputs-overwritten-by-live-sync` |
| F10 | `startpage-query-parameter-never-matches`, `startpage-query-param-never-matches` |
| F11 | `dnr-path-percent-s-plus-encoding` |
| F12 | `dnr-template-host-placeholder-not-rejected` |
| F13 | `maxshortcuts-check-is-toctou` |
| F14 | `undo-restores-over-recreated-keyword` |
| F15 | `bulk-select-lost-on-rerender-stale-delete` |
| F16 | `live-sync-refresh-discards-inline-edit`, `storage-refresh-destroys-open-editor-and-pending-delete` |
| F17 | `import-bypasses-max-shortcuts` |
| F18 | `import-constructor-phantom-collision` |
| F19 | `tablist-missing-arrow-keys-and-roving-tabindex` |
| F20 | `light-mode-contrast-failures-badge-and-success` |
| F21 | `dynamic-updates-not-announced` |
| F22 | `bundle-reorder-drag-only` |

## Appendix B — Verdict dissent summary

| Finding | Finder severity | Verifier severities | Note |
|---|---|---|---|
| F1 | high | high, medium, medium | All confirmed the missing source archive; scope of "cannot reliably publish" debated |
| F2 | high | high, medium, medium, medium | All confirmed the observable silent overwrite; two verifiers refuted the "partial read" mechanism and identified the stale-cleanup race |
| F3 | medium | medium, medium, low, low, low | Same defect across five entry points; severity split follows the specific field/case |
| F4 | medium | medium ×3, low ×2 | Popup path was previously known; panel path and record-type destruction newly confirmed |
| F5 | medium | medium, medium, low | DNR rule loss confirmed live; one verifier rated low because the `onCommitted` fallback still redirects after commit |
| F6 | medium | medium ×3 | All confirmed the 142-key cliff and the privacy/round-trip impact |
| F7 | medium | medium, low, medium | Absolute timings vary by machine; DOM shape and render mechanism identical |
| F8 | medium | medium ×3 | All confirmed the per-item cap, not total quota, is the cause |
| F9 | medium | medium ×3 | All confirmed with live focus/dirty evidence |
| F10 | medium | medium, medium, low + **1 refuted** | Refutation correctly notes built-in Chrome/Firefox Startpage uses `q=`; code defect remains for documented `query=`/`do/dsearch` URLs |
| F11–F22 | low | low ×2 each | No severity dissent |
