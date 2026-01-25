# Quick Start Guide

Get up and running with Omnibar Shortcuts in 5 minutes!

## Installation

### Chrome

1. **Clone and build:**
   ```bash
   git clone https://github.com/David-mXu/omnibar-shortcuts.git
   cd omnibar-shortcuts
   npm install
   npm run build
   ```

2. **Load in Chrome:**
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `dist` folder

3. **Done!** The extension icon should appear in your toolbar.

### Firefox

1. **Clone and build:**
   ```bash
   git clone https://github.com/David-mXu/omnibar-shortcuts.git
   cd omnibar-shortcuts
   npm install
   npm run build:firefox
   ```

2. **Load in Firefox:**
   - Open `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Navigate to `dist` folder and select `manifest.json`

3. **Done!** The extension will work until Firefox restarts (for permanent install, you'll need to package it).

## First Shortcut

Let's create your first shortcut for GitHub:

1. **Click the extension icon** in your toolbar
2. **Enter keyword:** `gh`
3. **Enter target URL:** `https://github.com`
4. **Click "Add Shortcut"**

Now try it:
- Go to Google
- Type: `gh`
- Press Enter
- You'll be redirected to GitHub! 🎉

## Your Second Shortcut (with Search)

Let's create a GitHub search shortcut:

1. **Click the extension icon**
2. **Enter keyword:** `ghs`
3. **Enter target URL:** `https://github.com/search?q=%s`
4. **Click "Add Shortcut"**

Now try it:
- Go to Google
- Type: `ghs javascript`
- Press Enter
- You'll be redirected to GitHub search results for "javascript"! 🔍

## Popular Shortcuts

Here are some popular shortcuts to get you started:

```
Keyword  Target URL
-------  ----------
gh       https://github.com
gm       https://mail.google.com
yt       https://youtube.com
tw       https://twitter.com
ghs      https://github.com/search?q=%s
so       https://stackoverflow.com/search?q=%s
wiki     https://en.wikipedia.org/wiki/Special:Search?search=%s
mdn      https://developer.mozilla.org/en-US/search?q=%s
```

You can import all these at once:
1. Download [example-shortcuts.json](example-shortcuts.json)
2. Go to Settings tab in the extension popup
3. Click "Import Shortcuts"
4. Select the downloaded file

## How It Works

1. You type a keyword in Google (or Bing, DuckDuckGo, etc.)
2. The extension intercepts the search
3. If your keyword matches, you're redirected
4. If not, your search proceeds normally

## Tips & Tricks

### Context Menu
Right-click on any link and select "Save as Shortcut" to quickly create a shortcut. The URL will be pre-filled!

### Export Your Shortcuts
Always export your shortcuts before uninstalling:
1. Go to Settings tab
2. Click "Export Shortcuts"
3. Save the JSON file

### Keyboard Shortcuts
- **Tab** - Move from keyword to URL field
- **Ctrl+Enter** - Save shortcut while in URL field

### Search Templates
Use `%s` anywhere in your URL:
- `https://amazon.com/s?k=%s` - Amazon search
- `https://reddit.com/search?q=%s` - Reddit search
- `https://npmjs.com/search?q=%s` - npm package search

## Troubleshooting

### Shortcuts Not Working?

1. **Check the keyword:** Make sure you're typing it exactly as saved
2. **Check the search engine:** Currently supports Google, Bing, DuckDuckGo, Yahoo, Baidu
3. **Check permissions:** The extension needs permission to access search engine pages
4. **Reload the extension:** Go to chrome://extensions/, find Omnibar Shortcuts, click reload

### Import Failed?

Make sure your JSON file has the correct format:
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

## Need Help?

- Check the [README.md](README.md) for detailed documentation
- Check [IMPLEMENTATION.md](IMPLEMENTATION.md) for technical details
- Open an issue on GitHub

## What's Next?

- Create shortcuts for your most-visited sites
- Use search templates for quick lookups
- Export your shortcuts as backup
- Share your shortcut collection with friends!

Enjoy faster browsing! ⚡
