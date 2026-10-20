# Onboarding Centering Architecture & Logo Unification

## 1. Problem Description & Symptoms
Users reported two visual bugs upon opening the extension:
1. **Onboarding Page Alignment**: The full-page onboarding welcome screen (`src/onboarding.html`) was not horizontally centered on wide screens. Instead, it was pinned directly against the left browser window edge.
2. **Logo Consistency**: Inquiries arose regarding keeping the original logo. An inspection revealed that while `popup.html`, `sidepanel.html`, and `onboarding.html` featured OmniJump's circular jump loop arrow, `options.html` displayed an inconsistent diagonal external-link arrow (`M9 15 15 9...`).

## 2. Root Cause Analysis
- **CSS Cascade & Vite Injected Stylesheet Order**:
  - In `src/onboarding.html` and `src/options.html`, layout rules (`body { margin: 0 auto; max-width: 620px; }`) were defined within an inline `<style>` block in the HTML `<head>`.
  - The script entry points (`onboarding.ts`, `options.ts`) imported `./theme.css`. During the Vite build, the bundled `<link rel="stylesheet" href="/assets/theme-*.css">` tag was placed after the `<style>` block in `<head>`.
  - `theme.css` contained a base element reset: `body { margin: 0; padding: 0; }`.
  - Because rules of equal specificity (`body`) obey source order, `theme.css`'s `margin: 0` silently superseded `margin: 0 auto`. With `margin: 0`, the constrained-width element anchored itself to the left edge of the viewport.

## 3. Investigation & Implementation Steps
1. **Defensive Flexbox Centering Container**:
   - Replaced bare `body` layout dependencies with an outer-inner flex container pattern:
     ```css
     body {
       margin: 0;
       padding: 0;
       display: flex;
       justify-content: center;
       min-height: 100vh;
       background: var(--background);
       color: var(--foreground);
     }
     .onboarding-container {
       width: 100%;
       max-width: 640px;
       margin: 0 auto;
       padding: 48px var(--s5) 64px;
       box-sizing: border-box;
     }
     ```
   - Wrapped all onboarding content inside `<div class="onboarding-container">`. This guarantees proper centering on any monitor aspect ratio or viewport width, immune to external margin resets.
   - Applied the identical `.page-container` pattern to `src/options.html`.
2. **Logo Unification Across All Surfaces**:
   - Verified that the official PNG icon files (`images/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`) in the repository and manifest were never touched.
   - Corrected the SVG mark in `src/options.html` from the diagonal arrow to OmniJump's canonical circular jump arrow:
     ```html
     <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
       <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor"/>
       <path d="M12 17.5A5.5 5.5 0 1 1 17.5 12" stroke="#fff" stroke-width="1.8"
             stroke-linecap="round" fill="none"/>
       <path d="M14.5 9.5 l3 2.5 -3.5 1" stroke="#fff" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round"/>
     </svg>
     ```
   - Now, all 4 HTML surfaces (`popup`, `sidepanel`, `options`, `onboarding`) render the identical signature logo in cobalt blue.

## 4. Alternatives & Tradeoffs
- **Overriding `body` via `!important`**: Applying `margin: 0 auto !important` on `body` could overcome cascade order, but relying on `!important` on root tags is brittle and easily breaks if future wrappers or dev overlays mount into `body`. Encapsulating layout inside an explicit container (`.onboarding-container`) with flex parent centering is modern and robust.

## 5. Verification
- **Test Suite**: Vitest passed all 99 unit tests across 4 test suites (`npm test`).
- **Type Checking**: 0 TypeScript diagnostics (`npx tsc --noEmit`).
- **Builds**: `npm run build:all` compiled both `dist/chrome` and `dist/firefox` cleanly.
