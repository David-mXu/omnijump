import { deleteShortcut, normalizeKey, renameShortcut, restoreShortcuts, touchShortcut, upsertShortcut } from './storage';
import { icon } from './icons';
import { Shortcut } from './types';

export let hoveredRow: HTMLLIElement | null = null;

// The first few saves double as a tutorial: teach the address-bar trick.
export function savedStatusMessage(key: string, totalShortcuts: number): string {
  return totalShortcuts <= 3
    ? `Saved! Type "${key}" in your address bar and press Enter to jump.`
    : `Saved "${key}".`;
}

// Human-readable destination for confirm prompts.
export function describeTarget(s: Shortcut): string {
  if (s.type === 'bundle') {
    const n = s.bundleUrls?.length ?? 0;
    return `a bundle of ${n} ${n === 1 ? 'tab' : 'tabs'}`;
  }
  return displayUrl(s.urlTemplate ?? s.url);
}

// Inline collision prompt rendered into a form's status element: the keyword
// is taken, so the user picks between overwriting and a free alternative key.
export function renderOverwriteConfirm(
  statusEl: HTMLElement,
  existing: Shortcut,
  altKey: string | null,
  onOverwrite: () => void,
  onSaveAs: (altKey: string) => void,
): void {
  statusEl.className = 'form-status';
  statusEl.textContent = '';

  const text = document.createElement('span');
  text.textContent = `"${existing.key}" already points to ${describeTarget(existing)}. `;

  const overwriteBtn = document.createElement('button');
  overwriteBtn.type = 'button';
  overwriteBtn.className = 'btn-link confirm-overwrite';
  overwriteBtn.textContent = 'Overwrite';
  overwriteBtn.addEventListener('click', onOverwrite);

  statusEl.append(text, overwriteBtn);

  if (altKey) {
    const altBtn = document.createElement('button');
    altBtn.type = 'button';
    altBtn.className = 'btn-link';
    altBtn.textContent = `Save as "${altKey}"`;
    altBtn.addEventListener('click', () => onSaveAs(altKey));
    statusEl.append(document.createTextNode(' · '), altBtn);
  }
}

// Bottom-of-page toast with an Undo action; replaces any toast still showing.
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showUndoToast(message: string, onUndo: () => void | Promise<void>): void {
  document.querySelector('.undo-toast')?.remove();
  if (toastTimer !== null) clearTimeout(toastTimer);

  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.textContent = message;

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'undo-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => {
    if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null; }
    toast.remove();
    void onUndo();
  });

  toast.append(text, undoBtn);
  document.body.appendChild(toast);
  toastTimer = setTimeout(() => { toast.remove(); toastTimer = null; }, 6000);
}

// Opens a shortcut the way the omnibar would: bundles open every tab.
export function openShortcut(shortcut: Shortcut): void {
  const urls = shortcut.type === 'bundle' && shortcut.bundleUrls?.length
    ? shortcut.bundleUrls
    : [shortcut.url];
  urls.forEach((url, i) => chrome.tabs.create({ url, active: i === 0 }));
  void touchShortcut(shortcut.key);
}

export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  // Block non-http(s) schemes (javascript:, data:, vbscript:, file:, blob:, etc.)
  if (/^[a-z][a-z0-9+\-.]*:/i.test(s)) return '';
  return `https://${s}`;
}

export function displayUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

let editingRow: HTMLLIElement | null = null;

function openEdit(li: HTMLLIElement): void {
  if (editingRow && editingRow !== li) editingRow.classList.remove('editing');
  editingRow = li;
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
  urlTemplate?: string,
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
    } else if (original.type === 'parameterized') {
      const template = urlTemplate?.trim() || '';
      if (!template.includes('%s')) {
        statusEl.textContent = 'Search URL must include %s.';
        return;
      }
      const fallbackUrl = normalizeUrl(urlOrLabel) || template.replace('%s', '');
      updated = { ...original, key: newKey, url: fallbackUrl, urlTemplate: template };
    } else {
      updated = { ...original, key: newKey, label: urlOrLabel.trim() || undefined };
    }

    if (newKey !== original.key) {
      // Write new key first so a storage failure can't lose the original.
      await renameShortcut(original.key, updated);
    } else {
      await upsertShortcut(updated);
    }
    editingRow = null;
    await onRender();
  } catch (err) {
    statusEl.textContent = (err as Error).message;
  }
}

export function buildShortcutRow(
  shortcut: Shortcut,
  onRender: () => Promise<void>,
  onAlias?: (shortcut: Shortcut) => void,
  isAlias = false,
  onEditBundle?: (shortcut: Shortcut) => void,
): HTMLLIElement {
  const li = document.createElement('li');
  if (isAlias) li.classList.add('alias-row');

  // ── Display row ────────────────────────────────────────────────────────────
  const displayRow = document.createElement('div');
  displayRow.className = 'display-row';

  // Keycap — the keyword you type. The signature element.
  const keycap = document.createElement('span');
  keycap.className = 'key';
  keycap.textContent = shortcut.key;

  const item = document.createElement('div');
  item.className = 'item';

  // Primary line: label, else the destination's identity.
  const primary = document.createElement('div');
  primary.className = 'primary';
  if (shortcut.label) {
    primary.textContent = shortcut.label;
  } else if (shortcut.type === 'bundle') {
    const n = shortcut.bundleUrls?.length ?? 0;
    primary.textContent = `${n} ${n === 1 ? 'tab' : 'tabs'}`;
  } else {
    primary.textContent = displayUrl(shortcut.url);
  }
  if (shortcut.type === 'bundle') {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'bundle';
    primary.appendChild(badge);
  } else if (shortcut.type === 'parameterized') {
    const badge = document.createElement('span');
    badge.className = 'badge badge-search';
    badge.textContent = 'search';
    primary.appendChild(badge);
  }

  // Secondary line: shown only when it adds detail beyond the primary line.
  const urlLine = document.createElement('div');
  urlLine.className = 'url';
  if (shortcut.type === 'bundle') {
    if (shortcut.label) {
      const n = shortcut.bundleUrls?.length ?? 0;
      urlLine.textContent = `${n} ${n === 1 ? 'tab' : 'tabs'}`;
    }
  } else if (shortcut.type === 'parameterized') {
    urlLine.textContent = shortcut.urlTemplate ?? displayUrl(shortcut.url);
    urlLine.title = shortcut.urlTemplate ?? shortcut.url;
  } else if (shortcut.label) {
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

  item.append(primary, urlLine, stats);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-icon edit-btn';
  editBtn.title = 'Edit';
  editBtn.setAttribute('aria-label', `Edit ${shortcut.key}`);
  editBtn.innerHTML = icon('edit');
  // Bundles are edited in the full bundle form (URLs included) when the host
  // page provides one; the inline form only covers key + label.
  if (shortcut.type === 'bundle' && onEditBundle) {
    editBtn.addEventListener('click', () => onEditBundle(shortcut));
  } else {
    editBtn.addEventListener('click', () => openEdit(li));
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-icon danger';
  deleteBtn.title = 'Delete';
  deleteBtn.setAttribute('aria-label', `Delete ${shortcut.key}`);
  deleteBtn.innerHTML = icon('trash');
  deleteBtn.addEventListener('click', async () => {
    await deleteShortcut(shortcut.key);
    await onRender();
    showUndoToast(`Deleted "${shortcut.key}"`, async () => {
      await restoreShortcuts([shortcut]);
      await onRender();
    });
  });

  if (onAlias && shortcut.type !== 'bundle') {
    const aliasBtn = document.createElement('button');
    aliasBtn.type = 'button';
    aliasBtn.className = 'btn-icon';
    aliasBtn.title = 'Add alias';
    aliasBtn.setAttribute('aria-label', `Add alias for ${shortcut.key}`);
    aliasBtn.innerHTML = icon('alias');
    aliasBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onAlias(shortcut);
    });
    displayRow.append(keycap, item, aliasBtn, editBtn, deleteBtn);
  } else {
    displayRow.append(keycap, item, editBtn, deleteBtn);
  }

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

  let urlTemplateInput: HTMLInputElement | null = null;
  if (shortcut.type === 'parameterized') {
    secondInput.value = shortcut.urlTemplate ?? '';
    secondInput.placeholder = 'https://site.com/search?q=%s';
    urlTemplateInput = secondInput;
  }

  const editActions = document.createElement('div');
  editActions.className = 'edit-actions';

  const editStatus = document.createElement('div');
  editStatus.className = 'edit-status';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-primary btn-sm';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    if (shortcut.type === 'parameterized') {
      saveEdit(li, shortcut, keyInput.value, '', editStatus, onRender, secondInput.value);
    } else {
      saveEdit(li, shortcut, keyInput.value, secondInput.value, editStatus, onRender);
    }
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary btn-sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    li.classList.remove('editing');
    if (editingRow === li) editingRow = null;
  });

  if (onAlias && shortcut.type !== 'bundle') {
    const editAliasBtn = document.createElement('button');
    editAliasBtn.type = 'button';
    editAliasBtn.className = 'btn-secondary btn-sm';
    editAliasBtn.textContent = 'Add alias';
    editAliasBtn.addEventListener('click', () => {
      li.classList.remove('editing');
      if (editingRow === li) editingRow = null;
      onAlias(shortcut);
    });
    editActions.append(saveBtn, cancelBtn, editAliasBtn);
  } else {
    editActions.append(saveBtn, cancelBtn);
  }
  editForm.append(keyInput, secondInput, editActions, editStatus);

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'select-cb';
  cb.dataset.key = shortcut.key;

  li.tabIndex = 0;
  li.dataset.url = shortcut.url;
  li.dataset.key = shortcut.key;
  li.addEventListener('mouseenter', () => { hoveredRow = li; });
  li.addEventListener('mouseleave', () => { if (hoveredRow === li) hoveredRow = null; });

  displayRow.prepend(cb);

  displayRow.addEventListener('click', (e) => {
    if (li.closest('ul')?.classList.contains('selecting')) {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // Row buttons keep their own actions; anywhere else opens the shortcut.
    if ((e.target as HTMLElement).closest('button')) return;
    openShortcut(shortcut);
  });

  li.append(displayRow, editForm);
  return li;
}
