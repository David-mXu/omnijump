/**
 * Background service worker for omnibar shortcuts (MV3)
 * Handles URL interception and redirection using webNavigation API
 */

import { StorageManager } from './storage.js';
import { checkInterception } from './matcher.js';

// List of search engines we want to intercept
const SEARCH_ENGINES = [
  'www.google.com',
  'www.bing.com',
  'duckduckgo.com',
  'search.yahoo.com',
  'www.baidu.com',
];

/**
 * Check if URL is a search engine we should intercept
 */
function isSearchEngine(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // Use exact hostname matching to prevent false positives
    return SEARCH_ENGINES.some(engine => urlObj.hostname === engine || urlObj.hostname.endsWith('.' + engine));
  } catch {
    return false;
  }
}

/**
 * Handle navigation and intercept shortcuts
 */
async function handleNavigation(details: chrome.webNavigation.WebNavigationParentedCallbackDetails) {
  // Only intercept main frame navigations
  if (details.frameId !== 0) {
    return;
  }

  const url = details.url;
  
  // Only intercept search engine URLs
  if (!isSearchEngine(url)) {
    return;
  }

  // Get shortcuts and check for match
  const shortcuts = await StorageManager.getShortcuts();
  const redirectUrl = checkInterception(url, shortcuts);

  if (redirectUrl) {
    // Redirect to the matched shortcut target
    chrome.tabs.update(details.tabId, { url: redirectUrl });
  }
}

/**
 * Initialize the extension
 */
async function initialize() {
  // Set up navigation listener
  chrome.webNavigation.onBeforeNavigate.addListener(handleNavigation);

  // Set up context menu
  chrome.contextMenus.create({
    id: 'save-as-shortcut',
    title: 'Save as Shortcut',
    contexts: ['link', 'page'],
  });

  console.log('Omnibar Shortcuts initialized');
}

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-as-shortcut') {
    const url = (info.linkUrl || info.pageUrl) as string;
    
    // Open popup or show notification
    // For now, we'll just log it - in a real extension, you'd want to
    // show a UI to let the user enter the keyword
    console.log('Save shortcut for URL:', url);
    
    // Store the URL in a temporary location for the popup to pick up
    chrome.storage.local.set({ pendingShortcutUrl: url });
  }
});

/**
 * Handle messages from popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getPendingUrl') {
    chrome.storage.local.get('pendingShortcutUrl').then(result => {
      sendResponse({ url: result.pendingShortcutUrl });
      chrome.storage.local.remove('pendingShortcutUrl');
    });
    return true; // Keep channel open for async response
  }
});

// Initialize on install or startup
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

// Initialize immediately
initialize();
