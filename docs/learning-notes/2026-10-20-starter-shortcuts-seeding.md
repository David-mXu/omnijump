# Seeding Default Starter Shortcuts in OmniJump

## 1. Problem Description & Feature Goal
When new users installed OmniJump, their shortcut store started empty (`0 shortcuts`). While an onboarding page introduced the address-bar jump concept, the user had to manually create their first shortcut before experiencing the core functionality.

The goal was to provide an out-of-the-box, high-utility starter list of shortcuts seeded automatically on first installation (`onInstalled`), along with an on-demand button in the UI (both in the empty state and under Settings) so existing users and testers can load or restore starter presets without overwriting their custom shortcuts.

## 2. Concepts & Architecture
- **Curated Preset Catalog (`STARTER_SHORTCUTS`)**: A list of 17 widely used shortcuts balancing direct navigation and parameterized searches:
  - Developer & Code: `gh`, `github` (GitHub).
  - Search & Discovery: `yt` (YouTube `%s`), `wiki` (Wikipedia `%s`), `maps` (Google Maps `%s`), `reddit` (Reddit `%s`), `pplx` (Perplexity `%s`).
  - Productivity & Workspace: `cal` (Google Calendar), `mail` (Gmail), `drive` (Google Drive), `docs` (Google Docs), `notion` (Notion).
  - AI Assistants: `chat`, `gpt` (ChatGPT), `claude` (Claude AI), `grok` (Grok).
  - Email: `outlook` (Outlook Web).
- **Idempotent Seeding (`seedStarterShortcuts`)**:
  - The seeder checks `store.shortcuts`. If a shortcut with that normalized key already exists, it is preserved (never overwritten unless explicitly requested).
  - Stamps `createdAt` with the current timestamp and initializes `useCount: 0`.
  - Batch writes new entries to `chrome.storage.sync` in a single operation.
- **Service Worker Lifecycle Integration**:
  - In `chrome.runtime.onInstalled`, when `details.reason === 'install'`, `seedStarterShortcuts()` is awaited before calling `syncRules()`, ensuring Declarative Net Request (DNR) rules are immediately generated and functional.
- **UI Availability**:
  - When the list is empty, a *"Load starter shortcuts"* button appears directly inside the empty state.
  - In the Settings panel under **Data**, users can click *"Load starter shortcuts"* at any time to append missing presets.

## 3. Investigation & Implementation Steps
1. **Defined Preset Catalog in [`src/types.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/types.ts)**:
   - Added `STARTER_SHORTCUTS` containing all 17 shortcut objects with proper `type`, `url`, `urlTemplate`, and `label`.
2. **Implemented Seeder in [`src/storage.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/storage.ts)**:
   - Implemented `seedStarterShortcuts(overwriteExisting = false): Promise<number>`, returning the count of new shortcuts added.
3. **Wired First-Run Hook in [`src/background.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/background.ts)**:
   - Awaited `seedStarterShortcuts()` inside `chrome.runtime.onInstalled.addListener` when `details.reason === 'install'`.
4. **Added UI Buttons & Handlers in [`src/sidepanel.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/sidepanel.html), [`src/options.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/options.html), [`src/sidepanel.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/sidepanel.ts), and [`src/options.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/options.ts)**:
   - Added `loadStarterBtn` to the empty state container and `loadStarterSettingsBtn` to the Settings Data card.
   - Connected `handleLoadStarter()` to seed presets, display feedback, and refresh the UI.
5. **Unit Test Coverage in [`src/storage.test.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/storage.test.ts)**:
   - Verified that all 17 shortcuts are seeded into an empty store.
   - Verified that pre-existing custom shortcuts with the same key are not overwritten.

## 4. Alternatives & Tradeoffs
- **Hardcoding into Rules vs. Populating Sync Storage**: Rather than hardcoding default shortcuts into background DNR rules where users couldn't see, edit, or delete them, seeding them into `chrome.storage.sync` treats defaults as first-class user shortcuts. Users can rename `yt` to `y`, change the URL, or delete presets they don't want.
- **Selective Seeding vs. Total Replacement**: Defaulting `overwriteExisting = false` ensures that existing users clicking "Load starter shortcuts" get new suggestions without losing their custom definitions.

## 5. Verification
- **Automated Tests**: Ran `npm test` (vitest) — all 99 tests passed across 4 test suites.
- **Type Checking**: Ran `npx tsc --noEmit` — 0 TypeScript diagnostics.
- **Extension Builds**: Ran `npm run build:all` — cleanly generated both Chrome (`dist/chrome`) and Firefox (`dist/firefox`) bundles.
- **Packaging**: Re-generated `dist/omnijump-chrome-v1.2.0.zip` (82 KB) and `dist/omnijump-firefox-v1.2.0.zip` (82 KB).
