import { deleteShortcut, getStore } from './storage';

const listEl = document.getElementById('shortcutList') as HTMLUListElement | null;
const countEl = document.getElementById('count') as HTMLDivElement | null;

async function render(): Promise<void> {
  const store = await getStore();
  const shortcuts = Object.values(store.shortcuts);

  if (countEl) {
    countEl.textContent = `${shortcuts.length} / ${store.settings.maxShortcuts}`;
  }

  if (!listEl) {
    return;
  }

  listEl.innerHTML = '';
  shortcuts.forEach((shortcut) => {
    const li = document.createElement('li');
    const item = document.createElement('div');
    item.className = 'item';

    const key = document.createElement('div');
    key.className = 'key';
    key.textContent = shortcut.key;

    const url = document.createElement('div');
    url.className = 'url';
    url.textContent =
      shortcut.type === 'bundle'
        ? `Bundle — ${shortcut.bundleUrls?.length ?? 0} URLs`
        : shortcut.url;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Delete';
    button.addEventListener('click', async () => {
      await deleteShortcut(shortcut.key);
      await render();
    });

    item.append(key, url);
    li.append(item, button);
    listEl.appendChild(li);
  });
}

render();
