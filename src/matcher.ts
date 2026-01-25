/**
 * Matching algorithm for URL interception
 */

import { Shortcut } from './storage.js';

/**
 * Parse a URL to extract potential shortcut patterns
 */
export function parseUrlForShortcut(url: string): { keyword: string; query?: string } | null {
  try {
    const urlObj = new URL(url);
    
    // Check if this is a search engine URL that might contain our shortcut
    // Common patterns: ?q=keyword, ?search=keyword, /search?q=keyword
    const searchParams = urlObj.searchParams;
    
    // Try common search parameter names
    const searchParamNames = ['q', 'search', 'query', 's'];
    for (const paramName of searchParamNames) {
      const queryValue = searchParams.get(paramName);
      if (queryValue) {
        const parts = queryValue.trim().split(/\s+/);
        if (parts.length > 0) {
          return {
            keyword: parts[0],
            query: parts.slice(1).join(' ') || undefined,
          };
        }
      }
    }

    // Check path for potential shortcuts (e.g., /search/keyword)
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    if (pathParts.length > 0 && pathParts[0].length < 20) {
      return { keyword: pathParts[0] };
    }
  } catch (e) {
    // Invalid URL
  }
  return null;
}

/**
 * Match a keyword against available shortcuts and return the target URL
 */
export function matchShortcut(
  keyword: string,
  shortcuts: Record<string, Shortcut>,
  query?: string
): string | null {
  const shortcut = shortcuts[keyword];
  if (!shortcut) {
    return null;
  }

  // Replace %s with query if present
  if (query && shortcut.target.includes('%s')) {
    return shortcut.target.replace('%s', encodeURIComponent(query));
  }

  // If target has %s but no query provided, return null (incomplete)
  if (!query && shortcut.target.includes('%s')) {
    return null;
  }

  return shortcut.target;
}

/**
 * Check if a URL should be intercepted and return redirect URL if match found
 */
export function checkInterception(
  url: string,
  shortcuts: Record<string, Shortcut>
): string | null {
  const parsed = parseUrlForShortcut(url);
  if (!parsed) {
    return null;
  }

  return matchShortcut(parsed.keyword, shortcuts, parsed.query);
}
