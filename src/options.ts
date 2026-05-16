import { getStore } from './storage';
import { buildShortcutRow } from './ui';

const listEl = document.getElementById('shortcutList') as HTMLUListElement;
const emptyStateEl = document.getElementById('emptyState') as HTMLDivElement;
const countEl = document.getElementById('count') as HTMLDivElement;

async function render(): Promise<void> {
  const store = await getStore();
  const shortcuts = Object.values(store.shortcuts);

  countEl.textContent = `${shortcuts.length} / ${store.settings.maxShortcuts}`;
  listEl.innerHTML = '';

  const isEmpty = shortcuts.length === 0;
  emptyStateEl.hidden = !isEmpty;
  listEl.hidden = isEmpty;

  shortcuts.forEach((shortcut) => listEl.appendChild(buildShortcutRow(shortcut, render)));
}

render();
