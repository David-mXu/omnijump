# Chrome Web Store Submission — Your Tasks

These are the manual steps you need to complete before and after submitting to the Chrome Web Store.

---

## Developer Account

- [ ] Sign in at https://chrome.google.com/webstore/devconsole
- [ ] Pay the one-time $5 developer registration fee (if not already done)

---

## Store Listing Text

Review and edit these before pasting into the store dashboard.

**Short description** (≤132 chars):
> Save short keywords to instantly jump to URLs or open tab bundles from your browser's address bar.

**Detailed description**:
> Omnibar Shortcuts lets you create and manage short keywords that trigger instant redirects or open multiple tabs at once — all from the address bar.
>
> **Features:**
> - Redirect shortcuts: type a keyword → jump to any URL
> - Bundle shortcuts: type a keyword → open a set of tabs at once
> - Dynamic search shortcuts: embed {query} in a URL template
> - Side panel for managing all shortcuts
> - Import / Export your shortcuts as JSON
> - Smart tip: suggests saving sites you visit repeatedly
> - Stale shortcut auto-cleanup
> - Keyboard shortcut to open the panel (Ctrl+Shift+S)

**Category:** Productivity

**Language:** English

---

## Screenshots (required: 4–8)

Size: 1280×800 or 640×400. Suggested shots:

- [ ] Omnibar typing a shortcut keyword and being redirected
- [ ] Side panel showing the shortcut list
- [ ] Bundle builder with multiple URLs
- [ ] Settings tab

---

## Promotional Images

- [ ] **Store icon** (128×128): already available at `images/icon128.png` or use `images/icon1024.png`
- [ ] **Small promotional tile** (440×280 px) — required for featuring
- [ ] **Large promotional tile** (920×680 px) — optional but recommended
- [ ] **Marquee banner** (1400×560 px) — optional

---

## Privacy Policy

Claude has created `src/privacy.html` which is included in the extension. You still need to:

- [ ] Host the privacy policy at a public URL (e.g. GitHub Pages, or paste the content into a GitHub gist)
- [ ] Paste the public URL into the "Privacy policy" field in the store listing form

---

## Submission

- [ ] Upload `omnibar-shortcuts-1.0.0.zip` (Claude will create this) under "New Item" in the Developer Console
- [ ] Fill in the store listing form using the text above
- [ ] Upload screenshots and promotional images
- [ ] Paste the privacy policy URL
- [ ] Submit for review (typically 1–3 business days)

---

## After Approval

- [ ] Share the store listing URL with users
- [ ] Monitor reviews and crash reports in the Developer Console
