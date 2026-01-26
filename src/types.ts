export type ShortcutType = 'redirect' | 'bundle';

export interface Shortcut {
  key: string;
  url: string;
  type: ShortcutType;
  bundleUrls?: string[];
}

export interface UserSettings {
  maxShortcuts: number;
}

export interface ShortcutStore {
  shortcuts: Record<string, Shortcut>;
  settings: UserSettings;
}

export const DEFAULT_SETTINGS: UserSettings = {
  maxShortcuts: 5000,
};
