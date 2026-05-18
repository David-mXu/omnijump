import { deleteShortcut, normalizeKey, renameShortcut, upsertShortcut } from './storage';
import { Shortcut } from './types';

export let hoveredRow: HTMLLIElement | null = null;

export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s || /^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function displayUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function openEdit(li: HTMLLIElement): void {
  document.querySelectorAll<HTMLLIElement>('li.editing').forEach(el => el.classList.remove('editing'));
  li.classList.add('editing');
  li.querySelector<HTMLInputElement>('.edit-form input')?.focus();
}

async function saveEdit(
  li: HTMLLIElement,
  original: Shortcut,
  rawKey: string,
  urlOrLabel: string,
  statusEl: HTMLDivElement,
  onRender: () => Promise<void>,
): Promise<void> {
  const newKey = normalizeKey(rawKey);
  statusEl.textContent = '';

  if (!newKey) {
    statusEl.textContent = 'Keyword cannot be empty.';
    return;
  }

  try {
    let updated: Shortcut;
    if (original.type === 'redirect') {
      const url = normalizeUrl(urlOrLabel);
      if (!url) { statusEl.textContent = 'Enter a URL.'; return; }
      updated = { ...original, key: newKey, url };
    } else {
      updated = { ...original, key: newKey, label: urlOrLabel.trim() || undefined };
    }

    if (newKey !== original.key) {
      // Write new key first so a storage failure can't lose the original.
      await renameShortcut(original.key, updated);
    } else {
      await upsertShortcut(updated);
    }
    await onRender();
  } catch (err) {
    statusEl.textContent = (err as Error).message;
  }
}

export function buildShortcutRow(
  shortcut: Shortcut,
  onRender: () => Promise<void>,
): HTMLLIElement {
  const li = document.createElement('li');

  // ── Display row ────────────────────────────────────────────────────────────
  const displayRow = document.createElement('div');
  displayRow.className = 'display-row';

  const item = document.createElement('div');
  item.className = 'item';

  const keyLine = document.createElement('div');
  keyLine.className = 'key';
  keyLine.textContent = shortcut.label ?? shortcut.key;
  if (shortcut.type === 'bundle') {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'bundle';
    keyLine.appendChild(badge);
  } else if (shortcut.type === 'parameterized') {
    const badge = document.createElement('span');
    badge.className = 'badge badge-search';
    badge.textContent = 'search';
    keyLine.appendChild(badge);
  }

  const urlLine = document.createElement('div');
  urlLine.className = 'url';
  if (shortcut.type === 'bundle') {
    urlLine.textContent = `${shortcut.bundleUrls?.length ?? 0} URLs`;
  } else if (shortcut.type === 'parameterized') {
    urlLine.textContent = shortcut.urlTemplate ?? displayUrl(shortcut.url);
    urlLine.title = shortcut.urlTemplate ?? shortcut.url;
  } else {
    urlLine.textContent = displayUrl(shortcut.url);
    urlLine.title = shortcut.url;
  }

  const stats = document.createElement('div');
  stats.className = 'stats';
  const parts: string[] = [];
  if (shortcut.useCount) parts.push(`${shortcut.useCount}×`);
  if (shortcut.lastUsed) {
    const days = Math.floor((Date.now() - shortcut.lastUsed) / 86_400_000);
    parts.push(days === 0 ? 'today' : `${days}d ago`);
  }
  if (parts.length) stats.textContent = parts.join(' · ');

  item.append(keyLine, urlLine, stats);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-icon';
  editBtn.title = 'Edit';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => openEdit(li));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-icon danger';
  deleteBtn.title = 'Delete';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', async () => {
    await deleteShortcut(shortcut.key);
    await onRender();
  });

  displayRow.append(item, editBtn, deleteBtn);

  // ── Edit form ──────────────────────────────────────────────────────────────
  const editForm = document.createElement('div');
  editForm.className = 'edit-form';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.value = shortcut.key;
  keyInput.placeholder = 'keyword';
  keyInput.autocomplete = 'off';

  const secondInput = document.createElement('input');
  secondInput.type = 'text';
  if (shortcut.type === 'redirect') {
    secondInput.value = shortcut.url;
    secondInput.placeholder = 'google.com or https://...';
  } else {
    secondInput.value = shortcut.label ?? '';
    secondInput.placeholder = 'Label (optional)';
  }

  const editActions = document.createElement('div');
  editActions.className = 'edit-actions';

  const editStatus = document.createElement('div');
  editStatus.className = 'edit-status';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-primary btn-sm';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () =>
    saveEdit(li, shortcut, keyInput.value, secondInput.value, editStatus, onRender)
  );

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary btn-sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => li.classList.remove('editing'));

  editActions.append(saveBtn, cancelBtn);
  editForm.append(keyInput, secondInput, editActions, editStatus);

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'select-cb';
  cb.dataset.key = shortcut.key;

  li.tabIndex = 0;
  li.dataset.url = shortcut.url;
  li.addEventListener('mouseenter', () => { hoveredRow = li; });
  li.addEventListener('mouseleave', () => { if (hoveredRow === li) hoveredRow = null; });

  displayRow.prepend(cb);

  displayRow.addEventListener('click', (e) => {
    if (!li.closest('ul')?.classList.contains('selecting')) return;
    if (e.target === cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });

  li.append(displayRow, editForm);
  return li;
}
