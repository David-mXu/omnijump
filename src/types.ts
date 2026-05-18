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
}

export interface ShortcutStore {
  shortcuts: Record<string, Shortcut>;
  settings: UserSettings;
}

export const DEFAULT_SETTINGS: UserSettings = {
  maxShortcuts: 500,
  filterThreshold: 25,
  staleAutoDelete: true,
  staleDays: 90,
  darkMode: false,
};

export interface Suggestion {
  key: string;
  url: string;
  siteName: string;
}
