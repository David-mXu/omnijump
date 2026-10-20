# Extension Keyboard Shortcuts & Browser Collision Mitigation

## 1. Problem Description & Feature Goal
Users reported that the default keyboard shortcut for opening the OmniJump side panel (`Ctrl+Shift+S`) conflicted directly with Microsoft Edge's native **Web Capture** (screenshot tool) as well as Firefox Screenshots. Furthermore, the extension lacked an out-of-the-box keyboard shortcut for triggering the extension popup (`_execute_action`).

The goal was twofold:
1. Rebind the side panel shortcut away from `Ctrl+Shift+S` to an ergonomic combination that avoids native browser collisions across Chrome, Edge, and Firefox.
2. Define a default keyboard shortcut for the extension popup (`_execute_action`) in both Chrome and Firefox targets, while ensuring fallback documentation in the onboarding guide and settings page remains accurate.

## 2. Root Cause & Underlying Concepts
- **Browser-Reserved Key Combinations**:
  - `Ctrl+Shift+S`: Hard-coded by Microsoft Edge for Web Capture / Screenshot, Firefox for Firefox Screenshots, and Google Chrome for the native Chrome Side Panel. Because native browser shortcuts take precedence over extension commands, pressing `Ctrl+Shift+S` in Edge or Firefox failed to open OmniJump reliably.
- **The Blast Radius of Single-Modifier `Alt` Combinations**:
  - Combinations such as `Alt+A` or `Alt+S` are attractive due to their ergonomic, single-hand reach. However, as shipping extension defaults:
    - `Alt+S` is a ubiquitous shortcut in web apps (e.g., Gmail and Outlook Web use `Alt+S` to send emails; Jira, GitHub, and Reddit use it to save or submit comments). Overriding it interrupts text editing workflows.
    - On macOS, `Alt` maps to the `Option` (`⌥`) key. `Option+A` types `å` (Swedish) and `Option+S` types `ß` (German sharp s). Without platform-specific overrides, mapping `Alt+A` or `Alt+S` breaks character input in text areas on Mac.
    - Multilingual Windows setups (such as Polish Programmer layouts) treat Right-Alt as `AltGr`. `AltGr+A` yields `ą` and `AltGr+S` yields `ś`.
- **Manifest V3 `commands` API**:
  - Chrome and Firefox support default suggested keys through `commands` in `manifest.json`.
  - `_execute_action` is a special reserved command in Manifest V3 that automatically toggles the extension popup without requiring background event listeners.
  - For side panels, Firefox provides the reserved `_execute_sidebar_action` command, while Chrome uses a custom command identifier (here: `open-side-panel`) handled in `src/background.ts` by `chrome.commands.onCommand`.

## 3. Investigation & Implementation Steps
1. **Auditing Manifest and UI Surfaces**:
   - Inspected [`src/manifest.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/manifest.ts) to see how commands were registered for Chrome and Firefox targets.
   - Checked [`src/onboarding.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/onboarding.html) and [`src/onboarding.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/onboarding.ts): observed that `onboarding.ts` dynamically fetches the bound keys using `chrome.commands.getAll()`, but has static HTML fallback text that specifically listed `Ctrl+Shift+S`.
   - Checked [`docs/settings.html`](file:///home/davidxu/Programming/Extensions/OmniJump/docs/settings.html) for outdated shortcut examples.
2. **Selecting Collision-Resistant Default Shortcuts**:
   - Evaluated candidate pairings against browser hotkey registries (Chrome, Edge, Firefox, macOS).
   - Selected:
     - **Side Panel (`open-side-panel` / `_execute_sidebar_action`)**: `Alt+Shift+A` (mac: `Alt+Shift+A`).
     - **Popup (`_execute_action`)**: `Alt+Shift+S` (mac: `Alt+Shift+S`).
   - Adding `Shift` to the user's preferred `A` and `S` keys eliminates web app form submission conflicts (`Alt+S`) and prevents hijacking single-modifier accented letter keystrokes (`å`, `ß`, `ą`, `ś`).
3. **Updating Manifest Generator in [`src/manifest.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/manifest.ts)**:
   - Configured `_execute_sidebar_action` (Firefox) and `open-side-panel` (Chrome) with `suggested_key: { default: 'Alt+Shift+A', mac: 'Alt+Shift+A' }`.
   - Configured `_execute_action` for both targets with `suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' }`.
4. **Updating Static Fallbacks & Documentation**:
   - In [`src/onboarding.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/onboarding.html), updated the static `<span id="panelShortcut">` fallback to `Alt+Shift+A`.
   - In [`docs/settings.html`](file:///home/davidxu/Programming/Extensions/OmniJump/docs/settings.html), updated the example shortcut reference to `<kbd>Alt+Shift+A</kbd>`.

## 4. Alternatives & Tradeoffs
- **Bare `Alt+A` & `Alt+S`**:
  - *Pros*: Extremely fast two-key reach for left hand.
  - *Cons*: Collides with Gmail/Jira/Outlook "Send/Save" (`Alt+S`), Zoom microphone mute (`Alt+A`), and character composition on macOS (`Option+A` / `Option+S`).
  - *Resolution*: Users who strongly prefer bare two-key chords can still manually rebind to `Alt+A` and `Alt+S` via `chrome://extensions/shortcuts` or the settings page's "Customize shortcuts" button.
- **`Alt+Shift+O` & `Alt+Shift+J`**:
  - Mnemonic for OmniJump (`oj`), but less ergonomic than home-row adjacent `A` and `S`.
- **`Ctrl+Shift+Y`**:
  - Neutral cross-browser key with zero collisions, but lacks ergonomic and mnemonic intuition.

## 5. Verification
- **Type Checking**: Ran `npx tsc --noEmit` — 0 TypeScript diagnostic errors.
- **Unit Tests**: Ran `npm test` via Vitest — all 103 tests in 5 suites passed cleanly.
- **Multi-Target Builds**: Ran `npm run build:all`.
  - Inspected `dist/chrome/manifest.json`: verified both `open-side-panel` (`Alt+Shift+A`) and `_execute_action` (`Alt+Shift+S`) generated properly.
  - Inspected `dist/firefox/manifest.json`: verified both `_execute_sidebar_action` (`Alt+Shift+A`) and `_execute_action` (`Alt+Shift+S`) generated properly.
