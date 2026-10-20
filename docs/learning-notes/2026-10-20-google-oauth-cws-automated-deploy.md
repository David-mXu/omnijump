# Google Cloud OAuth & Chrome Web Store Automated Deployment Setup

## 1. Problem Description & Symptoms
When attempting to automate the publishing and release workflow for OmniJump to the Chrome Web Store via GitHub Actions (`.github/workflows/release.yml`), the deployment failed with:
1. **GitHub Actions CWS Upload Failure**: `400: invalid_grant`. The previously stored `REFRESH_TOKEN` expired because projects in "Testing" mode have a strict 7-day token expiration limit.
2. **OAuth Consent Screen Block**: When attempting to re-authorize the OAuth client to obtain a fresh refresh token, Google returned:
   ```text
   Access blocked: OmniJump has not completed the Google verification process
   Error 403: access_denied
   ```
   Even though the developer account (`davidmingxu@gmail.com`) was the owner and registered test user, Google prevented consent from proceeding.

## 2. Root Cause Analysis & Concepts
- **App Logo Triggers Mandatory Verification**: In Google Cloud OAuth (Google Auth Platform), uploading any custom application logo under **Branding** automatically flags the application as requiring full brand verification by Google. Until verified, Google hard-blocks the OAuth consent screen with `Error 403: access_denied`, even for developer accounts.
- **Testing vs. Production OAuth Refresh Token Lifespan**: OAuth 2.0 refresh tokens issued for Google Cloud projects whose publishing status is set to **Testing** expire after 7 days. Setting the publishing status to **In production** (external, up to 100 users for unverified/non-sensitive apps) issues permanent, non-expiring refresh tokens suitable for CI/CD pipelines.
- **Sensitive vs. Non-Sensitive Scopes**: The Chrome Web Store API scope (`https://www.googleapis.com/auth/chromewebstore`) does not access personal user data (like Gmail or Drive), so Google does not require app verification once the custom logo is removed.

## 3. Investigation & Implementation Steps
1. **Browser Automation Connection**:
   - Connected to the user's running Chrome browser instance over CDP (Chrome DevTools Protocol) using the Windows Python environment and `browser-harness`.
   - Inspected active tabs and identified the Google Cloud project `omnijump-extension` (Project number `560647890645`).
2. **Resolving the Verification Block**:
   - Navigated to `https://console.cloud.google.com/auth/branding?project=omnijump-extension`.
   - Dispatched the action to permanently delete the custom uploaded App Logo.
   - Saved the branding configuration.
   - Inspected the **Verification Center** (`/auth/verification`), which updated immediately:
     > *"Verification is not required since your app is not requesting any sensitive or restricted scopes."*
   - Confirmed publishing status was set to **In production** (External, 2/100 users) under `/auth/audience`.
3. **Validating Credentials & API Status**:
   - Checked `https://console.cloud.google.com/apis/api/chromewebstore.googleapis.com/overview?project=omnijump-extension` and confirmed the **Chrome Web Store API** was enabled.
   - Inspected the existing OAuth 2.0 Client (`CI/CD pipeline`) under `/apis/credentials`:
     - Verified authorized redirect URI: `https://developers.google.com/oauthplayground`.
     - Generated a fresh client secret via "Add secret" for rotation.
4. **Acquiring Permanent Refresh Token via OAuth 2.0 Playground**:
   - Navigated to `https://developers.google.com/oauthplayground`.
   - Configured custom OAuth credentials (`oauthClientId` and `oauthClientSecret`) in the settings bubble.
   - Requested the scope `https://www.googleapis.com/auth/chromewebstore`.
   - Selected developer account `davidmingxu@gmail.com`. Because the app is developer-owned and unverified, clicked **Advanced** -> **Go to OmniJump (unsafe)** -> **Continue**.
   - OAuth Playground received the authorization code; clicked **Exchange authorization code for tokens**, successfully obtaining a permanent `refresh_token` and active `access_token`.
5. **Configuring GitHub Repository Secrets**:
   - Using the GitHub CLI (`gh secret set -R David-MXu/OmniJump`), updated all five required secrets:
     - `CHROME_CLIENT_ID`
     - `CHROME_CLIENT_SECRET`
     - `CHROME_EXTENSION_ID` (`adgmbjcmfbocafanhdheifkidemldnld`)
     - `CHROME_PUBLISHER_ID` (`3e611cea-75d9-449e-97e1-8d95b11eb9be`)
     - `CHROME_REFRESH_TOKEN`
   - Confirmed no secrets were printed to logs or standard output.

## 4. Alternatives & Tradeoffs
- **Creating a New Cloud Project vs. Fixing the Existing Project**: Creating a second project (`omnijump-publiser`) would have required re-enabling APIs, configuring consent screens from scratch, and risking further policy mismatches. Fixing the existing `omnijump-extension` project by removing the logo preserved existing project quotas, verified domain ownership, and clean audit history.
- **Manual Token Minting (`urn:ietf:wg:oauth:2.0:oob`) vs. OAuth Playground**: Google deprecated the `oob` (out-of-band) flow in 2022. Using Google's official OAuth Playground with pre-authorized redirect URIs is the modern, compliant way to manually exchange authorization codes for permanent headless refresh tokens without running a local web server.

## 5. Verification
- **OAuth Server Token Refresh Check**:
   - Executed a direct programmatic token refresh against `https://oauth2.googleapis.com/token` using the new `refresh_token`, `client_id`, and `client_secret`.
   - Outcome: Received `HTTP 200 OK`, `has_access_token: True`, with `expires_in: 3599s`.
- **GitHub Secrets Validation**:
   - Ran `gh secret list -R David-MXu/OmniJump`.
   - Outcome: All five secrets (`CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_REFRESH_TOKEN`) confirmed updated.
