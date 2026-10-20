# OmniJump Signature Cobalt Color Scheme & Visual Identity

## 1. Problem Description & Feature Goal
Following the initial adoption of a monochromatic Zinc styling pass, the interface became starkly black and white:
- Primary buttons and submit actions were pure black (`#18181b` / `#09090b`), stripping away the friendly, approachable visual identity of OmniJump.
- Brand marks, active tab indicators, links, and focus rings were rendered in muted grays or harsh blacks.
- Badges and keycaps lost their color-coded signifiers (bundles vs. parameterized searches), degrading visual scannability in dense shortcut lists.

The goal was to restore and elevate OmniJump's original **signature cobalt blue** (`#1668C9`) as the core brand color, harmonizing high-craft typography, tactile mechanical keycaps, and vibrant accents across all extension surfaces (`sidepanel`, `options`, `popup`, and `onboarding`).

## 2. Concepts & Visual Architecture
- **Brand Anchor & Accent Hierarchy**:
  - In utility browser extensions, the primary action button must look unequivocally actionable. Using pure black on white creates a stark, brutalist aesthetic that often feels intimidating or sterile.
  - Anchoring on OmniJump's signature cobalt blue (`#1668C9`) gives high contrast (4.8+:1 WCAG AA compliant on pure white) while conveying speed, reliability, and precision.
  - A three-tier accent scale:
    - `--accent` (`#1668C9`): Base action color for primary buttons, active tabs, brand icons, and focused inputs.
    - `--accent-hover` (`#0e52a8`) / `--accent-active` (`#0a3d7a`): Deeper cobalt shades providing tactile press feedback.
    - `--accent-weak` (`#edf5ff`) & `--accent-border` (`#c4dfff`): Soft, airy cobalt washes for bundle chips, suggestion banners, and keyboard row focus hints.
- **Physical Mechanical Keycap Design**:
  - Shortcuts in OmniJump represent keyboard sequences. Giving keys a physical 3D keycap treatment—subtle light background (`#f8fafc`), crisp border (`#cbd5e1`), a slightly darker bottom bevel border (`#94a3b8`), and micro-shadow—makes them instantly recognizable as physical keys rather than generic text tags.
- **Semantic Badge Signifiers**:
  - Bundle shortcuts use the cobalt wash chip (`--badge-bg: var(--accent-weak); color: var(--accent)`).
  - Parameterized dynamic search shortcuts use an emerald green chip (`#ecfdf5` background, `#059669` text, `#a7f3d0` border) to differentiate multi-tab openers from query templates at a single glance.

## 3. Implementation Steps
1. **Design Tokens Refactor in [`src/theme.css`](file:///home/davidxu/Programming/Extensions/OmniJump/src/theme.css)**:
   - Defined light palette: `--accent: #1668C9`, `--accent-hover: #0e52a8`, `--accent-weak: #edf5ff`, `--accent-border: #c4dfff`.
   - Wired `--primary`, `--primary-hover`, and `--primary-foreground` directly to `--accent` and `--on-accent` (`#ffffff`), instantly restoring vivid cobalt action buttons.
   - Updated `.btn-primary` with gentle cobalt drop shadows (`0 1px 2px rgba(22, 104, 201, 0.25)`) and hover elevation.
   - Refined `.btn-link` with `color: var(--accent)`.
   - Updated keyboard row focus indicators (`li:focus`) with an inset 3px cobalt rail (`box-shadow: inset 3px 0 0 var(--accent)`).
   - Designed dark mode counterpart: `--accent: #4da3ff` (electric cobalt sky), `--accent-hover: #6cb3ff`, `--accent-weak: rgba(77, 163, 255, 0.14)` on rich dark slate surfaces (`#0f1117`).
2. **Sidepanel Surface Polish in [`src/sidepanel.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/sidepanel.html)**:
   - Restored brand icon and logo accent: `.brand-mark { color: var(--accent); }` and `.brand-name b { color: var(--accent); }` (highlighting the "Jump" in Omni**Jump**).
   - Updated segmented navigation: `.tab.active` highlights in cobalt text (`color: var(--accent)`) on an elevated white card, and inactive tabs hint cobalt on hover.
   - Restored the smart suggestion banner (`#suggestion`) with a gentle blue background and a 4px cobalt left accent bar.
3. **Options Full-Page Polish in [`src/options.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/options.html)**:
   - Aligned page header with the brand cobalt mark and title accent.
   - Applied the cobalt active tab state and smart suggestion banner.
   - Restored the `#customizeShortcut` keyboard configuration action with accent text and blue-tinted hover.
4. **Popup Quick-Save Polish in [`src/popup.html`](file:///home/davidxu/Programming/Extensions/OmniJump/src/popup.html)**:
   - Restored cobalt brand header and suggestion banner.
   - Enhanced the `#openPanel` button with a cobalt hover accent state.

## 4. Alternatives & Tradeoffs
- **Pure Monochromatic (Zinc) vs. Brand Cobalt**: While grayscale themes can look minimal in static design screenshots, they eliminate semantic hierarchy in real usage. Users struggle to distinguish primary actions from secondary utilities, and multi-url bundles look identical to single redirects. Reintroducing cobalt preserves clean modern lines while delivering immediate visual legibility.
- **Flat vs. 3D Keycaps**: Flat tags require less CSS, but a 2px bottom border bevel with micro-shadow gives `<kbd>` and `.key` elements unmistakable physicality that directly reinforces the keyboard-centric identity of the extension.

## 5. Verification
- **Automated Tests**: Ran `npm test` via Vitest. All 99 unit tests across `suggest.test.ts`, `storage.test.ts`, `dnr.test.ts`, and `fuzzy.test.ts` passed.
- **Type Checking**: Ran `npx tsc --noEmit`—0 errors reported.
- **Production Builds**: Executed `npm run build:all`—both Chrome (`dist/chrome`) and Firefox (`dist/firefox`) built cleanly.
