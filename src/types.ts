// types.ts - Core type definitions for the omnibar shortcuts extension

/**
 * A single shortcut mapping a keyword to a target URL
 */
export interface Shortcut {
  /** Unique identifier for the shortcut */
  id: string;
  /** Keyword to trigger the shortcut (e.g., "gh", "reddit") */
  keyword: string;
  /** Target URL, may include %s placeholder for search terms */
  url: string;
  /** Optional description of what this shortcut does */
  description?: string;
  /** Bundle ID this shortcut belongs to, if any */
  bundleId?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  updatedAt: number;
}

/**
 * A bundle groups related shortcuts together
 */
export interface Bundle {
  /** Unique identifier for the bundle */
  id: string;
  /** Human-readable name (e.g., "Development Tools") */
  name: string;
  /** Optional description */
  description?: string;
  /** Whether this bundle is currently active */
  enabled: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  updatedAt: number;
}

/**
 * Storage schema for chrome.storage.sync
 */
export interface StorageSchema {
  /** All shortcuts indexed by ID */
  shortcuts: Record<string, Shortcut>;
  /** All bundles indexed by ID */
  bundles: Record<string, Bundle>;
  /** Settings/preferences */
  settings: {
    /** Whether to show suggestions in popup */
    showSuggestions: boolean;
    /** Default search engine for non-matching queries */
    defaultSearchEngine: string;
  };
}

/**
 * Result of a keyword match
 */
export interface MatchResult {
  /** The matched shortcut */
  shortcut: Shortcut;
  /** Search term extracted from query (if %s was used) */
  searchTerm?: string;
  /** The final URL after substitution */
  finalUrl: string;
}
