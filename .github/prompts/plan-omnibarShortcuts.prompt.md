Plan: Omnibar Shortcuts Roadmap
Goal: Build a high-performance browser extension that intercepts address bar inputs to instantly redirect users to custom destinations, utilizing Manifest V3 and declarativeNetRequest.

Target Browsers: Chrome (v120+) and Firefox (v128+). Tech Stack: TypeScript, Vite, CRXJS.

Step 1: Foundation & Build Pipeline
Objective: Establish a unified codebase that generates isolated, compliant builds for both Chrome and Firefox.

Project Initialization: Set up Vite with TypeScript and the @crxjs/vite-plugin.

Dynamic Manifest (src/manifest.ts):

Implement a script that accepts a browser argument ('chrome' | 'firefox').

Chrome Logic: Inject "background": { "service_worker": "..." }.

Firefox Logic: Inject "background": { "scripts": ["..."] } and the required browser_specific_settings ID.

Build Scripts: Configure package.json with targeted builds:

"build:chrome": Output to dist/chrome.

"build:firefox": Output to dist/firefox.

Permissions Strategy: Request <all_urls> (for broad interception), declarativeNetRequest, and storage upfront.

Step 2: Data Architecture & Sanitization
Objective: Define the data structure and safety limits for user shortcuts.

Schema Definition:

TypeScript
interface Shortcut {
  key: string;       // The trigger (e.g., "gh")
  url: string;       // The destination
  type: 'redirect' | 'bundle';
  // Future: 'script' or 'param'
}
Sanitization Logic:

Input: Force keys to be lowercase, trimmed, and space-free (e.g., "My Mail" -> "my-mail").

Limits: Enforce a hard cap of 5,000 shortcuts (matching the MAX_NUMBER_OF_DYNAMIC_RULES API limit).

Storage Wrapper: Implement a facade over chrome.storage.sync to handle reads, writes, and sync conflicts across devices.

Step 3: The Interception Engine (DNR)
Objective: Implement the core "zero-latency" redirect logic using Dynamic Rules.

The Regex Strategy:

Construct strict regex patterns to target search query parameters specifically.

Pattern: [?&]q=KEYWORD(?:&|$)

Goal: Ensure gh triggers the shortcut, but ghost or search?q=gh+stuff does not.

Rule Management:

Create a RuleManager class.

Action: When a user saves/deletes a shortcut, immediately call chrome.declarativeNetRequest.updateDynamicRules to sync the browser's network layer with the storage.

Lifecycle Handling: Ensure rules persist even when the Chrome Service Worker goes idle (native behavior of DNR).

Step 4: User Interface (UI)
Objective: Frictionless creation and management of shortcuts.

Popup UI:

Auto-Complete: On open, grab current tab URL and suggest a 2-3 letter acronym based on the domain.

Sanity Check: Warn user if the chosen keyword conflicts with an existing one.

Context Menus:

"Save Page as Shortcut..." (Right-click background).

"Save Link as Shortcut..." (Right-click anchor tags).

Options Page: A dashboard to view, edit, search, and delete the list of 5,000 potential shortcuts.

Step 5: Advanced Features
Objective: Productivity multipliers.

Bundles (Workspaces):

Data: Allow a single keyword to map to string[] (array of URLs).

Logic: Intercept the keyword -> Redirect current tab to URL #1 -> Use chrome.tabs.create for URL #2, #3, etc.

Smart Detection:

Use chrome.webNavigation (passive listener) to detect if a user is repeatedly visiting a search result (e.g., "Amazon search for X").

UX: Show a subtle badge or notification: "Want to make 'az' a shortcut for Amazon Search?"