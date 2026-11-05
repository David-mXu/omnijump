# Publishing

Releases are automated by `.github/workflows/release.yml`: pushing a `vX.Y.Z`
tag runs the tests, builds both targets, uploads the Chrome build to the
Chrome Web Store, auto-publishes it, and attaches both zips to a GitHub
release. You can also trigger a manual deployment directly from GitHub Actions
via "Run workflow" under the Release workflow.

## Cutting a release

```bash
npm version patch        # or minor / major — updates package.json and tags
git push --follow-tags
```

Or trigger a manual upload of the latest `main` branch from GitHub Actions:
**Actions** → **Release** → **Run workflow**.

The manifest version is read from `package.json`, so that is the only file
to bump. The workflow refuses to run if the tag and package version differ.

## One-time setup (Chrome Web Store API)

Google exposes an official publish API; it needs an OAuth token tied to the
Google account that owns the item in the Developer Dashboard.

1. **Publish the first version by hand.** The API can only update an
   existing item. Upload once at https://chrome.google.com/webstore/devconsole
   and note the item ID (32 letters, in the dashboard URL).
2. **Create a Google Cloud project** (any name) at https://console.cloud.google.com.
3. **Enable the Chrome Web Store API** under APIs & Services → Library.
4. **Configure the OAuth consent screen** (External, add yourself as a test
   user; it does not need to be verified).
5. **Create OAuth credentials** under APIs & Services → Credentials →
   "OAuth client ID" → Desktop app. Save the client ID and secret.
6. **Mint a refresh token.** Open this URL in a browser (replace CLIENT_ID),
   sign in with the dashboard owner's account, and copy the code shown:

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&access_type=offline&prompt=consent
   ```

   Then exchange it:

   ```bash
   curl -s -X POST https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
     -d code=CODE -d grant_type=authorization_code \
     -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```

   The response contains `refresh_token`.
7. **Add repository secrets** (GitHub → Settings → Secrets and
   variables → Actions): `CHROME_EXTENSION_ID` (or `CWS_EXTENSION_ID`),
   `CHROME_PUBLISHER_ID` (or `CWS_PUBLISHER_ID`), `CHROME_CLIENT_ID`,
   `CHROME_CLIENT_SECRET`, and `CHROME_REFRESH_TOKEN`.

Uploads go through Google's review; running without subcommands submits for
review and publishes when approved.

Both store-upload tools (`chrome-webstore-upload-cli`, `web-ext`) are pinned
as devDependencies and installed via `npm ci`, so every publish run uses the
lockfile-integrity-checked copy — never a floating `npx ...@latest` fetched
next to store credentials. Keep them upgraded deliberately via
`npm install -D chrome-webstore-upload-cli@X web-ext@Y`.

The publish jobs run in GitHub environments (`chrome-store`,
`firefox-addons`, `edge-addons`). Configure **Required reviewers** on those
environments (Settings → Environments) so store submissions need a human
approval before credentials are exposed to the job.

## Local dry run

```bash
npm run build:chrome
EXTENSION_ID=... PUBLISHER_ID=... CLIENT_ID=... CLIENT_SECRET=... REFRESH_TOKEN=... \
  npx chrome-webstore-upload-cli --source dist/chrome
```

## Firefox (automated via `publish-firefox.yml`)

Pushing a `firefox/v*` tag runs `.github/workflows/publish-firefox.yml`:
test → build → `web-ext sign --channel listed`, using
`WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` (from
https://addons.mozilla.org/developers/addon/api/key/) stored as the
`FIREFOX_API_KEY` / `FIREFOX_API_SECRET` repository secrets and passed via
environment variables (never on the command line).

The AMO listing already exists (`omnijump`, first submitted 2026-06-02 with
version 1.1.0), which locks the Gecko ID to `omnijump@example.com` — that
value in `src/manifest.ts` must never change, because AMO rejects packages
whose `browser_specific_settings.gecko.id` differs from the listing's
original ID. Changing it would require deleting the listing and re-submitting
from zero.

Setup status (2026-11-05): **complete.** The listing's owner account is
davidmingxu@gmail.com; `FIREFOX_API_KEY` (JWT issuer `user:19957299`) and
`FIREFOX_API_SECRET` are set as repository secrets, and version 1.2.4 was
submitted manually through the Dev Hub (with source archive — reviewers
require it for minified builds). From then on, `git tag firefox/vX.Y.Z && git push --tags` publishes.

## Edge Add-ons (automated via `publish-edge.yml`)

Pushing an `edge/v*` tag runs `.github/workflows/publish-edge.yml`: test →
build → zip → the official Edge Add-ons Update REST API v1.1 (upload package,
poll, publish; curl only — no npm tooling involved).

Setup status (2026-11-05): **complete.** The listing already existed
(submitted 2026-06-08, store ID `0RDCKCMDTCHW`, CRX
`kifdlencphamnhjblkcflkhfgkbhecgc`) under the Microsoft account
davidmingxu@gmail.com. `EDGE_PRODUCT_ID` (`4fe1a1eb-…-bab754`),
`EDGE_CLIENT_ID`, and `EDGE_API_KEY` are set as repository secrets, and
version 1.2.4 was published through the same API flow the workflow uses.
From then on, `git tag edge/vX.Y.Z && git push --tags` publishes (tag must
match `package.json`'s version).

**Key rotation (important):** Edge API keys expire — the current
`EDGE_API_KEY` expires **2027-01-16**. Before then: Partner Center →
Microsoft Edge → Publish API → **New API key**, copy it immediately (the
full value is only shown in the creating session), and update the
`EDGE_API_KEY` repository secret. AMO and Chrome credentials do not expire.

If ever starting a store listing from zero elsewhere, one-time steps were:
register the developer account, create the listing manually (the API can
only **update** an existing product), copy the Product ID, enable the
Publish API (v1.1) and create credentials, then add the three secrets.

## Store/tag matrix

| Tag push | Workflow | Store |
|---|---|---|
| `vX.Y.Z` | `release.yml` | Chrome Web Store (+ GitHub release zips) |
| `firefox/vX.Y.Z` | `publish-firefox.yml` | Mozilla Add-ons (AMO) |
| `edge/vX.Y.Z` | `publish-edge.yml` | Microsoft Edge Add-ons |
