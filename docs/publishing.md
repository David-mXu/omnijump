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

## Local dry run

```bash
npm run build:chrome
EXTENSION_ID=... PUBLISHER_ID=... CLIENT_ID=... CLIENT_SECRET=... REFRESH_TOKEN=... \
  npx chrome-webstore-upload-cli --source dist/chrome
```

## Firefox (not automated yet)

Mozilla's add-on store (AMO) has the same shape: `web-ext sign` with
`WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` from
https://addons.mozilla.org/developers/addon/api/key/. The Firefox zip is
already produced by the workflow; add a `web-ext sign --channel listed` step
once the add-on exists on AMO.
