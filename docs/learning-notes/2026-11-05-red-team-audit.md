# Red-Team Audit: Post-Hardening Security Review Process and Outcomes

## 1. Problem and Goal

One day after a security hardening sweep (XSS fixes, URL validation, import schema checks, CSP) landed in OmniJump, the goal was a deep adversarial audit of the *whole* project — extension runtime plus build/release/supply-chain — with a report-only deliverable. The key reviewing question was twofold: **did the claimed fixes actually close the holes on every data path?** and **what did the sweep miss?**

## 2. Core Concepts

- **Validate-at-sink vs. validate-at-write.** OmniJump's strongest property after hardening is that every navigation sink (DNR rule builder, `tabs.create`, omnibox handler, Edge JS redirect) re-checks URL schemes even when the data was already validated at write time. This is defense in depth: poisoned storage from an old version still cannot execute anywhere. The corollary weakness is that the *invariant* "storage is clean" holds by convention — any future sink that trusts stored data joins the blast radius of the write paths that don't validate (legacy migration, delete-undo).
- **Import is a security boundary, not a feature boundary.** A JSON import is attacker-controlled input that bypasses every interactive control (overwrite confirmations, overwrite previews) and reaches storage + DNR rules within ~50 ms. Treating "import = restore, trust the file" made the import path the single most realistic end-user attack vector.
- **CI/CD supply chain beats application code as attack surface.** With zero runtime dependencies and strict CSP, the extension itself is a thin target; the release workflow that executes unpinned `npx ...@latest` packages next to long-lived Web Store credentials was the highest-leverage finding.
- **Multi-agent audit design.** Five independent agents each owned one attack surface (DOM injection, DNR/navigation, manifest/permissions, storage/import/privacy, build/CI). Independence matters: the import-overwrite finding was reached by two agents from different angles, which corroborated it; severity disagreements (Low→Medium vs High) were adjudicated during triage against the exact code.
- **Findings are only as good as their verification.** Every High/Medium finding was re-read at the cited lines before being written into the report, and regex-level claims were executed in Node to confirm match behavior rather than eyeballed.

## 3. Method and Steps

1. **Scoped with the user first** (deliverable, threat model, depth, exclusions) so the audit could fan out without re-litigating scope mid-flight.
2. **Terrain mapping**: file inventory, `package.json`, and the previous day's hardening note — which changed the audit from "find bugs" to "verify fixes + hunt residual risk".
3. **Parallel surface audits** with read-only constraints and a fixed output contract (severity | confidence | file:line | exploit path | fix direction), plus explicit list-of-safe-things to prevent finding inflation.
4. **Post-hardening verification matrix**: each claimed fix from the sweep was re-checked against current code (all passed; the URL validator additionally survived a 36-payload adversarial probe with zero dangerous outputs).
5. **Triage and dedupe**: overlapping findings merged, severities normalized, then the full report written to [`security/red-team-audit-2026-11-05.md`](../../security/red-team-audit-2026-11-05.md). That directory was chosen deliberately: `docs/**` is deployed to GitHub Pages by `deploy-pages.yml`, so payload-level detail must not live here. Baseline suite at audit time: **193/193 tests green**, `tsc --noEmit` clean.

## 4. Notable Outcomes (summary level; details in the linked report)

- **No runtime code-execution vulnerability found.** All rendering surfaces use `textContent`; all navigation sinks validate schemes; dev-reload is verifiably absent from production bundles; no network egress exists anywhere in the extension.
- **High: the import path silently merges** — overwrites existing keywords without confirmation, applies behavior-changing settings (including the privacy toggle), and accepts far-future timestamps that permanently evade stale auto-delete. Together these make a crafted "shared shortcut pack" a persistence-capable phishing primitive.
- **High: the publish pipeline runs unpinned `@latest` npm tools** in the same job environment as long-lived Chrome Web Store / Firefox credentials — the one change with the best risk-per-minute ratio (pin in `devDependencies` so `npm ci` lockfile integrity applies).
- **Medium/low tier:** no human approval gate on store auto-publish, dual/redundant DNR permissions with `<all_urls>`, a Google host pattern that matches `google.evil.com`-style hosts (bounded impact — redirect targets are victim-supplied), dev-server WebSocket binding all interfaces, missing `permissions:` blocks in two workflows, and an EOL rollup on the build path (dev-only advisories; nothing ships in the bundle).
- **Verified safe:** the regex-injection surface into DNR is triple-redundant (charset normalization + `escapeRegex` + RE2 compile rejection); prototype-pollution keys dead-end in `normalizeKey`; bundle tab-flooding is self-limiting because the first redirect destroys the attacker's tab.

## 5. Alternatives and Tradeoffs

- **Report placement**: the audit report went to `security/` (repo-only) rather than `docs/learning-notes/` because `docs/**` auto-publishes to GitHub Pages — this note intentionally omits exploit payloads for the same reason.
- **Import semantics**: the current "restore = merge" model vs. new-keys-only import is the one open design question; the report recommends a collision-preview confirm as the middle ground.
- **Host-permissions reduction**: enumerating the 7 search-engine origins instead of `<all_urls>` is a genuine but modest win, since `webNavigation` already observes all tab URLs regardless.
- **Severity divergence on import-overwrite**: one auditor scored Low→Medium (needs social engineering), another High (instant DNR activation + no audit trail). Adjudicated High in the report because the export/import features make pack-sharing a realistic norm and the hijack is near-invisible post-import.

## 6. Verification

- Full test suite (`npm test`): 193/193 passing at audit completion.
- All four claimed post-hardening fixes re-verified in source with regression tests present.
- Top findings (import merge, release workflow lines, Google regex, stale-cleanup logic) re-read at exact lines by the triaging auditor before inclusion.
- Gaps explicitly acknowledged: Chrome's `$` handling in `regexSubstitution`, the RE2 program-size cliff, and GitHub repo settings (workflow permissions, tag protection, CWS dashboard publish toggle) still need live verification — listed in the report's open questions.

Full report with evidence and remediation order: [`security/red-team-audit-2026-11-05.md`](../../security/red-team-audit-2026-11-05.md)
