# Implementation Guide: Omnibar Shortcuts

This document outlines how the implementation addresses each step in the roadmap plan.

## Step 1: Audit Manifests and Popup Behavior ✅

### Manifest V3 (Chrome) - `manifest.json`
- **Service Worker**: Background script defined as `service_worker` with ES module support
- **Permissions**: Includes `storage`, `declarativeNetRequest`, `contextMenus`
- **Host Permissions**: `<all_urls>` for URL interception across all sites
- **Action**: Popup UI configured with icon paths

### Manifest V2 (Firefox) - `manifest.firefox.json`
- **Background Scripts**: Traditional background scripts array
- **Permissions**: Uses `webNavigation` instead of `declarativeNetRequest`
- **Browser Action**: Firefox-compatible popup configuration

### Popup UI - `popup.html` & `src/popup.ts`
- **Tabbed Interface**: Shortcuts management and Settings tabs
- **Form Inputs**: Keyword and target URL with validation
- **Shortcuts List**: Dynamic rendering with delete functionality
- **Import/Export**: JSON file handling for backup/restore

## Step 2: Data Schema and Matching Algorithm ✅

### Storage Schema (`src/storage.ts`)

```typescript
interface Shortcut {
  keyword: string;        // The shortcut keyword (e.g., "gh")
  target: string;         // Target URL with optional %s template
  createdAt: number;      // Timestamp
  bundleId?: string;      // Optional bundle reference
}

interface Bundle {
  id: string;
  name: string;
  shortcuts: string[];    // Array of keyword references
}
```

**Storage Location**: `chrome.storage.sync` for cross-device synchronization

**Storage Manager**:
- `getShortcuts()`: Retrieve all shortcuts
- `saveShortcuts()`: Persist shortcuts
- `addShortcut()`: Add new shortcut with validation
- `removeShortcut()`: Delete by keyword
- `exportData()`: Serialize to JSON
- `importData()`: Restore from JSON

### Matching Algorithm (`src/matcher.ts`)

**URL Parsing**:
1. Extract search query from common search engines (Google, Bing, DuckDuckGo, etc.)
2. Parse query parameters (`q`, `search`, `query`, `s`)
3. Split query into keyword and search terms

**Matching Logic**:
1. First word of search query is extracted as potential keyword
2. Lookup keyword in shortcuts dictionary
3. If found and target contains `%s`:
   - Replace `%s` with URL-encoded search terms
4. If found without `%s`:
   - Return exact target URL
5. If not found:
   - Return null (allow search to proceed normally)

**Edge Cases Handled**:
- Invalid URLs
- Missing search queries for template shortcuts
- Multiple words in search query
- Special characters in keywords

## Step 3: Interception Flow ✅

### Implementation Choice: webNavigation API

**Rationale**:
- More flexible for user-defined shortcuts
- Supports dynamic keyword matching
- Works with search templates (`%s`)
- No rule count limits

**Alternative Considered**: declarativeNetRequest
- See `src/declarativeNetRequest.ts` for detailed analysis
- More performant but too rigid for this use case
- Limited to static redirects without query parsing

### Interception Flow (`src/background.ts`)

1. **Event Listener**: `chrome.webNavigation.onBeforeNavigate`
   - Listens for all navigation events
   - Filters for main frame only (`frameId === 0`)

2. **Search Engine Detection**:
   - Whitelist of common search engines
   - Only intercepts searches, not all navigation

3. **Keyword Extraction**:
   - Parse URL using matcher algorithm
   - Extract keyword from search query

4. **Shortcut Matching**:
   - Lookup keyword in stored shortcuts
   - Apply template substitution if needed

5. **Redirection**:
   - Use `chrome.tabs.update()` to redirect tab
   - Original search is cancelled

**URL Patterns Intercepted**:
- `www.google.com/search?q=*`
- `www.bing.com/search?q=*`
- `duckduckgo.com/?q=*`
- `search.yahoo.com/search?p=*`
- `www.baidu.com/s?wd=*`

**No Search Fallback**: If keyword doesn't match, the original search proceeds normally.

## Step 4: UI and Context Menu Workflows ✅

### Popup Creation Flow

**Adding a Shortcut**:
1. User clicks extension icon
2. Enters keyword (validated for non-empty)
3. Enters target URL (validated as valid URL)
4. Clicks "Add Shortcut" or presses Ctrl+Enter
5. Shortcut saved to `chrome.storage.sync`
6. UI refreshes to show new shortcut
7. Input fields cleared for next entry

**Validation**:
- Keyword: Required, trimmed
- Target: Required, must be valid URL (supports `%s` placeholder)

### Auto-Suggestion (Future Enhancement)

Current implementation doesn't include auto-suggestions. Planned features:
- Suggest keywords based on typing
- Show recently used shortcuts
- Highlight frequently used shortcuts

### Right-Click Saves (Context Menu)

**Implementation**:
1. Context menu item: "Save as Shortcut"
2. Available on links and pages
3. Clicking stores URL in `chrome.storage.local` temporarily
4. When popup opens, it checks for pending URL
5. If found, pre-fills target field
6. User enters keyword to complete

**Flow**:
```
Right-click → "Save as Shortcut" → Opens popup → URL pre-filled → Enter keyword → Save
```

### Export/Import

**Export**:
1. Navigate to Settings tab
2. Click "Export Shortcuts"
3. JSON file downloaded with timestamp
4. Filename: `omnibar-shortcuts-YYYY-MM-DD.json`

**Import**:
1. Navigate to Settings tab
2. Click "Import Shortcuts"
3. Select JSON file
4. Shortcuts merged with existing (overwrites duplicates)
5. Success notification shown

**JSON Format**:
```json
{
  "shortcuts": {
    "gh": {
      "keyword": "gh",
      "target": "https://github.com",
      "createdAt": 1234567890
    }
  },
  "bundles": {}
}
```

### Bundle Editor (Basic Structure)

Current implementation includes bundle types in storage schema. Full bundle UI is a future enhancement:

**Planned Features**:
- Create named bundles (e.g., "Work", "Personal")
- Assign shortcuts to bundles
- Enable/disable entire bundles
- Import/export individual bundles

## Further Considerations

### Browser Support ✅

**Chrome (MV3)**:
- Service worker background script
- `declarativeNetRequest` permission (for future use)
- Modern APIs throughout

**Firefox (MV2)**:
- Traditional background scripts
- `webNavigation` API
- Compatible with Firefox extension guidelines

**Separate Manifests**: Build scripts handle both targets
- `npm run build` → Chrome
- `npm run build:firefox` → Firefox

### Interception Mechanism ✅

**Decision**: webNavigation API

**Why not declarativeNetRequest**:
1. Cannot dynamically parse search queries
2. Limited to 5000 rules
3. Each shortcut would need a separate rule
4. No support for template substitution (`%s`)
5. Rules must be predefined, can't adapt to user changes easily

**Benefits of webNavigation**:
1. Unlimited shortcuts
2. Full control over matching logic
3. Support for search templates
4. Dynamic keyword parsing
5. Can implement smart suggestions later

See `src/declarativeNetRequest.ts` for detailed comparison and potential hybrid approach.

## Testing Checklist

### Manual Testing Steps

**Chrome**:
1. Load unpacked extension
2. Add shortcut: `gh` → `https://github.com`
3. Search for "gh" in Google
4. Verify redirect to GitHub
5. Add template: `gh` → `https://github.com/search?q=%s`
6. Search for "gh javascript"
7. Verify redirect to GitHub search
8. Test context menu on a link
9. Test export/import

**Firefox**:
1. Load temporary add-on
2. Repeat all Chrome tests
3. Verify MV2 compatibility

## Future Enhancements

1. **Bundle Management UI**: Full CRUD interface for bundles
2. **Auto-Suggestions**: Smart suggestions based on usage patterns
3. **Sync Indicator**: Show sync status across devices
4. **Fuzzy Matching**: Allow typos in keywords
5. **Keyword Aliases**: Multiple keywords for same target
6. **Statistics**: Track shortcut usage
7. **Omnibox Integration**: Use Chrome omnibox API for better UX
8. **Dark Mode**: Theme support
9. **Shortcut Templates**: Pre-made shortcuts for popular sites
10. **Hybrid Interception**: Top shortcuts via declarativeNetRequest

## Conclusion

All four steps of the roadmap have been implemented:

1. ✅ Manifests audited and aligned for MV3/MV2
2. ✅ Storage schema and matching algorithm designed
3. ✅ Interception flow using webNavigation
4. ✅ UI, context menus, and export/import implemented

The extension is functional and ready for testing on both Chrome and Firefox.
