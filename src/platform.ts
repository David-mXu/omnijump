export const IS_FIREFOX = import.meta.env.MODE === 'firefox';

export function openSidePanel(tabId: number): void {
  if (IS_FIREFOX) {
    (globalThis as any).browser?.sidebarAction?.open();
  } else {
    chrome.sidePanel.open({ tabId });
  }
}
