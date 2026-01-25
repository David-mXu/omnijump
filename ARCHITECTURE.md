# Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Omnibar Shortcuts                         │
│                     Browser Extension (MV3/MV2)                  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Popup UI   │         │  Background  │         │   Storage    │
│              │         │    Worker    │         │              │
│  popup.html  │◄───────►│ background.ts│◄───────►│ storage.ts   │
│  popup.ts    │         │              │         │              │
└──────────────┘         └──────────────┘         └──────────────┘
      │                         │                         │
      │                         │                         │
      ▼                         ▼                         ▼
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ User Actions │         │ URL Intercept│         │chrome.storage│
│              │         │              │         │    .sync     │
│ • Add shortcut        │ • webNavigate│         │              │
│ • Delete      │         │ • Match URL  │         │ {shortcuts}  │
│ • Export/Import       │ • Redirect   │         │ {bundles}    │
└──────────────┘         └──────────────┘         └──────────────┘
                                │
                                │
                         ┌──────┴──────┐
                         │             │
                         ▼             ▼
                  ┌──────────┐  ┌──────────┐
                  │ matcher.ts│  │ Context  │
                  │           │  │  Menu    │
                  │ Parse URL │  │          │
                  │ Match     │  │ Right-   │
                  │ Template  │  │ click    │
                  └──────────┘  │ save     │
                                └──────────┘
```

## Flow Diagram: Shortcut Activation

```
User types "gh javascript" in Google search
                │
                ▼
    Google Search URL loaded
    (www.google.com/search?q=gh+javascript)
                │
                ▼
    webNavigation.onBeforeNavigate event
                │
                ▼
    background.ts: handleNavigation()
                │
                ▼
    Check if URL is search engine → YES
                │
                ▼
    matcher.ts: parseUrlForShortcut()
    Extract: keyword="gh", query="javascript"
                │
                ▼
    storage.ts: getShortcuts()
    Load shortcuts from chrome.storage.sync
                │
                ▼
    matcher.ts: matchShortcut()
    Find "gh" → https://github.com/search?q=%s
                │
                ▼
    Replace %s with "javascript"
    Result: https://github.com/search?q=javascript
                │
                ▼
    chrome.tabs.update() - Redirect to GitHub
                │
                ▼
    User sees GitHub search results
```

## Component Details

### Popup UI (popup.ts)
**Responsibilities:**
- Render shortcuts list
- Handle add/delete operations
- Import/export JSON
- Tab navigation
- Form validation

**Key Functions:**
- `renderShortcuts()`: Display all shortcuts
- `addShortcut()`: Validate and save new shortcut
- `exportShortcuts()`: Download JSON backup
- `importShortcuts()`: Restore from JSON

### Background Worker (background.ts)
**Responsibilities:**
- Intercept navigation events
- Match URLs against shortcuts
- Redirect matched URLs
- Manage context menus
- Handle inter-component messaging

**Key Functions:**
- `handleNavigation()`: Main interception logic
- `isSearchEngine()`: Filter URLs
- `initialize()`: Set up listeners

### Storage Manager (storage.ts)
**Responsibilities:**
- CRUD operations for shortcuts
- Bundle management (future)
- Data serialization
- Sync with chrome.storage.sync

**Key Functions:**
- `getShortcuts()`: Retrieve all
- `saveShortcuts()`: Persist data
- `addShortcut()`: Create new
- `removeShortcut()`: Delete
- `exportData()`: Serialize to JSON
- `importData()`: Parse and restore

### Matcher (matcher.ts)
**Responsibilities:**
- Parse search engine URLs
- Extract keywords and queries
- Match keywords against shortcuts
- Template substitution (%s)

**Key Functions:**
- `parseUrlForShortcut()`: Extract keyword from URL
- `matchShortcut()`: Find matching shortcut
- `checkInterception()`: Full pipeline

## Data Flow

```
┌──────────────────────────────────────────────────────────┐
│                     User Input                            │
└────────────┬─────────────────────────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌─────────┐      ┌─────────┐
│ Popup   │      │ Browser │
│         │      │ Omnibar │
└────┬────┘      └────┬────┘
     │                │
     │ Add/Delete     │ Search Query
     │                │
     ▼                ▼
┌─────────────────────────┐
│   chrome.storage.sync   │
│                         │
│ { "gh": {              │
│   keyword: "gh",       │
│   target: "github.com" │
│ }}                      │
└──────────┬──────────────┘
           │
           │ Read on Navigation
           ▼
    ┌──────────────┐
    │ Background   │
    │ Worker       │
    │              │
    │ • Listen     │
    │ • Match      │
    │ • Redirect   │
    └──────────────┘
```

## Technology Stack

- **Language**: TypeScript
- **Build**: tsc (TypeScript Compiler)
- **Storage**: chrome.storage.sync API
- **APIs**:
  - webNavigation (URL interception)
  - contextMenus (right-click save)
  - tabs (redirection)
  - runtime (messaging)
- **Manifest**: V3 (Chrome), V2 (Firefox)
