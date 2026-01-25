# Quick Start Guide

This guide will help you get started with Omnibar Shortcuts in 5 minutes.

## Installation

1. **Build the extension**
   ```bash
   npm install
   npm run build
   ```

2. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top-right toggle)
   - Click "Load unpacked"
   - Select this directory

3. **Import example shortcuts**
   - Click the extension icon in Chrome toolbar
   - Click "Import" button
   - Select `examples/example-shortcuts.json`
   - You now have 8 shortcuts ready to use!

## Try It Out

Type these in your Chrome omnibar (address bar):

1. **`gh typescript`** → Search GitHub for "typescript"
2. **`r programming`** → Go to reddit.com/r/programming
3. **`yt cats`** → Search YouTube for "cats"
4. **`w javascript`** → Go to Wikipedia page for "javascript"
5. **`maps new york`** → Search Google Maps for "new york"
6. **`tw elonmusk`** → Go to twitter.com/elonmusk
7. **`npm react`** → Search npm for "react" packages
8. **`mdn fetch`** → Search MDN docs for "fetch"

## Create Your Own

1. Click the extension icon
2. Enter a keyword (e.g., `stackoverflow`)
3. Enter a URL (e.g., `https://stackoverflow.com/search?q=%s`)
4. (Optional) Add a description
5. Click "Add Shortcut"

**Note**: Use `%s` in the URL where you want the search term to appear!

## Organize with Bundles

1. Go to the "Bundles" tab
2. Create a bundle (e.g., "Work Tools")
3. Go back to "Shortcuts" tab
4. When adding shortcuts, select your bundle from the dropdown
5. Toggle bundles on/off to enable/disable groups of shortcuts

## How It Works

When you type something in the omnibar:
1. Chrome starts searching with your default search engine
2. The extension intercepts the search
3. Checks if your query matches a keyword
4. Redirects you to the matching URL instantly

**No configuration needed** - it just works!

## Tips

- Keep keywords short (2-3 characters)
- Use memorable abbreviations
- Export your shortcuts regularly as backup
- Share your shortcuts JSON with team members

## Troubleshooting

**Shortcuts not working?**
- Make sure the extension is enabled in `chrome://extensions/`
- Check that your default search engine is Google, Bing, DuckDuckGo, or Yahoo
- Try reloading the extension

**Import not working?**
- Make sure the JSON file is valid
- Check that it follows the correct schema

## Next Steps

- Create shortcuts for your most-visited sites
- Organize them into bundles by category
- Export and backup your shortcuts
- Share useful shortcut collections with others

Enjoy faster web navigation! 🚀
