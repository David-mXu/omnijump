# Omnibar Shortcuts

A powerful Chrome extension that lets you create custom keyboard shortcuts for instant navigation using your browser's omnibar (address bar).

## Features

- 🔍 **Custom Keywords**: Define short keywords that redirect to your favorite sites
- 🔄 **Dynamic Search**: Use `%s` placeholders to create search shortcuts
- 📦 **Bundles**: Organize shortcuts into groups that can be enabled/disabled
- 💾 **Import/Export**: Back up and share your shortcuts as JSON
- ⚡ **Fast**: Intercepts searches before they hit search engines
- 🎨 **Clean UI**: Modern, intuitive popup interface

## Installation

### Chrome (Recommended)

1. Clone or download this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to compile TypeScript
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode" (toggle in top-right)
6. Click "Load unpacked"
7. Select the extension directory

### Quick Start

Want to try it out with example shortcuts? Import `examples/example-shortcuts.json` from the popup to get:
- GitHub search (`gh`)
- Reddit subreddits (`r`)
- YouTube search (`yt`)
- Wikipedia (`w`)
- Google Maps (`maps`)
- Twitter profiles (`tw`)
- npm packages (`npm`)
- MDN docs (`mdn`)

### Firefox (Experimental)

1. Follow build steps above
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `manifest.firefox.json` from the extension directory

## Usage

### Basic Shortcuts

1. Click the extension icon to open the popup
2. Enter a **keyword** (e.g., `gh`)
3. Enter a **URL** (e.g., `https://github.com`)
4. Click "Add Shortcut"
5. Type `gh` in your omnibar and press Enter - you'll be redirected to GitHub!

### Search Shortcuts

Create shortcuts that accept search terms using the `%s` placeholder:

**Example: GitHub Search**
- Keyword: `gh`
- URL: `https://github.com/search?q=%s`
- Usage: Type `gh typescript` in omnibar → searches GitHub for "typescript"

**Example: YouTube**
- Keyword: `yt`
- URL: `https://www.youtube.com/results?search_query=%s`
- Usage: Type `yt cats` in omnibar → searches YouTube for "cats"

### Bundles

Organize related shortcuts:

1. Go to the "Bundles" tab
2. Create a bundle (e.g., "Development Tools")
3. When creating shortcuts, assign them to bundles
4. Toggle bundles on/off to enable/disable entire groups

### Import/Export

**Export:**
- Click "Export" to download your shortcuts as JSON
- Share with others or keep as backup

**Import:**
- Click "Import" and select a JSON file
- All shortcuts and bundles will be loaded

## How It Works

### Architecture

The extension uses a **service worker** (background script) that intercepts navigation to search engines:

1. You type something in the omnibar
2. Browser starts to navigate to a search engine (Google, Bing, etc.)
3. Background script intercepts the navigation using `chrome.webNavigation`
4. Extracts the search query from the URL
5. Matches it against your shortcuts
6. Redirects to the matching shortcut's URL

### Supported Search Engines

The extension intercepts queries from:
- Google (`google.com/search`)
- Bing (`bing.com/search`)
- DuckDuckGo (`duckduckgo.com`)
- Yahoo (`search.yahoo.com`)

### Browser Compatibility

- **Chrome MV3**: Primary target, uses service worker
- **Firefox MV2**: Secondary support, uses background script

### Interception Mechanism

We chose **`webNavigation`** over `declarativeNetRequest` because:
- ✅ More flexible for dynamic matching
- ✅ Can inspect and modify navigation on-the-fly
- ✅ Better for complex keyword patterns
- ✅ Easier to debug

## Example Shortcuts

Here are some useful shortcuts to get started:

| Keyword | URL | Description |
|---------|-----|-------------|
| `gh` | `https://github.com` | GitHub homepage |
| `gh` | `https://github.com/search?q=%s` | Search GitHub |
| `r` | `https://reddit.com/r/%s` | Go to subreddit |
| `yt` | `https://youtube.com/results?search_query=%s` | YouTube search |
| `w` | `https://en.wikipedia.org/wiki/%s` | Wikipedia article |
| `maps` | `https://www.google.com/maps/search/%s` | Google Maps search |
| `tw` | `https://twitter.com/%s` | Go to Twitter profile |
| `drive` | `https://drive.google.com` | Google Drive |

## Development

### Building

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm run watch      # Watch mode for development
npm run clean      # Remove dist folder
```

### Project Structure

```
omnibar-shortcuts/
├── src/
│   ├── types.ts       # TypeScript interfaces
│   ├── storage.ts     # Storage and matching logic
│   ├── background.ts  # Service worker (interception)
│   └── popup.ts       # Popup UI logic
├── dist/              # Compiled JavaScript (generated)
├── manifest.json      # Chrome MV3 manifest
├── manifest.firefox.json  # Firefox MV2 manifest
├── popup.html         # Popup UI
└── icon.png          # Extension icon
```

### Storage Schema

Data is stored in `chrome.storage.sync`:

```typescript
{
  shortcuts: {
    [id: string]: {
      id: string;
      keyword: string;
      url: string;
      description?: string;
      bundleId?: string;
      createdAt: number;
      updatedAt: number;
    }
  },
  bundles: {
    [id: string]: {
      id: string;
      name: string;
      description?: string;
      enabled: boolean;
      createdAt: number;
      updatedAt: number;
    }
  },
  settings: {
    showSuggestions: boolean;
    defaultSearchEngine: string;
  }
}
```

## Roadmap

Future enhancements:

- [ ] Context menu integration (right-click to save current page)
- [ ] Auto-suggestions while typing
- [ ] Fuzzy matching for typos
- [ ] Statistics and usage tracking
- [ ] Sync across devices (already uses `chrome.storage.sync`)
- [ ] Custom themes
- [ ] Keyboard shortcuts for popup

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Privacy

This extension:
- ✅ Stores all data locally in your browser
- ✅ Does NOT send any data to external servers
- ✅ Does NOT track your browsing
- ✅ Only intercepts navigation to search engines to check for keyword matches
- ✅ Requires minimal permissions

Required permissions:
- `storage`: Save your shortcuts
- `webNavigation`: Intercept omnibar searches
- `tabs`: Redirect matched shortcuts
- `<all_urls>`: Detect search engine navigation

## Credits

Created for efficient web navigation and productivity.
