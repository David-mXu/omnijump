export type ShortcutType = 'redirect' | 'bundle';

export interface Shortcut {
  key: string;
  url: string;
  type: ShortcutType;
  bundleUrls?: string[];
  label?: string;
  lastUsed?: number;
  createdAt?: number;
}

export interface UserSettings {
  maxShortcuts: number;
  filterThreshold: number;
  staleAutoDelete: boolean;
  staleDays: number;
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
};

export interface Suggestion {
  key: string;
  url: string;
  siteName: string;
}
