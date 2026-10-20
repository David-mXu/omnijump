# Automating Chrome Web Store (CWS) Deployment

## 1. Problem Description & Feature Goal
OmniJump needed a reliable, automated way to deploy the latest extension build to the Chrome Web Store (CWS). Previously, there were two fragmented workflow files with mismatched triggers and secret names:
- `.github/workflows/release.yml` used `v*` git tags, but expected `CWS_*` secrets and an outdated `chrome-webstore-upload-cli@3` version that lacked `PUBLISHER_ID` support.
- `.github/workflows/publish-chrome.yml` used `chrome/v*` tags and expected `CHROME_*` secrets, but didn't support automated GitHub releases or manual UI-driven deployment.
- The repository secrets configured in GitHub Actions were named with the `CHROME_*` prefix (`CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`).

The goal was to streamline this into a single, automated workflow that supports both tag-based releases (`npm version patch && git push --follow-tags`) and one-click manual deployments from the GitHub Actions web UI (`workflow_dispatch`).

## 2. Concepts & Architecture
- **Chrome Web Store API (v1.1 / OAuth2)**: Google requires OAuth 2.0 authentication (`CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`) tied to a Developer Dashboard account and a `PUBLISHER_ID` (or item `EXTENSION_ID`) to upload extension packages (`.zip`) and submit them for review.
- **`chrome-webstore-upload-cli` (v4+)**: The modern CLI tool wraps Google's API. Invoking `chrome-webstore-upload --source <archive>` without subcommands automatically triggers the dual action: uploading the new bundle and submitting it for automated review/publishing.
- **`workflow_dispatch`**: GitHub Actions trigger allowing manual execution with configurable inputs (such as choosing whether to submit for review or upload as a draft).

## 3. Investigation & Implementation Steps
1. **Audited Existing Secrets & Workflows**:
   - Checked repository secrets via GitHub CLI (`gh secret list`), confirming the 5 active secrets: `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, and `CHROME_REFRESH_TOKEN`.
   - Identified that `release.yml` was failing or unable to authenticate because it mapped non-existent `CWS_*` secret variables.
2. **Unified the Release Workflow in `.github/workflows/release.yml`**:
   - Added `workflow_dispatch` trigger with an optional `auto_publish` boolean input (defaults to `true`).
   - Mapped environment variables with fallback expressions: `${{ secrets.CHROME_* || secrets.CWS_* }}` to support either convention gracefully.
   - Handled dynamic version resolution: uses `package.json` version for manual `workflow_dispatch` runs and checks tag consistency on `push` tag events.
   - Guarded the GitHub release creation step with `if: startsWith(github.ref, 'refs/tags/v')` so manual runs can upload to CWS without failing on missing git release tags.
3. **Removed Redundant Workflow**:
   - Removed `.github/workflows/publish-chrome.yml` to avoid duplicate or conflicting automation.
4. **Added Local Helper Script**:
   - Added `"upload:cws"` in `package.json` allowing local builds and CLI uploads when environment variables are set in a local terminal.
5. **Updated Documentation**:
   - Updated `docs/publishing.md` with the unified trigger options and correct secret variable names.

## 4. Alternatives & Tradeoffs
- **Separate Workflows vs. Unified Workflow**: Keeping separate workflows for `chrome/v*` and `v*` introduces friction because developers typically tag releases once per repository version. Unifying into `release.yml` aligns with semantic versioning (`package.json`) and centralizes CI/CD maintenance.
- **Auto-Publish vs. Draft Upload**: Defaulting `auto_publish: true` submits the extension directly for Google's review pipeline. Providing an explicit `auto_publish: false` option in `workflow_dispatch` allows uploading test builds as drafts when desired.

## 5. Verification
- **Automated Tests**:
  - `npm test` (vitest): 87 tests passed across all 4 test suites.
  - `npx tsc --noEmit`: 0 TypeScript diagnostics.
  - `npm run build:all`: cleanly generated both Chrome (`dist/chrome`) and Firefox (`dist/firefox`) bundles.
- **CI & Lockfile Sync**:
  - Locked `esbuild` dependency in `package.json` / `package-lock.json` and updated `.github/workflows/ci.yml` to Node 22, resolving npm dependency mismatches on Ubuntu runners. Verified passing status on GitHub Actions CI run `39450339401`.
- **CLI Options Validation**:
  - Tested `npx chrome-webstore-upload-cli@latest --help` to verify arguments and environment variable expectations (`EXTENSION_ID`, `PUBLISHER_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`).
