# OmniJump Red-Team Security Audit — 2026-11-05

**Posture:** Deep adversarial, post-hardening (audit ran one day after the 2026-11-05 security sweep landed XSS/URL/import/CSP fixes).
**Scope:** All extension source, manifest generation, storage/import/privacy, build & CI/CD/release pipeline, dev tooling, dependency surface. Nothing out of scope.
**Method:** Five independent audit agents, one per attack surface (DOM/UX injection · DNR & navigation · manifest/permissions/CSP · storage/privacy/import · build/CI/supply-chain), plus independent verification of every top finding against the exact source lines. Baseline suite: **193/193 tests green**, `tsc --noEmit` clean.
**Threat actors considered:** malicious webpage visited by the user · crafted JSON import file · poisoned/stale sync data (pre-fix data or compromised sync) · compromised npm package in the release pipeline · attacker with tag-push/write access to the repo.

---

## Verdict

**The extension runtime is in strong shape.** No DOM-XSS sink exists on any current rendering surface; every navigation sink (DNR rule build, `tabs.create/update`, omnibox handler, Edge JS redirect) re-validates URL schemes even when write paths don't; dev-reload code is verifiably absent from production bundles; nothing in `src/` makes a network call, so there is no data-egress channel beyond the user's own Chrome Sync.

**The two meaningful residual risks are social and supply-chain, not code-injection:**

1. **The import pipeline trusts too silently** — a "shared shortcut pack" silently overwrites the victim's existing keywords, turns on behavior changes, and plants records immune to auto-cleanup. This is the most realistic attack on an end user.
2. **The release pipeline fetches and executes unpinned `@latest` packages from npm in the same process that holds your long-lived Chrome Web Store / Firefox publish credentials.** One upstream package compromise = malicious updates pushed to every user, indefinitely.

---

## Findings

Severity ladder: **Critical** (remote code exec / store takeover with no user action) → **High** (practical account/store compromise or silent hijack) → **Medium** (needs user action or has meaningful preconditions) → **Low** (limited impact / hygiene) → **Info** (hardening opportunity, no practical impact).

### HIGH

| # | Finding | Evidence | Why it matters | Fix direction |
|---|---------|----------|----------------|---------------|
| H1 | **Import silently overwrites existing shortcuts — no collision check, no preview, no overwrite confirmation** (the manual forms have all three) | `src/panel-controller.ts:958-1047`: imported records go straight into `writes[...]` and a single `chrome.storage.sync.set()`; "restore operation" comment at :958. Interactive forms use `renderOverwriteConfirm` (:392-403, :739-755; `popup.ts:176-186`). | Victim imports a community "500 productivity shortcuts.json". Records keyed `mail`/`gh`/`bank` collide after `normalizeKey` and are replaced with look-alike phishing hosts (any `https://` passes `normalizeUrl`). `didShortcutRuleChange` rebuilds DNR rules within ~50 ms — the *next* habitual `mail`+Enter lands on the clone, pre-network. The export feature's existence makes pack-sharing a social norm, raising likelihood. Hijack is near-invisible: no diff shown, just "Imported N shortcuts." | Diff imported keys against `getStore()` before writing; show collision count/preview with explicit Overwrite/Skip choice. Highlight eTLD+1 mismatches vs. the existing record. |
| H2 | **Publish tools fetched as floating `@latest`/unpinned npx packages, executed in the same job env as long-lived store credentials** | `.github/workflows/release.yml:74,77` — `npx --yes chrome-webstore-upload-cli@latest`; `.github/workflows/publish-firefox.yml:37` — bare `npx web-ext`; neither is in `package-lock.json` (0 hits). Secrets in env only one step later (`release.yml:66-71`). | No lockfile integrity check covers these packages. A compromised release (or dependency-confusion pivot) runs arbitrary code with `CHROME_CLIENT_SECRET` + `CHROME_REFRESH_TOKEN` in scope. The refresh token is long-lived and scoped to the Web Store: exfiltration = attackers publish malicious extension versions to all users until manual revocation. Single highest-leverage hole in the repo. | Add both tools to `devDependencies` with exact pins (the workflows already run `npm ci` → lockfile integrity then applies), invoke without `@latest`, drop `--yes`. Or vendor a pinned ~50-line upload script (CWS API is two HTTP calls). |

### MEDIUM

| # | Finding | Evidence | Fix direction |
|---|---------|----------|---------------|
| M1 | **Auto-publish to CWS on every tag with zero human gate.** No `environment:` protection on the publish job; `workflow_dispatch` defaults `auto_publish: true` and runs from any branch; tag-less path runs upload **and** publish. Anyone who gains tag-push or write capability (compromised maintainer token, rogue collaborator) ships to the store with Google review as the only gate. | `release.yml:33-34, 73-79` | Declare `environment: chrome-store` with `required_reviewers` on the job; default dispatch to upload-only. |
| M2 | **Import silently flips behavior-changing settings** (`smartSuggestions: true`, `staleAutoDelete: false`, `staleDays: 365`) with the same unconsented click that imports data — a privacy toggle and the one defense that ages out planted shortcuts. | `src/panel-controller.ts:938-957` (whitelist merge at :955) | Exclude behavioral booleans from import (keep numeric caps/darkMode), or gate settings behind a separate explicit confirm. Definitely exclude `smartSuggestions`. |
| M3 | **Far-future imported `createdAt`/`lastUsed` permanently evade stale auto-delete** (validation accepts any finite number ≥ 0; cleanup only deletes `reference < cutoff`). A planted shortcut the victim never uses is never purged. Secondary cosmetic bug: rows can show negative "-317d ago". | `src/panel-controller.ts:989-997`; `src/storage.ts:279-284` | Clamp on import: `ts = Math.min(ts, Date.now())`. |

### LOW

| # | Finding | Evidence | Fix direction |
|---|---------|----------|---------------|
| L1 | **Google engine pattern matches attacker-registerable hosts.** `(?:www\.)?google\.[a-z]+(?:\.[a-z]+)?/` matches `google.evil.com/search?q=key`. Verified dynamically: `google.evil.com`, `www.google.evil.com`, `google.evil.co` all match; `google.com.evil.co.uk` correctly rejected. Redirect target is always the victim's *own* saved URL, so impact is an oracle/referrer leak (target site learns the victim owns shortcut `gh` and visited the attacker page), forced bundle-tab opening, and trust-boundary confusion — not hijack. | `src/dnr.ts:27` | Allowlist real Google host/TLD pairs or enforce a registrable-domain check instead of open `[a-z]+(?:\.[a-z]+)?`. |
| L2 | **RE2 size guard is a warn-only char-length heuristic; keyword length is uncapped.** ~150+ char keyword → each of its 7 regexes trips the 160-char warn → Chrome likely rejects → per-rule retry drops just those rules → that keyword silently never redirects; user never told. | `src/dnr.ts:15,121-128,167-190`; `storage.ts:23-30` (no length cap) | Cap keys (e.g. 64 chars) at `normalizeKey` + all form/import entry points; or hard-skip with a UI error. |
| L3 | **Two write paths copy URL data verbatim** (`migrateFromLegacyStorage`, `restoreShortcuts` undo) — safe **today** only because every downstream sink re-validates schemes (verified). The invariant "storage contains no dangerous URL" holds by convention, not enforcement; any future consumer that trusts `shortcut.url` (an `<a href>` feature, a new opener) inherits a poisonable data path. | `src/storage.ts:118-132,154-161` | Run `normalizeUrl` at these two write boundaries too, matching the import path. |
| L4 | **Dual DNR permission names + `<all_urls>` host access.** `declarativeNetRequest` (legacy) + `declarativeNetRequestWithHostAccess` + `<all_urls>` are mutually redundant; both DNR names appear in the install warning surface. Restricting host_permissions to the 7 search-engine origins is a feasible genuine reduction (DNR + webNavigation scope), modest privacy win. | `src/manifest.ts:16-17,51`; `dist/*/manifest.json` verified | Keep one DNR name (with a comment explaining Edge/Firefox tolerance if both are truly needed); consider enumerating engine hosts. |
| L5 | **Dev-reload WebSocket binds all interfaces (`0.0.0.0`), not loopback** — LAN devices and *any webpage open in any browser* (cross-site WS to localhost, no Origin check) can connect during `npm run dev`. Impact is bounded: server only ever sends the literal `reload`, ignores inbound frames; risk is presence disclosure / annoyance, not code exec. Dev-only anyway. | `scripts/dev-reload-plugin.ts:17` (ws `listen(port, undefined)`); `src/dev-reload.ts:11` (strict string equality) | `new WebSocketServer({ port, host: '127.0.0.1' })`. |
| L6 | **Firefox API secrets passed on process argv** (`--api-key=${{ secrets... }}`) instead of env vars — readable via `/proc` and rendered into the workflow script (GitHub masking is defense of last resort). `docs/publishing.md:71-73` already documents the `WEB_EXT_API_KEY/SECRET` env convention `web-ext` reads natively — the workflow just doesn't use it. | `publish-firefox.yml:39-40` | Move to the step's `env:` block; drop the flags. |
| L7 | **`ci.yml` and `publish-firefox.yml` have no top-level `permissions:`** — GITHUB_TOKEN inherits the repo default (often broad write). Nothing in either job needs more than `contents: read`. | workflow files | Add `permissions: contents: read`. |
| L8 | **`VERSION` (tag-derived) expanded unquoted in shell**, and the tag↔version check enforces equality but not semver — a malicious version+tag pair could inject into publish-shell commands. Requires repo write access (which could edit the workflow anyway) → lateral, not a privilege boundary. | `release.yml:55,62-63,75,78` | Regex-validate `^v[0-9]+\.[0-9]+\.[0-9]+…`; quote `"${VERSION}"`. |
| L9 | **Import resource limits absent**: no `file.size` pre-check (multi-hundred-MB JSON hangs the page; victim-picked file, so bounded); no field-length caps (a 500 KB label passes, then one oversized record fails the *entire* atomic import with a misleading "quota" message); rejected entries `console.error` the full raw object (100k-entry file floods retained console). | `src/panel-controller.ts:919-924,963-1056` | `if (file.size > N) reject`; cap key ≤ 64, label ≤ 256, URL ≤ 2048, bundle ≤ 32; log index+key, not objects. |
| L10 | **Dismissed suggestion hosts live in `chrome.storage.sync`** — browsing-derived hostnames transit Google's sync to every device. Counts correctly stay session-local; the suppress-list doesn't need to sync. | `src/storage.ts:14-21`; `panel-controller.ts:1238-1245`; `popup.ts:105-112` | Move `omnibar_dismissed` to `storage.local`, or document in the privacy policy. |
| L11 | **Visit counting runs even when `smartSuggestions` is off** — the toggle gates only *display*, checked after `finalizeTabSession` already incremented per-host counts. RAM-only session storage (no leak), but "off" reads as "not counted", and the AMO listing declares `data_collection: none`. | `src/background.ts:189-272` (gate at :222, counting at :206-208) | Check the toggle before `finalizeTabSession`. |
| L12 | **`getStore()` re-validates nothing beyond keys** — string-typed timestamps / non-array `bundleUrls` arriving via sync or hand-edited storage reach cleanup/DNR code (guarded at sinks, incidentally). `"abc" < cutoff` is NaN → never deleted, never grace-stamped. | `src/storage.ts:43-48,279-284` | Coerce/drop malformed types in `getStore` like import does (defense-in-depth). |
| L13 | **Stale artifacts in `dist/` root**: ancient pre-Vite `popup.js`/`.d.ts` from a different toy extension, and v1.2.0 zips (tree is at v1.2.4). Never shipped (`emptyOutDir` covers `dist/<target>`; `upload:cws` sources `dist/chrome`), pure hygiene/confusion. | `dist/popup.js`, `dist/*-v1.2.0.zip`; `vite.config.ts:20` | Delete; put release zips in `release/`. |
| L14 | **`rollup 2.79.2` (EOL, HIGH arbitrary-file-write advisory) on the release build path** via `@crxjs/vite-plugin@2.4.0` (newest 2.x still nests rollup ^2). Non-exploitable without attacker-controlled build inputs, but every release build runs it. `npm audit` overall: **9 advisories (6 high, 3 moderate), all devDependencies — zero runtime deps, nothing ships in the extension bundle.** Non-breaking fixes exist for vitest/nanoid/postcss/source-map-js; esbuild CVE needs the vite-8 major (dev-server-only exposure path this repo never exercises — `vite build --watch`, never `vite dev`). | `package-lock.json`; `npm audit` output | `npm audit fix` now; `overrides` for rollup ^4 if compatible or track upstream; schedule vite major bump. |

### INFO (hardening opportunities, no practical exploit today)

- **CSP could be tightened cheaply**: current `script-src 'self'; object-src 'none'; base-uri 'none'` *replaces* the MV3 default rather than merging, so `img-src`/`connect-src`/`style-src`/`default-src` are unrestricted on extension pages. Suggest `default-src 'self'` + `style-src 'self' 'unsafe-inline'` (the four pages use inline `<style>` — mandatory) + `img-src 'self' https: data:` (needed for favicon rendering in tab pickers — without the `https:` clause the pickers lose favicons). The script axis — the real gate — is already solid and test-locked (`manifest.test.ts:12-13`).
- **Service-worker CSP cannot be set via manifest** in MV3 — inherent platform limitation; the strict validation gates in the SW are the load-bearing control. Documented, no action.
- **`isHttpUrl()` is prefix-only** (`/^https?:/i`) while the DNR side uses parse-based `isSafeRedirectUrl`. Never matches `javascript:`/`data:`/`file:`, and every input was already normalized at write time — zero current exploit, but unify on the parse-based gate so one future edit can't regress it. `src/background.ts:567-569`.
- **Edge dedup wedge**: within the 1,500 ms `recentJsRedirects` TTL, a Back-navigation to the search URL returns "handled" without redirecting → user stuck until retry. Key dedup on `(tabId, searchUrl)` or only when committed URL already equals target. `src/background.ts:530-535`. (Availability/UX, not security.)
- **`regexSubstitution` assumes Chrome treats `$` as literal** — only `\` is escaped before `%s→\1`. Matches Chrome's documented `\1`-`\9` semantics; **verify dynamically on live Chrome 141+**. Also `buildRules` doesn't require `%s` in parameterized templates (UI/import do; stale sync data could bypass) — force it there too. `src/dnr.ts:109,142`.
- **Third-party action risk**: `softprops/action-gh-release@v3` is a single-maintainer action running with `contents: write` + your freshly built zips; pin by SHA (Dependabot keeps pins fresh). Official `actions/*` org tags are low-risk. `release.yml:83`.
- **No `concurrency:` on release/publish jobs** — racing tag pushes → duplicate CWS uploads. `release.yml`, `publish-firefox.yml`.
- **Tab-flood via crafted page is self-limiting** (good design): the first navigation itself triggers the redirect that discards the attacker's tab; max effect is one burst of (bundle size − 1) background tabs per victim-initiated search.
- **Docs drift**: `docs/publishing.md:69-75` still describes Firefox automation as "not automated yet" while `publish-firefox.yml` exists and holds real secrets. Update the doc.
- **Gecko ID** `omnijump@example.com` — placeholder domain; pick a real-looking ID before the first AMO signing (immutable after).
- **DOM mock fidelity**: `innerHTML` never parses in the test mock, so XSS regression tests assert "no tainted string reaches the setter", not "browser parse is safe". Acceptable tripwire; a one-off Playwright smoke test on the built extension would close the gap.
- **Import counter can overstate writes** (within-file key collision is silent last-wins but counted twice) and **`restoreShortcuts` can exceed `maxShortcuts`** inside the undo window — cosmetic/by-design, noted for completeness.
- **`payload.dailyCounts` exported** includes a week of activity dates — user-initiated export, acceptable; just be aware.

---

## Post-hardening verification (claimed fixes from the 2026-11-05 sweep, re-checked)

| Claimed fix | Verdict | Evidence |
|---|---|---|
| DOM XSS in `showDeleteConfirmToast` (innerHTML) | **Fixed** | `ui.ts:177-226` pure `createElement`/`textContent`; tainted key lands only in `<strong>.textContent` (:192); regression test `ui.test.ts:48-61` |
| URL validation in `normalizeUrl()` / `deriveSearchFallbackUrl()` | **Fixed, probe-verified** | `suggest.ts:47-117`; 36-payload adversarial probe (`javascript:`/`data:`/`vbscript:`/`file:`/`blob:`/`intent:`, whitespace/entity/percent obfuscation, `@`/backslash authority confusion, protocol-relative, `%s`-in-host) → **0 dangerous outputs** |
| Import JSON validation (null/numeric/non-array/missing `%s`) | **Fixed** | `panel-controller.ts:919-1081` whitelists types, re-runs `normalizeUrl` on every URL incl. each bundle item; covered by `sidepanel.test.ts:463-575` |
| Manifest CSP on both targets | **Present** | `manifest.ts:52-54`, set before the Chrome/Firefox split; verified in `dist/chrome/manifest.json:41` and `dist/firefox/manifest.json:42` |
| DNR backslash/`%s` escaping + capture-anchoring | **Correct** | `dnr.ts:142` escapes `\` *before* `%s→\1`; keyword forced through `escapeRegex` after charset normalization — triple redundancy, no injection path; `dnr.test.ts:206-218` |
| Raw-token equality guard (c++ → c hijack) | **Fixed** | `background.ts:117-119`; `c%2B%2B`, `gh%3F`, `yt%3A music` correctly rejected; `background.test.ts:327-389` |
| Rebuild lock / stat-write storms / rename self-deletion / useCount preservation | **Fixed** | `dnr.ts:210-227` (lock verified, no lost rebuild); `background.ts:323-340` (`didShortcutRuleChange` skips stat-only writes); `storage.ts:233,73-75` |

## Verified-safe highlights (things that frequently bite extensions, checked and clean here)

- Every list/picker/toast render of tainted data uses `textContent`/`.value`/`dataset`/`aria-label` — the only `innerHTML` writes are `''` clears and constant internal SVGs. Zero inline scripts or inline event handlers in all four HTML pages; dark-mode bootstrap lives inside external modules, so no CSP exemption needed.
- Every navigation sink re-checks schemes even for sync-poisoned data: `openShortcut` `/^https?:\/\//i` (`ui.ts:141-148`), DNR build `isSafeRedirectUrl` (`dnr.ts:67-81`), `handleJsRedirect`/`navigateForDisposition` `isHttpUrl` gates, bundle extras filtered. A pre-fix `javascript:` record silently no-ops everywhere.
- Edge JS redirect can never fire off-engine: both call sites gated by `isSearchEngineUrl`; `main_frame`-only + `tabId < 0`/`frameId !== 0` guards block subframe attacks.
- **Dev-reload verifiably absent from production**: `dist/chrome` and `dist/firefox` bundles contain zero occurrences of `35729`, `startDevReload`, `WebSocket`, or `import.meta` remnants; the `ws` server only starts under `VITE_DEV_RELOAD=1`.
- **No `web_accessible_resources`, no `externally_connectable`, no content scripts, no `update_url`** → web pages cannot reach extension pages (onboarding included), message it, or inject into pages.
- **Privacy egress: none.** No `fetch`/`XHR`/`sendBeacon` anywhere in `src/`; secrets appear nowhere in tracked files or git history (pattern-scanned); no CDN/external references in extension HTML.
- Repo hygiene: no committed `.env`/keys; secrets only in one release step's `env:`; no `pull_request_target`/`workflow_run` triggers; tag↔version consistency check present; `npm ci` everywhere.
- Prototype-pollution attempts via import keys (`__proto__`, `constructor`) dead-end in `normalizeKey`'s `[a-z0-9-]` charset; import builds fresh literals, never spreads raw parsed objects.

## Open questions needing live-browser verification

1. ~~Chrome's `$` semantics in `regexSubstitution`~~ — **Verified live 2026-11-05** (Chromium 1248 via Playwright, `--load-extension=dist/chrome`): parameterized shortcut `dollarprobe` with query `a$b` redirected to `https://www.youtube.com/results?search_query=a%24b` — `$` is treated literally, encoding intact. The same run confirmed end-to-end: import collision confirm (rendering + all three choices), settings-toggle immunity (M2), timestamp clamping (M3), live key-length rejection (L2), and a real `google.com/search?q=key` → target DNR redirect. Script: `/tmp/opencode/oj-e2e/smoke.mjs` (18/18 checks passed).
2. RE2 program-size cliff vs. the 160-char heuristic — fuzz keyword lengths on real Chrome.
3. DNR substitution outputting an invalid URL (template placing `\1` in host position) — confirm silent failure, no error-page loop.
4. Firefox DNR parity for the lazy-capture param regex — tests compile patterns as JS RegExp only.
5. GitHub repo settings: default workflow permissions (downgrades L7), tag protection rules (gates M1/L8), CWS dashboard "publish after review" toggle (sizes M1's blast radius) — none visible from the filesystem.

## Recommended remediation order

1. **Pin the publish toolchain** (H2) — `devDependencies` + `npm ci`, drop `--yes`/`@latest`. Highest leverage, ~30 minutes.
2. **Add an `environment:` with required reviewers to the publish job** (M1); pass Firefox secrets via `env:` (L6); add `permissions: contents: read` to ci/publish-firefox (L7); SHA-pin `softprops/action-gh-release`; quote `"$VERSION"` (L8).
3. **Import rework**: collision diff + confirm (H1), exclude behavioral settings (M2), clamp timestamps (M3), size/length caps (L9).
4. **Privacy polish**: dismissed-hosts to `storage.local` (L10); gate counting behind the toggle (L11); normalize the two verbatim write paths (L3).
5. **DNR trim**: Google host allowlist (L1); keyword length cap (L2); dedupe DNR permission names (L4).
6. **Hygiene**: delete stale `dist/` artifacts (L13); `npm audit fix` + script `overrides` plan (L14); update `docs/publishing.md`.

---

## Remediation status (same day, second engagement)

All High, all requested Medium, and all Low findings were remediated with zero functionality regressions: suite **215/215 green** (193 → 215, including 22 new adversarial tests), `tsc --noEmit` clean, `npm run build:all` clean for both targets.

| Item | Status | What changed |
|---|---|---|
| H1 | **Fixed** | Import is now parse → dedupe → collision-confirm → single atomic write. Colliding keywords render Overwrite all / Skip existing / Cancel in the data status row (with `key → new host` preview); nothing is written until the user chooses. Existing form overwrite confirms unchanged. |
| H2 | **Fixed** | `chrome-webstore-upload-cli@4.0.2` and `web-ext@10.8.0` pinned as devDependencies (`npm ci` → lockfile integrity); workflows no longer fetch `@latest` or use `--yes`. |
| M1 | **Code-side fixed** | `environment: chrome-store` / `environment: firefox-addons` declared on both publish jobs. **Repo-side action required:** configure Required reviewers on those environments in GitHub Settings → Environments; without that, the environment is a label, not a gate. |
| M2 | **Fixed** | Import settings whitelist narrowed to `maxShortcuts` / `filterThreshold` / `darkMode`. `smartSuggestions`, `staleAutoDelete`, `staleDays` from files are ignored. |
| M3 | **Fixed, defense-in-depth** | `Math.min(ts, Date.now())` clamp in `sanitizeShortcut` (all write boundaries) **and** in `getStore`'s new coercion (sync/hand-edited data self-heals; garbage timestamps drop into the grace-stamp path). |
| L1 | **Fixed** | Google host pattern restricted to `com|cat|eus|ccTLD` (+ optional 2-letter second level); tests prove `google.co.uk`/`google.com.au` match while `google.evil.com`/`google.co.uk.evil.com` don't. Shared by DNR rules and `isSearchEngineUrl`. |
| L2 | **Fixed** | `MAX_KEY_LENGTH = 64` enforced at every input surface (redirect/bundle forms, popup, inline editor, import). `MAX_SAFE_REGEX_LENGTH` raised to 200 to fit the hardened Google pattern (still far under RE2's 2 KB limit). |
| L3 | **Fixed** | `migrateFromLegacyStorage` and `restoreShortcuts` now pass records through the exported `sanitizeShortcut`; the "only validated data enters storage" invariant is enforced, not conventional. |
| L4 | **Documented** | Comment added at `src/manifest.ts`: both DNR permission names are required for Chrome (host-permission coverage + Firefox compatibility). Host permissions left broad by design (universal navigation observation). |
| L5 | **Fixed** | Dev-reload WebSocket binds `127.0.0.1`. |
| L6 | **Fixed** | Firefox secrets moved to `WEB_EXT_API_KEY/SECRET` env vars; off argv. |
| L7 | **Fixed** | `permissions: contents: read` on `ci.yml` and `publish-firefox.yml`. |
| L8 | **Fixed** | `VERSION` semver-regex validated and quoted at every expansion site. |
| L9 | **Fixed** | 2 MB import file pre-check; field caps (`key ≤ 64`, `label ≤ 256`, `url ≤ 2048`, `bundle ≤ 32`); in-file duplicate keys rejected (first wins); rejection logs show index+key, never raw objects. |
| L10 | **Fixed** | `omnibar_dismissed` moved to `storage.local` with transparent migration of the legacy sync record on first access. |
| L11 | **Fixed** | The `smartSuggestions` check now runs **before** any session finalization/counting — off means nothing is collected. Regression test asserts `sessionStore` stays empty after repeated visits. |
| L12 | **Fixed** | `getStore` coerces every record (types, timestamps, arrays) — see M3. |
| L13 | **User action** | Stale `dist/` artifacts are gitignored/local-only; delete manually (agent had no delete permission): `dist/popup.js*`, `dist/omnijump-*-v1.2.0.zip`. |
| L14 | **Partial** | `npm audit fix` applied (9 → 5 advisories). Remainder needs the vite-8/rollup-4 majors (breaking; dev-only exposure) — deferred. |

Also fixed from the Info tier: `softprops/action-gh-release` SHA-pinned (`40c2ca6… # v3`); `concurrency` groups on both publish workflows; `docs/publishing.md` refreshed (pinned tools, environments, Firefox automation now documented).

Deferred with rationale: CSP tightening (current CSP has no script-axis weakness; page changes carry layout risk), `regexSubstitution` `$`-semantics live probe (needs live Chrome), Edge back-navigation dedup wedge (UX availability, needs real-Edge repro), vite 8 / rollup 4 majors.

---

*Audit artifacts: five independent surface reports were produced by parallel audit agents and triaged; every High/Medium finding was re-verified against the exact source lines cited above. No files were modified during the audit (report-only engagement). The remediation engagement above modified files as listed.*
