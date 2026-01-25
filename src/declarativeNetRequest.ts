/**
 * Implementation notes for declarativeNetRequest approach
 * 
 * This file documents the alternative implementation using declarativeNetRequest
 * instead of webNavigation for URL interception.
 * 
 * CURRENT IMPLEMENTATION: webNavigation API
 * - More flexible for dynamic matching
 * - Can parse URLs and extract keywords on-the-fly
 * - Works well for search engine interception
 * - Better for user-defined shortcuts that change frequently
 * 
 * ALTERNATIVE: declarativeNetRequest API
 * - Faster execution (rules evaluated in browser engine)
 * - More rigid (requires pre-defined rules)
 * - Limited to 5000 dynamic rules per extension
 * - Challenges:
 *   1. Cannot dynamically parse search queries
 *   2. Each shortcut would need a separate rule
 *   3. Rule updates require async API calls
 *   4. Regex patterns are limited
 * 
 * RECOMMENDATION:
 * For omnibar shortcuts with user-defined keywords, webNavigation is more
 * appropriate because:
 * 1. Users can add/remove shortcuts without rule limits
 * 2. Search templates (%s) require dynamic query extraction
 * 3. Keyword matching needs flexible parsing logic
 * 
 * However, for a fixed set of shortcuts or redirects, declarativeNetRequest
 * would be more performant.
 * 
 * HYBRID APPROACH (Future Enhancement):
 * - Use declarativeNetRequest for static, frequently-used shortcuts
 * - Use webNavigation for dynamic shortcuts and search templates
 * - Store top 50 shortcuts as declarativeNetRequest rules
 * - Fall back to webNavigation for others
 */

// Example declarativeNetRequest rule structure for reference:
export interface DeclarativeNetRequestRule {
  id: number;
  priority: number;
  action: {
    type: 'redirect';
    redirect: {
      url?: string;
      regexSubstitution?: string;
    };
  };
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    resourceTypes: string[];
  };
}

// Example function to convert shortcuts to declarativeNetRequest rules
// (Not currently used, but available for future optimization)
export function convertShortcutToRule(
  keyword: string,
  target: string,
  ruleId: number
): DeclarativeNetRequestRule | null {
  // Can only handle non-template shortcuts with declarativeNetRequest
  if (target.includes('%s')) {
    return null; // Template shortcuts need webNavigation
  }

  // Create a rule that matches search engine URLs containing the keyword
  return {
    id: ruleId,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        url: target,
      },
    },
    condition: {
      // This is a simplified example - actual implementation would be more complex
      urlFilter: `*q=${keyword}*`,
      resourceTypes: ['main_frame'],
    },
  };
}
