export type ShortcutType = 'redirect' | 'bundle' | 'parameterized';

export interface Shortcut {
  key: string;
  url: string;
  type: ShortcutType;
  bundleUrls?: string[];
  label?: string;
  urlTemplate?: string;  // parameterized: 'https://site.com/search?q=%s'
  lastUsed?: number;
  createdAt?: number;
  useCount?: number;
}

export interface UserSettings {
  maxShortcuts: number;
  filterThreshold: number;
  staleAutoDelete: boolean;
  staleDays: number;
  darkMode: boolean;
  smartSuggestions: boolean;
}

export interface ShortcutStore {
  shortcuts: Record<string, Shortcut>;
  settings: UserSettings;
}

export const DEFAULT_SETTINGS: UserSettings = {
  maxShortcuts: 500,
  filterThreshold: 10,
  staleAutoDelete: true,
  staleDays: 90,
  darkMode: false,
  smartSuggestions: false,
};

export const STARTER_SHORTCUTS: Omit<Shortcut, 'createdAt' | 'useCount'>[] = [
  { key: 'gh', url: 'https://github.com', type: 'redirect', label: 'GitHub' },
  { key: 'github', url: 'https://github.com', type: 'redirect', label: 'GitHub' },
  { key: 'yt', url: 'https://www.youtube.com', urlTemplate: 'https://www.youtube.com/results?search_query=%s', type: 'parameterized', label: 'YouTube' },
  { key: 'wiki', url: 'https://en.wikipedia.org', urlTemplate: 'https://en.wikipedia.org/wiki/Special:Search?search=%s', type: 'parameterized', label: 'Wikipedia' },
  { key: 'maps', url: 'https://www.google.com/maps', urlTemplate: 'https://www.google.com/maps/search/%s', type: 'parameterized', label: 'Google Maps' },
  { key: 'cal', url: 'https://calendar.google.com', type: 'redirect', label: 'Google Calendar' },
  { key: 'mail', url: 'https://mail.google.com', type: 'redirect', label: 'Gmail' },
  { key: 'drive', url: 'https://drive.google.com', type: 'redirect', label: 'Google Drive' },
  { key: 'docs', url: 'https://docs.google.com', type: 'redirect', label: 'Google Docs' },
  { key: 'chat', url: 'https://chatgpt.com', type: 'redirect', label: 'ChatGPT' },
  { key: 'gpt', url: 'https://chatgpt.com', type: 'redirect', label: 'ChatGPT' },
  { key: 'claude', url: 'https://claude.ai', type: 'redirect', label: 'Claude' },
  { key: 'grok', url: 'https://grok.com', type: 'redirect', label: 'Grok' },
  { key: 'pplx', url: 'https://www.perplexity.ai', urlTemplate: 'https://www.perplexity.ai/search?q=%s', type: 'parameterized', label: 'Perplexity AI' },
  { key: 'outlook', url: 'https://outlook.live.com', type: 'redirect', label: 'Outlook' },
  { key: 'reddit', url: 'https://www.reddit.com', urlTemplate: 'https://www.reddit.com/search/?q=%s', type: 'parameterized', label: 'Reddit' },
  { key: 'notion', url: 'https://notion.so', type: 'redirect', label: 'Notion' },
];

export interface Suggestion {
  key: string;
  url: string;
  siteName: string;
  host: string;
}

// Input limits shared by every write surface (forms, import, popup, editor).
// MAX_KEY_LENGTH also keeps per-rule DNR regexes under Chrome's 2 KB RE2
// program limit (see src/dnr.ts). The measured worst case is 40 characters for
// a redirect keyword (Startpage) and 28 for a parameterized one, where the
// capture-group rule adds more RE2 work; longer keys silently lost DNR rules.
export const MAX_KEY_LENGTH = 40;
export const MAX_PARAMETERIZED_KEY_LENGTH = 28;
export const MAX_LABEL_LENGTH = 256;
export const MAX_URL_LENGTH = 2048;
export const MAX_BUNDLE_URLS = 32;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

// chrome.storage.sync caps each stored item at 8 KB. A record's serialized
// form plus its `omnibar_s_` key must fit, so leave headroom for JSON syntax
// and future fields. Bundles can otherwise exceed the per-item cap long before
// the total 100 KB quota is reached.
export const MAX_SYNC_ITEM_BYTES = 7900;

// Chrome allows 1,000 regex DNR rules; a redirect shortcut costs 7 (one per
// engine) and a parameterized one costs 14. About 142 redirect keys (or 71
// search keys) can be intercepted before navigation; beyond that, shortcuts
// still work through the JS fallback once the search page loads.
