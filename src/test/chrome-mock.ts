import { vi } from 'vitest';

export function createChromeMock() {
  const syncStore: Record<string, unknown> = {};
  const localStore: Record<string, unknown> = {};
  const sessionStore: Record<string, unknown> = {};
  const dnrRules: chrome.declarativeNetRequest.Rule[] = [];

  function makeStorage(store: Record<string, unknown>) {
    return {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return { ...store };
        if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
        return Object.fromEntries(
          (keys as string[]).filter(k => k in store).map(k => [k, store[k]])
        );
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      }),
    };
  }

  const chrome = {
    storage: {
      sync: makeStorage(syncStore),
      local: makeStorage(localStore),
      session: makeStorage(sessionStore),
      onChanged: { addListener: vi.fn() },
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
        const kept = dnrRules.filter(r => !removeRuleIds.includes(r.id));
        dnrRules.length = 0;
        dnrRules.push(...kept, ...addRules);
      }),
    },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}) },
    tabs: { create: vi.fn(), query: vi.fn() },
    runtime: { onInstalled: { addListener: vi.fn() } },
    contextMenus: { create: vi.fn(), removeAll: vi.fn(), onClicked: { addListener: vi.fn() } },
    commands: { onCommand: { addListener: vi.fn() } },
    webNavigation: { onBeforeNavigate: { addListener: vi.fn() }, onCommitted: { addListener: vi.fn() } },
    sidePanel: { open: vi.fn() },
    windows: { getCurrent: vi.fn() },
  } as unknown as typeof globalThis.chrome;

  return { syncStore, localStore, sessionStore, dnrRules, chrome };
}
