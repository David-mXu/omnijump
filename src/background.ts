// background.ts - Background service worker for omnibar interception

import { matchQuery } from './storage.js';

/**
 * Search engine URL patterns to intercept
 * These patterns match common search engine URLs that indicate an omnibar search
 */
const SEARCH_PATTERNS = [
  // Google search
  /^https?:\/\/(?:www\.)?google\.com\/search\?.*[&?]q=([^&]*)/i,
  // Bing search
  /^https?:\/\/(?:www\.)?bing\.com\/search\?.*[&?]q=([^&]*)/i,
  // DuckDuckGo
  /^https?:\/\/(?:www\.)?duckduckgo\.com\/\?.*[&?]q=([^&]*)/i,
  // Yahoo search
  /^https?:\/\/(?:www\.)?search\.yahoo\.com\/search.*[&?]p=([^&]*)/i,
];

/**
 * Extract search query from a search engine URL
 */
function extractSearchQuery(url: string): string | null {
  for (const pattern of SEARCH_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    }
  }
  return null;
}

/**
 * Handle navigation events to intercept omnibar searches
 */
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only process main frame navigations
  if (details.frameId !== 0) {
    return;
  }
  
  // Extract search query from URL
  const searchQuery = extractSearchQuery(details.url);
  if (!searchQuery) {
    return;
  }
  
  console.log('Detected search query:', searchQuery);
  
  // Try to match against shortcuts
  const match = await matchQuery(searchQuery);
  if (match) {
    console.log('Matched shortcut:', match.shortcut.keyword, '→', match.finalUrl);
    
    // Redirect to the matched URL
    try {
      await chrome.tabs.update(details.tabId, { url: match.finalUrl });
    } catch (error) {
      console.error('Error redirecting:', error);
    }
  }
});

console.log('Omnibar Shortcuts background service worker initialized');
