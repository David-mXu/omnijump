import './theme.css';
import { IS_FIREFOX } from './platform';
import { SETTINGS_KEY, getStore } from './storage';

try {
  if (localStorage.getItem('omnijump_dark') === '1') {
    document.body.classList.add('dark');
  }
} catch { /* ignore */ }

function applyDarkMode(dark: boolean): void {
  document.body.classList.toggle('dark', dark);
  try {
    localStorage.setItem('omnijump_dark', dark ? '1' : '0');
  } catch { /* ignore */ }
}

async function init(): Promise<void> {
  try {
    const store = await getStore();
    applyDarkMode(store.settings.darkMode ?? false);
  } catch { /* defaults are fine */ }

  try {
    const commands = await chrome.commands.getAll();
    const popupCmd = commands.find((c) => c.name === '_execute_action');
    const hintEl = document.getElementById('popupShortcutHint');
    if (hintEl && popupCmd?.shortcut) {
      hintEl.textContent = ` (or press ${popupCmd.shortcut})`;
    }
    const panelCmdName = IS_FIREFOX ? '_execute_sidebar_action' : 'open-side-panel';
    const panelCmd = commands.find((c) => c.name === panelCmdName);
    const panelEl = document.getElementById('panelShortcut');
    if (panelEl && panelCmd?.shortcut) {
      panelEl.textContent = panelCmd.shortcut;
    }
  } catch { /* keep the defaults baked into the HTML */ }
}

document.getElementById('closeBtn')?.addEventListener('click', () => {
  window.close();
});

document.getElementById('openOptionsBtn')?.addEventListener('click', () => {
  try {
    chrome.runtime.openOptionsPage();
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') });
  }
});

void init();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && SETTINGS_KEY in changes) {
    const newSettings = changes[SETTINGS_KEY]?.newValue as { darkMode?: boolean } | undefined;
    applyDarkMode(newSettings?.darkMode ?? false);
  }
});
