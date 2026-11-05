# Remediating the red-team audit: import trust, publish-pipeline pinning, and the low-severity sweep

**Date:** 2026-11-05 · **Scope:** H1, H2, M2, M3, and all Low findings from [`security/red-team-audit-2026-11-05.md`](../../security/red-team-audit-2026-11-05.md) · **Constraint from the user:** fix everything *without breaking functionality*.

> Payload-level exploit detail deliberately lives only in the audit report (under `security/`), because everything under `docs/` auto-publishes to GitHub Pages.

## 1. The problems

The audit found the runtime code solid but two systemic weaknesses:

- **H1/M2/M3 — the JSON import was too trusting.** It overwrote existing keywords with no confirmation, applied behavior-changing settings (`smartSuggestions`, `staleAutoDelete`, `staleDays`) from the file, and accepted far-future timestamps that would permanently evade the stale-shortcut auto-cleanup.
- **H2 — the release pipeline executed floating packages.** `npx chrome-webstore-upload-cli@latest` and bare `npx web-ext` downloaded un-checked code from npm *in the same job step that holds the store publish credentials*.
- **L1–L14** — assorted hardening gaps: the Google DNR host pattern matched lookalike domains (`google.evil.com`), no keyword length cap, two storage write paths copied data verbatim, the dev WebSocket bound all interfaces, Firefox secrets traveled on the command line, visit counting ran even with smart suggestions off, and more.

## 2. Root causes and the concepts they teach

**Trust boundaries, not trust locations.** Interactive forms had overwrite confirmation and validation; the importer — which processes *less* trustworthy data — had neither. Data should be validated at the moment it crosses a trust boundary (file → storage), regardless of which UI path carries it.

**Parse → confirm → write.** The secure shape for bulk imports is: fully parse and validate into a candidate write set first, diff against current state, get an explicit decision on collisions, *then* write once. Any rejected entry can then never partially apply.

**"Off" must mean "not collected," not "collected but hidden."** The smart-suggestions toggle was checked *after* per-host visit counters were incremented. Moving the gate before counting is a privacy invariant: the safest data is data never recorded.

**Defense in depth at the storage boundary.** Imports are only one way bad data reaches `chrome.storage.sync`: cross-device sync and hand-edited storage bypass every form check. So the timestamp clamp went into *both* `sanitizeShortcut` (write boundaries) and a new `getStore` coercion (read boundary), where garbage timestamps drop into the existing "grace-stamp" self-heal path instead of confusing the cleanup logic.

**Pin anything that runs next to credentials.** `npx pkg@latest` in CI has no lockfile integrity check. Moving the two publish tools into `devDependencies` means `npm ci` verifies them against `package-lock.json` — supply-chain integrity for free. Complementary hygiene: secrets via `env:` (never argv), `environment:` + Required reviewers as a human gate, SHA-pinning third-party actions, and semver-validating tag-derived shell variables.

## 3. What was done, in order

1. **Read the exact code and the tests that pin behavior** (status strings, store shapes) so nothing regressed.
2. **Extracted `src/url.ts`** — `normalizeUrl` / `deriveSearchFallbackUrl` moved into a leaf module (no imports) because `storage.ts` needed them but `suggest.ts` already imported `normalizeKey` from `storage.ts` — a direct move would have created an import cycle. `suggest.ts` re-exports them, so no importer changed.
3. **`src/types.ts`:** shared input limits (`MAX_KEY_LENGTH=64`, `MAX_LABEL_LENGTH=256`, `MAX_URL_LENGTH=2048`, `MAX_BUNDLE_URLS=32`, `MAX_IMPORT_FILE_BYTES=2 MB`).
4. **`src/storage.ts`:** `sanitizeShortcut` (strict, exported; normalizes URLs, clamps timestamps, caps fields), `coerceStoredShortcut` in `getStore`, dismissed-hosts moved to `storage.local` with legacy-sync migration, migration + delete-undo re-validated.
5. **`src/dnr.ts`:** Google host pattern restricted to real TLD shapes (`com|cat|eus|ccTLD`(`.xx`)?); `MAX_SAFE_REGEX_LENGTH` 160 → 200 with justification.
6. **`src/background.ts`:** smart-suggestions gate moved before counting.
7. **Input surfaces:** 64-char key cap in the redirect/bundle forms, popup, and inline editor; suggestion saves now normalize the URL at the write boundary like every other path.
8. **`src/panel-controller.ts` import rewrite:** file-size pre-check → JSON parse → strict per-entry validation → in-file duplicate rejection → collision diff vs. `getStore()` → Overwrite all / Skip existing / Cancel (rendered into the existing `dataStatus` row, same DOM-builder style as `renderOverwriteConfirm`, so no HTML/CSS changes) → single batched `storage.sync.set`. Settings whitelist narrowed to three preference fields. Rejection logs carry `index + key`, never raw objects.
9. **Pipelines:** tools pinned as devDeps; floating npx removed; Firefox secrets via env; `permissions: contents: read` on CI + publish; semver validation + quoting for `VERSION`; `environment:` on both publish jobs; `softprops/action-gh-release` SHA-pinned; `concurrency` groups; dev WebSocket bound to `127.0.0.1`; `docs/publishing.md` updated.
10. **`src/manifest.ts`:** comment documenting why both DNR permissions exist (L4 — code behavior intentionally unchanged).

**Alternatives considered:** renaming colliding imports automatically (rejected — silent repointing is exactly the attack; ambiguity belongs to the user); capping keys inside `upsertShortcut` (rejected — DNR regex tests build >64-char patterns directly through storage, and cap-at-form is the honest UX); CSP tightening (deferred — script axis is already safe, reskin risk outweighs gain); vite 8 / rollup 4 majors (deferred — breaking, dev-only exposure).

## 4. Verification

- `npx tsc --noEmit` — clean.
- `npm test` — **215/215** (6 existing tests updated to assert the *new* intended behaviors: settings whitelist, dismissed-hosts locality; 22 new tests covering import collisions × 4, oversize file, timestamp clamping, duplicate/oversized keys, store coercion, garbage-timestamp self-heal, migration/restore re-validation, Google host allow/deny matrices, no-counting-when-off, popup key cap). The Google hardening is proven by test: `google.co.uk`, `google.com.au` still match; `google.evil.com`, `google.co.uk.evil.com` don't.
- `npm run build:all` — both `dist/chrome` and `dist/firefox` build clean.
- `npm audit fix` — 9 → 5 advisories (remainder requires the vite-8 major; dev-only, intentionally skipped).

## 5. Left for the user

- Delete the gitignored stale artifacts: `dist/popup.js*`, `dist/omnijump-*-v1.2.0.zip` (agent delete attempts were permission-blocked).
- In GitHub **Settings → Environments**, add **Required reviewers** to `chrome-store` and `firefox-addons` — the workflows now declare the environments, but the human gate only exists once configured in the repo.
