# Two-Step Delete Confirmation & Dark Mode Surface Polish

## 1. Problem Description & Feature Goal
OmniJump is heavily keyboard-driven: users navigate the shortcuts list using `j` and `k` (or arrow keys), open shortcuts with `Enter` or `l`, and edit with `e`. Previously, pressing `d` or `Delete` (or clicking the trash icon) immediately deleted the shortcut from storage and only provided an Undo toast.

In fast-paced keyboard workflows, an accidental press of `d` while navigating with `j`/`k` would instantly delete a keyword shortcut. The goal was to implement a non-blocking, two-step verification mechanic:
- The first `d` keypress (or trash click) puts the shortcut row into a pending confirmation state with visual cues and a prompt: *"Delete '{key}'? Press 'd' again to confirm"*.
- A second `d` keypress (or trash click) on that same shortcut confirms and executes the deletion, followed by the reversible Undo toast.
- The pending confirmation can be cancelled immediately at any time by pressing `Escape`, navigating away with `j`/`k`, triggering delete on another row, or simply waiting 4 seconds.
- Additionally, ensure dark mode styling, native browser controls (`color-scheme: dark`), and real-time settings listeners are fully verified across all extension surfaces (`sidepanel`, `options`, `popup`, `onboarding`).

## 2. Concepts & State Machine Architecture
- **Transient Keyboard Confirmation State Machine**:
  - Modal dialogs (such as `window.confirm()`) are notorious anti-patterns in browser extensions: they block JavaScript execution, freeze background threads, and trap focus.
  - An inline state machine maintains transient state in memory:
    $$\text{Idle} \xrightarrow{\text{press 'd'}} \text{PendingConfirm}(key, timer) \xrightarrow{\text{press 'd' again}} \text{Deleted}$$
    $$\text{PendingConfirm}(key, timer) \xrightarrow{\text{Escape } | \text{ navigate } | \text{ timeout } | \text{ click outside}} \text{Idle}$$
  - **Single Active Primed Target**: Only one row can be pending deletion at any given time. Triggering delete on row B immediately disarms row A and arms row B.
  - **Strict Cancellation Boundaries**:
    - `Escape` key immediately disarms and dismisses the prompt.
    - Moving focus via `j`, `k`, `ArrowDown`, or `ArrowUp` immediately disarms the primed shortcut so an accidental second keypress on a new row never deletes the previous one.
    - A 4000ms timer resets the state automatically if no action is taken.
- **Native Browser Control Theming (`color-scheme`)**:
  - Setting `color-scheme: dark` on `body.dark` instructs the browser engine (Blink / Gecko) to render native form controls, checkboxes, and scrollbars with dark backgrounds and light thumbs, avoiding glaring white scrollbars in dark mode.
- **Live Sync Across Extension Views**:
  - The popup and onboarding pages now listen to `chrome.storage.onChanged` for `SETTINGS_KEY`, guaranteeing immediate dark mode toggling even if settings are updated in the side panel or options tab simultaneously.

## 3. Implementation Steps
1. **Confirmation State Management in [`src/ui.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/ui.ts)**:
   - Exported `pendingDeleteKey: string | null` and `cancelPendingDelete(): void`.
   - Added `showDeleteConfirmToast(key, onCancel)` to display:
     `Delete <strong>${key}</strong>? Press <kbd class="kbd">d</kbd> again to confirm` with a `Cancel` button.
   - Refactored `deleteBtn` click handler:
     - If `pendingDeleteKey === shortcut.key`: calls `cancelPendingDelete()`, deletes the shortcut via `deleteShortcut()`, re-renders the list via `onRender()`, and triggers `showUndoToast()`.
     - Else: arms the shortcut, applies `.pending-delete` to the row, applies `.confirm-delete` to the delete button, updates accessibility labels, displays the toast, and starts a 4-second safety auto-cancel timer.
   - Added global `Escape` and document click listeners to dismiss pending delete when clicking outside.
2. **Keyboard Navigation Integration in [`src/sidepanel.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/sidepanel.ts) & [`src/options.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/options.ts)**:
   - Handled `Escape`: if `pendingDeleteKey` is set, calls `cancelPendingDelete()` and marks the event as handled.
   - Disarmed pending delete upon row navigation (`j`, `k`, `ArrowDown`, `ArrowUp`), row activation (`Enter`, `l`), row editing (`e`), select mode toggling, and list refreshes.
3. **Visual Cues & Styling in [`src/theme.css`](file:///home/davidxu/Programming/Extensions/OmniJump/src/theme.css)**:
   - Styled `li.pending-delete`: highlights the row with a soft crimson background (`var(--destructive-weak)`) and a 3px inset crimson border rail (`box-shadow: inset 0 0 0 1px var(--destructive), inset 3px 0 0 var(--destructive)`).
   - Styled `.btn-icon.confirm-delete`: reveals the trash button with full opacity (`opacity: 1`), crimson color, and a 2px outline.
   - Styled `.delete-confirm-toast`: floating popover card with a destructive warning border, mechanical `<kbd>d</kbd>` keycap chip, and a subtle Cancel button.
   - Added `color-scheme: dark` to `body.dark` and `color-scheme: light` to `body`.
4. **Live Dark Mode Sync in [`src/popup.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/popup.ts) & [`src/onboarding.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/onboarding.ts)**:
   - Registered `chrome.storage.onChanged` listener for `SETTINGS_KEY` to dynamically toggle `body.classList.toggle('dark', newSettings?.darkMode ?? false)`.
5. **Brand Icon Unification & Tab Favicons**:
   - Replaced custom SVGs in all headers ([`src/options.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/options.html), [`src/onboarding.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/onboarding.html), [`src/sidepanel.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/sidepanel.html), and [`src/popup.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/popup.html)) with direct references to the official "O with arrow on top" icon (`images/icon32.png` and `images/icon48.png`), guaranteeing 100% brand consistency between toolbar icons, browser tabs, and page headers.
   - Added complete multi-size `<link rel="icon">` (128x128, 32x32, 16x16) and `shortcut icon` links across all extension pages.
   - Bumped extension version to `1.2.1` in [`package.json`](file:///home/davidxu/Programming/Extensions/OmniJump/package.json), forcing Chromium (Edge and Chrome) to invalidate stale internal extension icon caches in `edge://extensions` and `chrome://extensions`.
6. **DOM Mocking & Automated Unit Testing**:
   - Created in-memory DOM representation in [`src/test/dom-mock.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/test/dom-mock.ts) supporting element tree hierarchy, class manipulation, event dispatching, and selector matching.
   - Created [`src/ui.test.ts`](file:///home/davidxu/Programming/Extensions/OmniJump/src/ui.test.ts) covering:
     1. Two-step deletion requirement: first click arms pending state and renders confirmation prompt; second click executes deletion and renders Undo toast.
     2. Escape cancellation: pressing `Escape` clears pending state without deleting the shortcut.
     3. Auto-cancellation timeout: advancing fake timers by 4001ms resets the row and clears the toast.
     4. Row switching: priming row A then clicking delete on row B disarms row A and arms row B without deleting row A.

## 4. Alternatives & Tradeoffs
- **Blocking `window.confirm` vs. Two-Step Keyboard State**: `window.confirm` is jarring and interrupts fluent typing in vim-style navigation. Two-step keyboard confirmation keeps the user in flow: double-tapping `d` deletes in milliseconds without reaching for the mouse or hitting Enter on a dialog.
- **Permanent Priming vs. Auto-Expiry**: Allowing a row to stay permanently primed poses a risk: if the user looks away and returns minutes later, pressing `d` could inadvertently delete the row. A 4000ms timeout strikes the ideal balance between deliberate action and safety.
- **Undo Toast vs. Confirmation**: Some tools use *only* Undo toasts; however, once deleted, DNR rules are rebuilt immediately and the address-bar keyword temporarily disappears. Combining two-step verification with the existing 6-second Undo toast provides defense in depth: accidental first presses are prevented entirely, and accidental second presses can still be restored instantly.

## 5. Verification
- **Unit Tests**: Ran `npm test` using Vitest across 5 test files (`fuzzy.test.ts`, `dnr.test.ts`, `storage.test.ts`, `suggest.test.ts`, `ui.test.ts`). All **103 unit tests passed** (100% pass rate).
- **TypeScript Type Checking**: Ran `npx tsc --noEmit`—**0 errors found**.
- **Cross-Browser Production Builds**: Ran `npm run build:all`. Both targets built cleanly:
  - Chrome build: `dist/chrome` (25 modules transformed in 265ms).
  - Firefox build: `dist/firefox` (25 modules transformed in 238ms).
