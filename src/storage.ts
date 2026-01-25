// storage.ts - Storage management for shortcuts and bundles

import type { Shortcut, Bundle, StorageSchema, MatchResult } from './types.js';

/**
 * Default storage schema
 */
const DEFAULT_STORAGE: StorageSchema = {
  shortcuts: {},
  bundles: {},
  settings: {
    showSuggestions: true,
    defaultSearchEngine: 'https://www.google.com/search?q=%s',
  },
};

/**
 * Get all data from storage
 */
export async function getAllData(): Promise<StorageSchema> {
  try {
    const result = await chrome.storage.sync.get(null);
    return {
      shortcuts: (result.shortcuts as Record<string, Shortcut>) || ({} as Record<string, Shortcut>),
      bundles: (result.bundles as Record<string, Bundle>) || ({} as Record<string, Bundle>),
      settings: result.settings ? { ...DEFAULT_STORAGE.settings, ...result.settings } : DEFAULT_STORAGE.settings,
    };
  } catch (error) {
    console.error('Error loading storage:', error);
    return DEFAULT_STORAGE;
  }
}

/**
 * Get all shortcuts
 */
export async function getShortcuts(): Promise<Record<string, Shortcut>> {
  const data = await getAllData();
  return data.shortcuts;
}

/**
 * Get all bundles
 */
export async function getBundles(): Promise<Record<string, Bundle>> {
  const data = await getAllData();
  return data.bundles;
}

/**
 * Save a shortcut
 */
export async function saveShortcut(shortcut: Shortcut): Promise<void> {
  const shortcuts = await getShortcuts();
  shortcuts[shortcut.id] = shortcut;
  await chrome.storage.sync.set({ shortcuts });
}

/**
 * Delete a shortcut
 */
export async function deleteShortcut(id: string): Promise<void> {
  const shortcuts = await getShortcuts();
  delete shortcuts[id];
  await chrome.storage.sync.set({ shortcuts });
}

/**
 * Save a bundle
 */
export async function saveBundle(bundle: Bundle): Promise<void> {
  const bundles = await getBundles();
  bundles[bundle.id] = bundle;
  await chrome.storage.sync.set({ bundles });
}

/**
 * Delete a bundle
 */
export async function deleteBundle(id: string): Promise<void> {
  const bundles = await getBundles();
  delete bundles[id];
  await chrome.storage.sync.set({ bundles });
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Export all data as JSON
 */
export async function exportData(): Promise<string> {
  const data = await getAllData();
  return JSON.stringify(data, null, 2);
}

/**
 * Import data from JSON
 */
export async function importData(jsonString: string): Promise<void> {
  try {
    const data = JSON.parse(jsonString) as Partial<StorageSchema>;
    await chrome.storage.sync.set(data);
  } catch (error) {
    throw new Error('Invalid JSON format');
  }
}

/**
 * Match a search query against shortcuts
 * Returns the matching shortcut and final URL with substitutions
 */
export async function matchQuery(query: string): Promise<MatchResult | null> {
  const shortcuts = await getShortcuts();
  const bundles = await getBundles();
  
  // Normalize query
  const normalizedQuery = query.trim().toLowerCase();
  
  // Try to find a matching keyword
  for (const shortcut of Object.values(shortcuts)) {
    // Skip shortcuts in disabled bundles
    if (shortcut.bundleId) {
      const bundle = bundles[shortcut.bundleId];
      if (bundle && !bundle.enabled) {
        continue;
      }
    }
    
    const keyword = shortcut.keyword.toLowerCase();
    
    // Exact keyword match
    if (normalizedQuery === keyword) {
      return {
        shortcut,
        finalUrl: shortcut.url,
      };
    }
    
    // Keyword with search term (e.g., "gh query")
    if (normalizedQuery.startsWith(keyword + ' ')) {
      const searchTerm = query.slice(keyword.length + 1).trim();
      const finalUrl = shortcut.url.replace(/%s/g, encodeURIComponent(searchTerm));
      return {
        shortcut,
        searchTerm,
        finalUrl,
      };
    }
  }
  
  return null;
}
