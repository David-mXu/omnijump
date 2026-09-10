import './theme.css';
import { IS_FIREFOX } from './platform';
import { getStore } from './storage';

async function init(): Promise<void> {
  try {
    const store = await getStore();
    document.body.classList.toggle('dark', store.settings.darkMode ?? false);
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

init();
