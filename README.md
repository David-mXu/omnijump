# Omnibar Shortcuts

A Chrome/Firefox extension that enables custom omnibar shortcuts for instant navigation to your favorite sites.

## Features

- **Custom Keywords**: Create shortcuts like `gh` for GitHub, `gm` for Gmail, etc.
- **Search Templates**: Use `%s` in URLs to create search shortcuts (e.g., `gh %s` searches GitHub)
- **Context Menu**: Right-click any link or page to save it as a shortcut
- **Import/Export**: Backup and share your shortcuts as JSON
- **MV3 Compatible**: Built with Manifest V3 for Chrome, with Firefox support

## Installation

### Chrome (from source)

1. Clone this repository
2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
3. Open Chrome and go to `chrome://extensions/`
4. Enable "Developer mode"
5. Click "Load unpacked" and select the `dist` folder

### Firefox (from source)

1. Clone this repository
2. Install dependencies and build for Firefox:
   ```bash
   npm install
   npm run build:firefox
   ```
3. Open Firefox and go to `about:debugging#/runtime/this-firefox`
4. Click "Load Temporary Add-on"
5. Navigate to the `dist` folder and select `manifest.json`

## Usage

### Creating a Shortcut

1. Click the extension icon to open the popup
2. Enter a **keyword** (e.g., `gh`)
3. Enter a **target URL** (e.g., `https://github.com`)
4. Click "Add Shortcut"

### Using Search Templates

To create a shortcut that accepts search queries, use `%s` in the target URL:

- Keyword: `gh`
- Target: `https://github.com/search?q=%s`
- Usage: Type `gh javascript` in your search engine → redirects to GitHub search for "javascript"

### How It Works

The extension intercepts search engine queries and looks for matching keywords. When it finds a match:

1. If the keyword has no `%s`, it redirects to the exact URL
2. If the keyword has `%s`, it replaces it with your search query
3. If no match is found, your search proceeds normally

### Context Menu

Right-click on any link or page and select "Save as Shortcut" to quickly create a new shortcut. The URL will be pre-filled in the popup.

### Import/Export

1. Go to the "Settings" tab in the popup
2. Click "Export Shortcuts" to save your shortcuts as JSON
3. Click "Import Shortcuts" to restore from a backup

## Architecture

### Data Schema

Shortcuts are stored in `chrome.storage.sync` with the following structure:

```typescript
{
  shortcuts: {
    "keyword": {
      keyword: "keyword",
      target: "https://example.com",
      createdAt: 1234567890,
      bundleId?: "bundle-id"
    }
  },
  bundles: {
    "bundle-id": {
      id: "bundle-id",
      name: "Bundle Name",
      shortcuts: ["keyword1", "keyword2"]
    }
  }
}
```

### Interception Flow

1. **Background Service Worker**: Listens to `chrome.webNavigation.onBeforeNavigate`
2. **URL Parsing**: Extracts search queries from common search engines
3. **Keyword Matching**: Checks if the first word matches a saved keyword
4. **Redirection**: If matched, redirects to the target URL (with `%s` replaced if applicable)

### Browser Compatibility

- **Chrome**: Uses Manifest V3 with service workers
- **Firefox**: Uses Manifest V2 with background scripts
- Both versions use the same TypeScript source code

## Development

### Build Commands

```bash
# Install dependencies
npm install

# Build for Chrome
npm run build

# Build for Firefox
npm run build:firefox

# Watch mode (TypeScript only)
npm run watch
```

### Project Structure

```
omnibar-shortcuts/
├── src/
│   ├── background.ts    # Background service worker
│   ├── popup.ts         # Popup UI logic
│   ├── storage.ts       # Storage management
│   └── matcher.ts       # URL matching algorithm
├── icons/               # Extension icons
├── manifest.json        # Chrome manifest (MV3)
├── manifest.firefox.json # Firefox manifest (MV2)
├── popup.html           # Popup UI
├── package.json
└── tsconfig.json
```

## Roadmap

- [x] Basic keyword-to-URL mapping
- [x] Search template support (`%s`)
- [x] Context menu integration
- [x] Import/export functionality
- [ ] Bundle management UI
- [ ] Auto-suggestions based on usage
- [ ] Sync across devices (using `chrome.storage.sync`)
- [ ] Firefox add-on store publication
- [ ] Chrome Web Store publication

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
