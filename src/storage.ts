/**
 * Storage schema and types for omnibar shortcuts
 */

export interface Shortcut {
  keyword: string;
  target: string;
  createdAt: number;
  bundleId?: string;
}

export interface Bundle {
  id: string;
  name: string;
  shortcuts: string[]; // keyword references
}

export interface StorageData {
  shortcuts: Record<string, Shortcut>;
  bundles: Record<string, Bundle>;
}

export const STORAGE_KEYS = {
  SHORTCUTS: 'shortcuts',
  BUNDLES: 'bundles',
} as const;

/**
 * Storage manager for shortcuts and bundles
 */
export class StorageManager {
  /**
   * Get all shortcuts from storage
   */
  static async getShortcuts(): Promise<Record<string, Shortcut>> {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.SHORTCUTS);
    return result[STORAGE_KEYS.SHORTCUTS] || {};
  }

  /**
   * Save shortcuts to storage
   */
  static async saveShortcuts(shortcuts: Record<string, Shortcut>): Promise<void> {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SHORTCUTS]: shortcuts });
  }

  /**
   * Add a new shortcut
   */
  static async addShortcut(keyword: string, target: string, bundleId?: string): Promise<void> {
    const shortcuts = await this.getShortcuts();
    shortcuts[keyword] = {
      keyword,
      target,
      createdAt: Date.now(),
      bundleId,
    };
    await this.saveShortcuts(shortcuts);
  }

  /**
   * Remove a shortcut by keyword
   */
  static async removeShortcut(keyword: string): Promise<void> {
    const shortcuts = await this.getShortcuts();
    delete shortcuts[keyword];
    await this.saveShortcuts(shortcuts);
  }

  /**
   * Get all bundles from storage
   */
  static async getBundles(): Promise<Record<string, Bundle>> {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.BUNDLES);
    return result[STORAGE_KEYS.BUNDLES] || {};
  }

  /**
   * Save bundles to storage
   */
  static async saveBundles(bundles: Record<string, Bundle>): Promise<void> {
    await chrome.storage.sync.set({ [STORAGE_KEYS.BUNDLES]: bundles });
  }

  /**
   * Export all data as JSON
   */
  static async exportData(): Promise<string> {
    const shortcuts = await this.getShortcuts();
    const bundles = await this.getBundles();
    return JSON.stringify({ shortcuts, bundles }, null, 2);
  }

  /**
   * Import data from JSON
   */
  static async importData(jsonData: string): Promise<void> {
    const data = JSON.parse(jsonData) as StorageData;
    await this.saveShortcuts(data.shortcuts || {});
    await this.saveBundles(data.bundles || {});
  }
}
