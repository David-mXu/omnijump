import { deleteShortcut, normalizeKey, renameShortcut, restoreShortcuts, touchShortcut, upsertShortcut } from './storage';
import { icon } from './icons';
import { MAX_KEY_LENGTH, MAX_LABEL_LENGTH, MAX_PARAMETERIZED_KEY_LENGTH, MAX_URL_LENGTH, Shortcut } from './types';
import { deriveSearchFallbackUrl, normalizeUrl } from './suggest';
import { sanitizeStoredUrl } from './url';

export { deriveSearchFallbackUrl, normalizeUrl };

export let hoveredRow: HTMLLIElement | null = null;

// The first few saves double as a tutorial: teach the address-bar trick.
export function savedStatusMessage(key: string, totalShortcuts: number): string {
  return totalShortcuts <= 3
    ? `Saved! Type "${key}" in your address bar and press Enter to jump.`
    : `Saved "${key}".`;
}

export function displayUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function formatBundlePreview(urls: string[] | undefined): string {
  const list = urls ?? [];
  const n = list.length;
  const countText = `${n} ${n === 1 ? 'tab' : 'tabs'}`;
  if (n === 0) return countText;
  const hosts: string[] = [];
  for (const u of list) {
    const h = displayUrl(u).replace(/^www\./i, '');
    if (h && !hosts.includes(h)) hosts.push(h);
  }
  if (hosts.length === 0) return countText;
  const shown = hosts.slice(0, 2);
  const extra = Math.max(0, n - shown.length);
  return `${countText} · ${shown.join(', ')}${extra > 0 ? ` +${extra}` : ''}`;
}

// Human-readable destination for confirm prompts.
export function describeTarget(s: Shortcut): string {
  if (s.type === 'bundle') {
    return formatBundlePreview(s.bundleUrls);
  }
  return displayUrl(s.urlTemplate ?? s.url);
}

export function groupShortcuts(shortcuts: Shortcut[]): Array<{ shortcut: Shortcut; isAlias: boolean }> {
  const groupKey = (s: Shortcut) =>
    s.type === 'bundle' ? `bundle:${s.key}` :
    s.type === 'parameterized' ? (s.urlTemplate ?? s.url) :
    s.url.replace(/\/+$/, '');

  const urlGroups = new Map<string, Shortcut[]>();
  for (const s of shortcuts) {
    const k = groupKey(s);
    if (!urlGroups.has(k)) urlGroups.set(k, []);
    urlGroups.get(k)!.push(s);
  }

  const emitted = new Set<string>();
  const result: Array<{ shortcut: Shortcut; isAlias: boolean }> = [];
  for (const s of shortcuts) {
    const k = groupKey(s);
    if (emitted.has(k)) continue;
    emitted.add(k);
    urlGroups.get(k)!.forEach((gs, i) => result.push({ shortcut: gs, isAlias: i > 0 }));
  }
  return result;
}

export function hasShortcutTargetCollision(existing: Shortcut | undefined, candidate: Shortcut): boolean {
  if (!existing) return false;
  return (
    existing.type !== candidate.type ||
    (existing.urlTemplate ?? '') !== (candidate.urlTemplate ?? '') ||
    existing.url !== candidate.url ||
    JSON.stringify(existing.bundleUrls ?? []) !== JSON.stringify(candidate.bundleUrls ?? [])
  );
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

// Transient non-actionable status message (used when an undo only partially
// succeeds, where offering another Undo would be misleading).
export function showToast(message: string): void {
  if (typeof document === 'undefined') return;
  document.querySelector('.undo-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

// Opens a shortcut the way the omnibar would: bundles open every tab.
export function openShortcut(shortcut: Shortcut): void {
  const urls = (shortcut.type === 'bundle' && shortcut.bundleUrls?.length
    ? shortcut.bundleUrls
    : [shortcut.url]
  ).filter((u) => /^https?:\/\//i.test(u));
  if (urls.length === 0) return;
  urls.forEach((url, i) => chrome.tabs.create({ url, active: i === 0 }));
  void touchShortcut(shortcut.key);
}

// ── Delete confirmation state ('d' key / click verification) ──────────────────
export let pendingDeleteKey: string | null = null;
let pendingDeleteRow: HTMLLIElement | null = null;
let pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelPendingDelete(): void {
  if (pendingDeleteTimer !== null) {
    clearTimeout(pendingDeleteTimer);
    pendingDeleteTimer = null;
  }
  if (pendingDeleteRow) {
    pendingDeleteRow.classList.remove('pending-delete');
    const btn = pendingDeleteRow.querySelector<HTMLButtonElement>('.btn-icon.danger');
    if (btn) {
      btn.classList.remove('confirm-delete');
      btn.title = 'Delete';
      btn.setAttribute('aria-label', `Delete ${pendingDeleteRow.dataset.key ?? ''}`);
    }
    pendingDeleteRow = null;
  }
  pendingDeleteKey = null;
  if (typeof document !== 'undefined') {
    document.querySelector('.delete-confirm-toast')?.remove();
  }
}

export function showDeleteConfirmToast(
  key: string,
  onCancel: () => void,
  onConfirm?: () => void,
): void {
  if (typeof document === 'undefined') return;
  document.querySelector('.delete-confirm-toast')?.remove();
  document.querySelector('.undo-toast')?.remove();

  const toast = document.createElement('div');
  toast.className = 'delete-confirm-toast';
  toast.setAttribute('role', 'alert');

  const text = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = key;
  const kbd = document.createElement('kbd');
  kbd.className = 'kbd';
  kbd.textContent = 'd';
  text.append(
    document.createTextNode('Delete '),
    strong,
    document.createTextNode('? Press '),
    kbd,
    document.createTextNode(' again to confirm'),
  );

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'confirm-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    onCancel();
  });

  if (onConfirm) {
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn-sm danger confirm-delete-btn';
    confirmBtn.textContent = 'Delete';
    confirmBtn.addEventListener('click', () => {
      onConfirm();
    });
    toast.append(text, confirmBtn, cancelBtn);
  } else {
    toast.append(text, cancelBtn);
  }

  document.body.appendChild(toast);
}

let editingRow: HTMLLIElement | null = null;
// The host page's render function. Used to replay a render that was deferred
// while the inline editor was open, once the editor is cancelled.
let rowRender: (() => Promise<void>) | null = null;

export function isRowEditing(): boolean {
  return editingRow !== null;
}

export function cancelRowEdit(options: { restoreFocus?: boolean } = {}): void {
  cancelPendingDelete();
  const wasEditing = editingRow !== null;
  const key = editingRow?.dataset.key;
  if (editingRow) {
    const row = editingRow;
    row.classList.remove('editing');
    editingRow = null;
    row.focus();
  }
  if (wasEditing && rowRender) {
    // Refresh replaces the row, so restore focus to its replacement.
    const render = rowRender;
    void Promise.resolve(render()).then(() => {
      // Callers that move focus elsewhere (the Add-alias path fills the add
      // form) must win; only Escape/Cancel ask for focus restoration.
      if (options.restoreFocus && key && typeof document !== 'undefined') {
        document.querySelector<HTMLLIElement>(`li[data-key="${key}"]`)?.focus();
      }
    });
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pendingDeleteKey) {
        cancelPendingDelete();
        return;
      }
      if (editingRow) {
        cancelRowEdit({ restoreFocus: true });
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (pendingDeleteKey) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        !target.closest('.delete-confirm-toast') &&
        !target.closest('.pending-delete')
      ) {
        cancelPendingDelete();
      }
    }
  });
}

function openEdit(li: HTMLLIElement): void {
  cancelPendingDelete();
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
  rawLabel?: string,
  rawFallback?: string,
): Promise<void> {
  const newKey = normalizeKey(rawKey);
  statusEl.textContent = '';

  if (!newKey) {
    statusEl.textContent = 'Keyword cannot be empty.';
    return;
  }
  // Records saved by older versions may have keys above the new DNR-safe cap.
  // Editing them in place is allowed (storage enforces the same rule); only a
  // rename to a *new* over-cap key is rejected.
  const keyUnchanged = newKey === normalizeKey(original.key);
  const maxKeyLength = keyUnchanged
    ? 64
    : original.type === 'parameterized'
      ? MAX_PARAMETERIZED_KEY_LENGTH
      : MAX_KEY_LENGTH;
  if (newKey.length > maxKeyLength) {
    statusEl.textContent = `Keyword is too long (max ${maxKeyLength} characters).`;
    return;
  }

  const trimmedLabel = (original.type === 'bundle' ? urlOrLabel : (rawLabel ?? '')).trim();
  if (trimmedLabel.length > MAX_LABEL_LENGTH) {
    statusEl.textContent = `Label is too long (max ${MAX_LABEL_LENGTH} characters).`;
    return;
  }

  try {
    let updated: Shortcut;
    if (original.type === 'redirect') {
      if (urlOrLabel.trim().length > MAX_URL_LENGTH) {
        statusEl.textContent = `URL is too long (max ${MAX_URL_LENGTH} characters).`;
        return;
      }
      const url = sanitizeStoredUrl(urlOrLabel);
      if (!url) { statusEl.textContent = 'Enter a valid http(s) URL.'; return; }
      updated = { ...original, key: newKey, url, label: trimmedLabel || undefined };
    } else if (original.type === 'parameterized') {
      const rawTemplate = urlTemplate?.trim() || '';
      if (!rawTemplate.includes('%s')) {
        statusEl.textContent = 'Search URL must include %s.';
        return;
      }
      if (rawTemplate.length > MAX_URL_LENGTH) {
        statusEl.textContent = `Search URL is too long (max ${MAX_URL_LENGTH} characters).`;
        return;
      }
      const normalizedTemplate = normalizeUrl(rawTemplate);
      if (!normalizedTemplate) {
        statusEl.textContent = 'Enter a valid http(s) search URL template.';
        return;
      }
      const trimmedFallback = (rawFallback ?? '').trim();
      let normalizedFallback: string | undefined;
      if (trimmedFallback) {
        const nf = normalizeUrl(trimmedFallback);
        if (!nf) {
          statusEl.textContent = 'Enter a valid http(s) fallback URL.';
          return;
        }
        normalizedFallback = nf;
      }
      const fallbackUrl = deriveSearchFallbackUrl(normalizedTemplate, normalizedFallback);
      updated = {
        ...original,
        key: newKey,
        url: fallbackUrl,
        urlTemplate: normalizedTemplate,
        label: trimmedLabel || undefined,
      };
    } else {
      updated = { ...original, key: newKey, label: trimmedLabel || undefined };
    }

    if (newKey !== original.key) {
      // Write new key first so a storage failure can't lose the original.
      await renameShortcut(original.key, updated);
    } else {
      await upsertShortcut(updated);
    }
    editingRow = null;
    await onRender();
    if (typeof document !== 'undefined') {
      document.querySelector<HTMLLIElement>(`li[data-key="${newKey}"]`)?.focus();
    }
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
  rowRender = onRender;
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
    urlLine.textContent = formatBundlePreview(shortcut.bundleUrls);
    urlLine.title = (shortcut.bundleUrls ?? []).join('\n');
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

  const confirmDelete = async () => {
    cancelPendingDelete();
    await deleteShortcut(shortcut.key);
    await onRender();
    showUndoToast(`Deleted "${shortcut.key}"`, async () => {
      const result = await restoreShortcuts([shortcut]);
      await onRender();
      if (result.skipped.length > 0) {
        showToast(`Could not restore "${shortcut.key}" — that keyword is now in use.`);
      } else if (result.invalid.length > 0) {
        showToast(`Could not restore "${shortcut.key}" — the saved record is no longer valid.`);
      }
    });
  };

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-icon danger';
  deleteBtn.title = 'Delete';
  deleteBtn.setAttribute('aria-label', `Delete ${shortcut.key}`);
  deleteBtn.innerHTML = icon('trash');
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (pendingDeleteKey === shortcut.key) {
      await confirmDelete();
    } else {
      cancelPendingDelete();
      pendingDeleteKey = shortcut.key;
      pendingDeleteRow = li;
      li.classList.add('pending-delete');
      deleteBtn.classList.add('confirm-delete');
      deleteBtn.title = `Press 'd' again to confirm`;
      deleteBtn.setAttribute('aria-label', `Press 'd' again to confirm deleting ${shortcut.key}`);
      showDeleteConfirmToast(
        shortcut.key,
        () => { cancelPendingDelete(); },
        () => { void confirmDelete(); },
      );
      pendingDeleteTimer = setTimeout(() => {
        cancelPendingDelete();
      }, 4000);
    }
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
  keyInput.setAttribute('aria-label', 'Shortcut keyword');

  const secondInput = document.createElement('input');
  secondInput.type = 'text';

  let fallbackInput: HTMLInputElement | null = null;
  let labelInput: HTMLInputElement | null = null;
  const editInputs: HTMLInputElement[] = [keyInput, secondInput];

  if (shortcut.type === 'redirect') {
    secondInput.value = shortcut.url;
    secondInput.placeholder = 'google.com or https://...';
    secondInput.setAttribute('aria-label', 'Target URL');

    labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = shortcut.label ?? '';
    labelInput.placeholder = 'Label (optional)';
    labelInput.setAttribute('aria-label', 'Label (optional)');
    editInputs.push(labelInput);
  } else if (shortcut.type === 'parameterized') {
    secondInput.value = shortcut.urlTemplate ?? '';
    secondInput.placeholder = 'https://example.com/search?q=%s';
    secondInput.setAttribute('aria-label', 'Search URL template');

    fallbackInput = document.createElement('input');
    fallbackInput.type = 'text';
    fallbackInput.value = shortcut.url ?? '';
    fallbackInput.placeholder = 'Fallback URL (optional)';
    fallbackInput.setAttribute('aria-label', 'Fallback URL (optional)');

    labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = shortcut.label ?? '';
    labelInput.placeholder = 'Label (optional)';
    labelInput.setAttribute('aria-label', 'Label (optional)');
    editInputs.push(fallbackInput, labelInput);
  } else {
    secondInput.value = shortcut.label ?? '';
    secondInput.placeholder = 'Label (optional)';
    secondInput.setAttribute('aria-label', 'Label (optional)');
  }

  const editActions = document.createElement('div');
  editActions.className = 'edit-actions';

  const editStatus = document.createElement('div');
  editStatus.className = 'edit-status error';
  editStatus.setAttribute('role', 'status');

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-primary btn-sm';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    if (shortcut.type === 'parameterized') {
      void saveEdit(
        li,
        shortcut,
        keyInput.value,
        '',
        editStatus,
        onRender,
        secondInput.value,
        labelInput?.value ?? '',
        fallbackInput?.value ?? '',
      );
    } else if (shortcut.type === 'redirect') {
      void saveEdit(
        li,
        shortcut,
        keyInput.value,
        secondInput.value,
        editStatus,
        onRender,
        undefined,
        labelInput?.value ?? '',
      );
    } else {
      void saveEdit(li, shortcut, keyInput.value, secondInput.value, editStatus, onRender);
    }
  });

  for (const inp of editInputs) {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBtn.click();
      }
    });
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary btn-sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    cancelRowEdit({ restoreFocus: true });
  });

  if (onAlias && shortcut.type !== 'bundle') {
    const editAliasBtn = document.createElement('button');
    editAliasBtn.type = 'button';
    editAliasBtn.className = 'btn-secondary btn-sm';
    editAliasBtn.textContent = 'Add alias';
    editAliasBtn.addEventListener('click', () => {
      cancelRowEdit();
      onAlias(shortcut);
    });
    editActions.append(saveBtn, cancelBtn, editAliasBtn);
  } else {
    editActions.append(saveBtn, cancelBtn);
  }
  editForm.append(...editInputs, editActions, editStatus);

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'select-cb';
  cb.dataset.key = shortcut.key;
  cb.setAttribute('aria-label', `Select ${shortcut.key}`);

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
