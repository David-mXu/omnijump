import { vi } from 'vitest';

export interface MockChromeEvent<T extends (...args: any[]) => any = (...args: any[]) => any> {
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  hasListener: ReturnType<typeof vi.fn>;
  emit: (...args: Parameters<T>) => Promise<void>;
  listeners: T[];
}

export function makeChromeEvent<T extends (...args: any[]) => any = (...args: any[]) => any>(): MockChromeEvent<T> {
  const listeners: T[] = [];
  return {
    listeners,
    addListener: vi.fn((fn: T) => {
      listeners.push(fn);
    }),
    removeListener: vi.fn((fn: T) => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    hasListener: vi.fn((fn: T) => listeners.includes(fn)),
    emit: async (...args: Parameters<T>) => {
      for (const fn of [...listeners]) {
        await fn(...args);
      }
    },
  };
}

function cloneValue<T>(val: T): T {
  if (val === undefined || val === null || typeof val !== 'object') return val;
  return JSON.parse(JSON.stringify(val));
}

export function createChromeMock() {
  const syncStore: Record<string, unknown> = {};
  const localStore: Record<string, unknown> = {};
  const sessionStore: Record<string, unknown> = {};
  const dnrRules: chrome.declarativeNetRequest.Rule[] = [];
  const onChanged = makeChromeEvent<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void>();

  function makeStorage(store: Record<string, unknown>, areaName: string) {
    return {
      get: vi.fn(async (keys: string | string[] | Record<string, unknown> | null = null) => {
        if (keys === null || keys === undefined) return cloneValue({ ...store });
        if (typeof keys === 'string') {
          return keys in store ? { [keys]: cloneValue(store[keys]) } : {};
        }
        if (Array.isArray(keys)) {
          return Object.fromEntries(
            keys.filter((k) => k in store).map((k) => [k, cloneValue(store[k])]),
          );
        }
        const result: Record<string, unknown> = {};
        for (const [k, defaultVal] of Object.entries(keys)) {
          result[k] = k in store ? cloneValue(store[k]) : cloneValue(defaultVal);
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [k, v] of Object.entries(items)) {
          const oldValue = k in store ? cloneValue(store[k]) : undefined;
          const newValue = cloneValue(v);
          store[k] = newValue;
          changes[k] = { oldValue, newValue };
        }
        if (Object.keys(changes).length > 0) {
          await onChanged.emit(changes, areaName);
        }
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) {
          if (k in store) {
            const oldValue = cloneValue(store[k]);
            delete store[k];
            changes[k] = { oldValue, newValue: undefined };
          }
        }
        if (Object.keys(changes).length > 0) {
          await onChanged.emit(changes, areaName);
        }
      }),
      clear: vi.fn(async () => {
        for (const k of Object.keys(store)) delete store[k];
      }),
    };
  }

  const chromeMock = {
    storage: {
      sync: makeStorage(syncStore, 'sync'),
      local: makeStorage(localStore, 'local'),
      session: makeStorage(sessionStore, 'session'),
      onChanged,
    },
    declarativeNetRequest: {
      getDynamicRules: vi.fn(async () => [...dnrRules]),
      updateDynamicRules: vi.fn(async ({
        removeRuleIds = [],
        addRules = [],
      }: {
        removeRuleIds?: number[];
        addRules?: chrome.declarativeNetRequest.Rule[];
      }) => {
        const kept = dnrRules.filter((r) => !removeRuleIds.includes(r.id));
        const existingIds = new Set(kept.map((r) => r.id));
        for (const rule of addRules) {
          if (existingIds.has(rule.id)) {
            throw new Error(`Rule with id ${rule.id} does not have a unique ID.`);
          }
          existingIds.add(rule.id);
        }
        dnrRules.length = 0;
        dnrRules.push(...kept, ...addRules);
      }),
    },
    action: {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
    },
    tabs: {
      create: vi.fn(async (props?: chrome.tabs.CreateProperties) => ({ id: 100, ...props })),
      update: vi.fn(async (tabId?: number, props?: chrome.tabs.UpdateProperties) => ({ id: tabId ?? 1, ...props })),
      query: vi.fn(async () => []),
      get: vi.fn(async (tabId: number) => ({ id: tabId, url: 'https://example.com' })),
      onCreated: makeChromeEvent(),
      onRemoved: makeChromeEvent(),
      onActivated: makeChromeEvent(),
      onUpdated: makeChromeEvent(),
    },
    runtime: {
      onInstalled: makeChromeEvent(),
      onStartup: makeChromeEvent(),
      onConnect: makeChromeEvent(),
      connect: vi.fn(() => ({
        name: 'sidepanel',
        onMessage: makeChromeEvent(),
        onDisconnect: makeChromeEvent(),
        postMessage: vi.fn(),
        disconnect: vi.fn(),
      })),
      getURL: vi.fn((path: string) => `chrome-extension://test-id/${path.replace(/^\//, '')}`),
      openOptionsPage: vi.fn(async () => {}),
      reload: vi.fn(),
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn((cb?: () => void) => {
        cb?.();
      }),
      onClicked: makeChromeEvent(),
    },
    commands: {
      onCommand: makeChromeEvent(),
      getAll: vi.fn(async () => []),
    },
    webNavigation: {
      onBeforeNavigate: makeChromeEvent(),
      onCommitted: makeChromeEvent(),
    },
    omnibox: {
      setDefaultSuggestion: vi.fn(),
      onInputChanged: makeChromeEvent(),
      onInputEntered: makeChromeEvent(),
    },
    sidePanel: { open: vi.fn(async () => {}) },
    windows: {
      WINDOW_ID_NONE: -1,
      getCurrent: vi.fn(async () => ({ id: 1 })),
      onFocusChanged: makeChromeEvent(),
    },
  };

  const chrome = chromeMock as unknown as typeof globalThis.chrome;

  // Empties all mock event listener arrays without clearing sync/local/session
  // storage so tests can simulate MV3 service worker termination + cold restart.
  function resetListeners(): void {
    const seen = new Set<unknown>();
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      const candidate = node as { listeners?: unknown; emit?: unknown };
      if (Array.isArray(candidate.listeners) && typeof candidate.emit === 'function') {
        candidate.listeners.length = 0;
        return;
      }
      for (const value of Object.values(node as Record<string, unknown>)) {
        visit(value);
      }
    };
    visit(chromeMock);
  }

  return { syncStore, localStore, sessionStore, dnrRules, chrome, resetListeners };
}
