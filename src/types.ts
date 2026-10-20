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
