import { deleteShortcut, getStore } from './storage';
import { buildShortcutRow } from './ui';

const listEl = document.getElementById('shortcutList') as HTMLUListElement;
const emptyStateEl = document.getElementById('emptyState') as HTMLDivElement;
const noResultsEl = document.getElementById('noResults') as HTMLDivElement;
const countEl = document.getElementById('count') as HTMLDivElement;
const filterInput = document.getElementById('filterInput') as HTMLInputElement;
const selectToggleBtn = document.getElementById('selectToggle') as HTMLButtonElement;
const deleteSelectedBtn = document.getElementById('deleteSelected') as HTMLButtonElement;

async function render(): Promise<void> {
  const store = await getStore();
  const shortcuts = Object.values(store.shortcuts);

  filterInput.hidden = shortcuts.length < store.settings.filterThreshold;

  const query = filterInput.value.toLowerCase();
  const filtered = query
    ? shortcuts.filter(s =>
        s.key.includes(query) ||
        s.url.toLowerCase().includes(query) ||
        (s.label ?? '').toLowerCase().includes(query)
      )
    : shortcuts;

  countEl.textContent = `${shortcuts.length} / ${store.settings.maxShortcuts}`;
  listEl.innerHTML = '';

  const isEmpty = shortcuts.length === 0;
  const noResults = !isEmpty && filtered.length === 0;
  emptyStateEl.hidden = !isEmpty;
  noResultsEl.hidden = !noResults;
  listEl.hidden = isEmpty || noResults;

  filtered.forEach((shortcut) => listEl.appendChild(buildShortcutRow(shortcut, render)));
}

filterInput.addEventListener('input', render);

// ── Multi-select ──────────────────────────────────────────────────────────────
selectToggleBtn.addEventListener('click', () => {
  const entering = !listEl.classList.contains('selecting');
  listEl.classList.toggle('selecting', entering);
  selectToggleBtn.textContent = entering ? 'Cancel' : 'Select';
  deleteSelectedBtn.hidden = true;
  listEl.querySelectorAll<HTMLInputElement>('.select-cb').forEach(cb => { cb.checked = false; });
});

listEl.addEventListener('change', () => {
  const count = listEl.querySelectorAll<HTMLInputElement>('.select-cb:checked').length;
  deleteSelectedBtn.hidden = count === 0;
  deleteSelectedBtn.textContent = `Delete (${count})`;
});

deleteSelectedBtn.addEventListener('click', async () => {
  const keys = Array.from(
    listEl.querySelectorAll<HTMLInputElement>('.select-cb:checked')
  ).map(cb => cb.dataset.key!);
  await Promise.all(keys.map(deleteShortcut));
  listEl.classList.remove('selecting');
  selectToggleBtn.textContent = 'Select';
  deleteSelectedBtn.hidden = true;
  await render();
});

render();
