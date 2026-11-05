import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createChromeMock } from './test/chrome-mock';
import { createDomMock } from './test/dom-mock';
import { Shortcut } from './types';

const mockChrome = createChromeMock();
const domMock = createDomMock();
(globalThis as any).chrome = mockChrome.chrome;
(globalThis as any).document = domMock.doc;

// Import modules once document and chrome are defined
const {
  buildShortcutRow,
  cancelPendingDelete,
  cancelRowEdit,
  describeTarget,
  groupShortcuts,
  hasShortcutTargetCollision,
  openShortcut,
  renderOverwriteConfirm,
  savedStatusMessage,
  showDeleteConfirmToast,
  showUndoToast,
} = await import('./ui');
const { upsertShortcut, getStore } = await import('./storage');

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('UI delete confirmation flow', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    domMock.doc.reset();
    cancelPendingDelete();
    cancelRowEdit();
    await mockChrome.chrome.storage.sync.clear();
  });

  afterEach(() => {
    cancelPendingDelete();
    cancelRowEdit();
    vi.useRealTimers();
  });

  it('escapes malicious shortcut keys in showDeleteConfirmToast (DOM XSS regression)', async () => {
    const maliciousKey = '<img src=x onerror=alert(1)>';
    showDeleteConfirmToast(maliciousKey, () => {});

    const toast = domMock.body.querySelector('.delete-confirm-toast');
    expect(toast).toBeTruthy();

    const strong = toast?.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe(maliciousKey);
    expect(strong?.innerHTML).toBe('');
    expect(toast?.innerHTML).not.toContain('<img');
    expect(toast?.querySelector('img')).toBeNull();
  });

  it('renders a mouse confirm Delete button in the toast that deletes the shortcut and shows Undo', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    let store = await getStore();
    const shortcut: Shortcut = store.shortcuts['gh'];

    let renderCount = 0;
    const onRender = async () => { renderCount++; };

    const row = buildShortcutRow(shortcut, onRender) as any;
    domMock.body.appendChild(row);

    const deleteBtn = row.querySelector('.btn-icon.danger');
    await deleteBtn.click();

    const confirmToast = domMock.body.querySelector('.delete-confirm-toast');
    expect(confirmToast).toBeTruthy();

    const confirmDeleteBtn = confirmToast?.querySelector('.confirm-delete-btn');
    const cancelBtn = confirmToast?.querySelector('.confirm-cancel-btn');
    expect(confirmDeleteBtn).toBeTruthy();
    expect(confirmDeleteBtn?.textContent).toBe('Delete');
    expect(cancelBtn).toBeTruthy();
    expect(cancelBtn?.textContent).toBe('Cancel');

    await confirmDeleteBtn!.click();
    await flushPromises();

    store = await getStore();
    expect(store.shortcuts['gh']).toBeUndefined();
    expect(renderCount).toBe(1);
    expect(domMock.body.querySelector('.delete-confirm-toast')).toBeNull();

    const undoToast = domMock.body.querySelector('.undo-toast');
    expect(undoToast).toBeTruthy();
    expect(undoToast?.textContent).toContain('Deleted "gh"');

    // Clicking Undo restores the shortcut
    const undoBtn = undoToast?.querySelector('.undo-btn');
    expect(undoBtn).toBeTruthy();
    await undoBtn!.click();
    await flushPromises();

    store = await getStore();
    expect(store.shortcuts['gh']).toBeDefined();
    expect(renderCount).toBe(2);
  });

  it('requires two clicks/keypresses to delete a shortcut', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    let store = await getStore();
    expect(store.shortcuts['gh']).toBeDefined();

    const shortcut: Shortcut = store.shortcuts['gh'];
    let rendered = false;
    const onRender = async () => { rendered = true; };

    const row = buildShortcutRow(shortcut, onRender) as any;
    domMock.body.appendChild(row);

    const deleteBtn = row.querySelector('.btn-icon.danger');
    expect(deleteBtn).toBeTruthy();

    // ── First click: enters pending confirmation state ─────────────────────
    await deleteBtn.click();
    expect(row.classList.contains('pending-delete')).toBe(true);
    expect(deleteBtn.classList.contains('confirm-delete')).toBe(true);
    expect(deleteBtn.getAttribute('aria-label')).toContain("Press 'd' again to confirm");

    // Shortcut should NOT be deleted yet
    store = await getStore();
    expect(store.shortcuts['gh']).toBeDefined();
    expect(rendered).toBe(false);

    // Confirmation toast is visible
    const confirmToast = domMock.body.querySelector('.delete-confirm-toast');
    expect(confirmToast).toBeTruthy();
    expect(confirmToast?.textContent).toContain('Press d again to confirm');

    // ── Second click: confirms deletion ────────────────────────────────────
    await deleteBtn.click();

    // Now it should be deleted
    store = await getStore();
    expect(store.shortcuts['gh']).toBeUndefined();
    expect(rendered).toBe(true);
    expect(row.classList.contains('pending-delete')).toBe(false);

    // Confirmation toast is removed, undo toast is shown
    expect(domMock.body.querySelector('.delete-confirm-toast')).toBeNull();
    const undoToast = domMock.body.querySelector('.undo-toast');
    expect(undoToast).toBeTruthy();
    expect(undoToast?.textContent).toContain('Deleted "gh"');
  });

  it('cancels pending delete when Escape is pressed', async () => {
    await upsertShortcut({ key: 'tw', url: 'https://twitter.com', type: 'redirect' });
    let store = await getStore();
    const shortcut: Shortcut = store.shortcuts['tw'];

    const row = buildShortcutRow(shortcut, async () => {}) as any;
    domMock.body.appendChild(row);
    const deleteBtn = row.querySelector('.btn-icon.danger');

    // First click
    await deleteBtn.click();
    expect(row.classList.contains('pending-delete')).toBe(true);
    expect(domMock.body.querySelector('.delete-confirm-toast')).toBeTruthy();

    // Simulate Escape keydown
    await domMock.doc.dispatchEvent({ type: 'keydown', key: 'Escape' });

    // Pending state should be cleared
    expect(row.classList.contains('pending-delete')).toBe(false);
    expect(deleteBtn.classList.contains('confirm-delete')).toBe(false);
    expect(domMock.body.querySelector('.delete-confirm-toast')).toBeNull();

    // Shortcut is preserved
    store = await getStore();
    expect(store.shortcuts['tw']).toBeDefined();
  });

  it('cancels pending delete automatically after timeout', async () => {
    await upsertShortcut({ key: 'yt', url: 'https://youtube.com', type: 'redirect' });
    let store = await getStore();
    const shortcut: Shortcut = store.shortcuts['yt'];

    const row = buildShortcutRow(shortcut, async () => {}) as any;
    domMock.body.appendChild(row);
    const deleteBtn = row.querySelector('.btn-icon.danger');

    // First click
    await deleteBtn.click();
    expect(row.classList.contains('pending-delete')).toBe(true);

    // Advance time past 4000ms
    vi.advanceTimersByTime(4001);

    expect(row.classList.contains('pending-delete')).toBe(false);
    expect(deleteBtn.classList.contains('confirm-delete')).toBe(false);
    expect(domMock.body.querySelector('.delete-confirm-toast')).toBeNull();

    // Shortcut is preserved
    store = await getStore();
    expect(store.shortcuts['yt']).toBeDefined();
  });

  it('switches pending delete to new row when another row delete is triggered', async () => {
    await upsertShortcut({ key: 'a', url: 'https://a.com', type: 'redirect' });
    await upsertShortcut({ key: 'b', url: 'https://b.com', type: 'redirect' });
    let store = await getStore();

    const rowA = buildShortcutRow(store.shortcuts['a'], async () => {}) as any;
    const rowB = buildShortcutRow(store.shortcuts['b'], async () => {}) as any;
    domMock.body.appendChild(rowA);
    domMock.body.appendChild(rowB);

    const deleteBtnA = rowA.querySelector('.btn-icon.danger');
    const deleteBtnB = rowB.querySelector('.btn-icon.danger');

    // Click delete on row A
    await deleteBtnA.click();
    expect(rowA.classList.contains('pending-delete')).toBe(true);
    expect(rowB.classList.contains('pending-delete')).toBe(false);

    // Now click delete on row B
    await deleteBtnB.click();
    expect(rowA.classList.contains('pending-delete')).toBe(false);
    expect(rowB.classList.contains('pending-delete')).toBe(true);

    // Confirm row B
    await deleteBtnB.click();

    store = await getStore();
    expect(store.shortcuts['a']).toBeDefined(); // row A was not deleted
    expect(store.shortcuts['b']).toBeUndefined(); // row B was deleted
  });
});

describe('Inline row editing (buildShortcutRow & saveEdit)', () => {
  beforeEach(async () => {
    domMock.doc.reset();
    cancelPendingDelete();
    cancelRowEdit();
    await mockChrome.chrome.storage.sync.clear();
  });

  afterEach(() => {
    cancelPendingDelete();
    cancelRowEdit();
  });

  it('edits a redirect shortcut in place (upsertShortcut) and via rename (renameShortcut)', async () => {
    await upsertShortcut({ key: 'gh', url: 'https://github.com', type: 'redirect' });
    let store = await getStore();

    let renderCount = 0;
    const onRender = async () => { renderCount++; };

    // 1. Update URL and label with same key
    const row = buildShortcutRow(store.shortcuts['gh'], onRender) as any;
    domMock.body.appendChild(row);

    const editBtn = row.querySelector('.edit-btn');
    await editBtn.click();
    expect(row.classList.contains('editing')).toBe(true);

    const inputs = row.querySelectorAll('.edit-form input');
    expect(inputs.length).toBe(3); // key, url, label
    const [keyInput, urlInput, labelInput] = inputs;

    urlInput.value = 'https://github.com/notifications';
    labelInput.value = 'GitHub Notifications';

    const saveBtn = row.querySelector('.edit-actions .btn-primary');
    await saveBtn.click();
    await flushPromises();

    store = await getStore();
    expect(store.shortcuts['gh'].url).toBe('https://github.com/notifications');
    expect(store.shortcuts['gh'].label).toBe('GitHub Notifications');
    expect(renderCount).toBe(1);

    // 2. Rename key along with URL/label update
    const row2 = buildShortcutRow(store.shortcuts['gh'], onRender) as any;
    domMock.body.appendChild(row2);
    await row2.querySelector('.edit-btn').click();

    const [keyInput2, urlInput2, labelInput2] = row2.querySelectorAll('.edit-form input');
    keyInput2.value = 'ghn';
    urlInput2.value = 'https://github.com/pulls';
    labelInput2.value = 'Pull Requests';

    await row2.querySelector('.edit-actions .btn-primary').click();
    await flushPromises();

    store = await getStore();
    expect(store.shortcuts['gh']).toBeUndefined();
    expect(store.shortcuts['ghn']).toBeDefined();
    expect(store.shortcuts['ghn'].url).toBe('https://github.com/pulls');
    expect(store.shortcuts['ghn'].label).toBe('Pull Requests');
    expect(renderCount).toBe(2);
  });

  it('edits a parameterized (search) shortcut, preserving custom fallback URL and validating templates', async () => {
    const initial: Shortcut = {
      key: 'ghs',
      url: 'https://github.com/explore',
      urlTemplate: 'https://github.com/search?q=%s',
      type: 'parameterized',
      label: 'GH Search',
    };
    await upsertShortcut(initial);
    let store = await getStore();

    let renderCount = 0;
    const row = buildShortcutRow(store.shortcuts['ghs'], async () => { renderCount++; }) as any;
    domMock.body.appendChild(row);

    await row.querySelector('.edit-btn').click();
    const inputs = row.querySelectorAll('.edit-form input');
    expect(inputs.length).toBe(4); // key, urlTemplate, fallback, label
    const [keyInput, templateInput, fallbackInput, labelInput] = inputs;

    // Preserves custom fallback URL in fallbackInput
    expect(keyInput.value).toBe('ghs');
    expect(templateInput.value).toBe('https://github.com/search?q=%s');
    expect(fallbackInput.value).toBe('https://github.com/explore');
    expect(labelInput.value).toBe('GH Search');

    const saveBtn = row.querySelector('.edit-actions .btn-primary');
    const statusEl = row.querySelector('.edit-status');

    // Rejects template missing %s
    templateInput.value = 'https://github.com/search';
    await saveBtn.click();
    await flushPromises();
    expect(statusEl.textContent).toBe('Search URL must include %s.');
    expect(renderCount).toBe(0);

    // Rejects unsafe scheme in urlTemplate
    templateInput.value = "javascript:alert('%s')";
    await saveBtn.click();
    await flushPromises();
    expect(statusEl.textContent).toBe('Enter a valid http(s) search URL template.');
    expect(renderCount).toBe(0);

    // Valid update of urlTemplate, fallbackInput, and labelInput
    templateInput.value = 'https://github.com/issues?q=%s';
    fallbackInput.value = 'https://github.com/issues';
    labelInput.value = 'GH Issues Search';
    await saveBtn.click();
    await flushPromises();

    expect(statusEl.textContent).toBe('');
    expect(renderCount).toBe(1);
    store = await getStore();
    expect(store.shortcuts['ghs'].urlTemplate).toBe('https://github.com/issues?q=%s');
    expect(store.shortcuts['ghs'].url).toBe('https://github.com/issues');
    expect(store.shortcuts['ghs'].label).toBe('GH Issues Search');
  });

  it('edits a bundle shortcut inline (when onEditBundle is not provided), updating key and label while preserving bundleUrls', async () => {
    const bundleUrls = ['https://github.com', 'https://linear.app'];
    await upsertShortcut({
      key: 'work',
      url: bundleUrls[0],
      bundleUrls,
      type: 'bundle',
      label: 'Morning',
    });
    let store = await getStore();

    let renderCount = 0;
    const row = buildShortcutRow(store.shortcuts['work'], async () => { renderCount++; }) as any;
    domMock.body.appendChild(row);

    await row.querySelector('.edit-btn').click();
    expect(row.classList.contains('editing')).toBe(true);

    const inputs = row.querySelectorAll('.edit-form input');
    expect(inputs.length).toBe(2); // key, label
    const [keyInput, labelInput] = inputs;
    expect(keyInput.value).toBe('work');
    expect(labelInput.value).toBe('Morning');

    keyInput.value = 'daily';
    labelInput.value = 'Daily Standup';

    await row.querySelector('.edit-actions .btn-primary').click();
    await flushPromises();

    store = await getStore();
    expect(store.shortcuts['work']).toBeUndefined();
    expect(store.shortcuts['daily']).toBeDefined();
    expect(store.shortcuts['daily'].label).toBe('Daily Standup');
    expect(store.shortcuts['daily'].bundleUrls).toEqual(bundleUrls);
    expect(renderCount).toBe(1);
  });

  it('saves on Enter inside an inline edit input and cancels on Escape', async () => {
    await upsertShortcut({ key: 'docs', url: 'https://docs.example.com', type: 'redirect' });
    let store = await getStore();

    let renderCount = 0;
    const row = buildShortcutRow(store.shortcuts['docs'], async () => { renderCount++; }) as any;
    domMock.body.appendChild(row);

    // Open edit and press Escape to cancel
    await row.querySelector('.edit-btn').click();
    expect(row.classList.contains('editing')).toBe(true);

    const [keyInput, urlInput, labelInput] = row.querySelectorAll('.edit-form input');
    urlInput.value = 'https://changed.example.com';

    await domMock.doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(row.classList.contains('editing')).toBe(false);
    store = await getStore();
    expect(store.shortcuts['docs'].url).toBe('https://docs.example.com');

    // Re-open edit and press Enter inside an input to save
    await row.querySelector('.edit-btn').click();
    expect(row.classList.contains('editing')).toBe(true);
    labelInput.value = 'Team Docs';

    await labelInput.dispatchEvent({ type: 'keydown', key: 'Enter' });
    await flushPromises();

    store = await getStore();
    expect(store.shortcuts['docs'].url).toBe('https://changed.example.com');
    expect(store.shortcuts['docs'].label).toBe('Team Docs');
    expect(renderCount).toBe(1);
  });
});

describe('UI helper functions', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    domMock.doc.reset();
    await mockChrome.chrome.storage.sync.clear();
    vi.mocked(mockChrome.chrome.tabs.create).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('savedStatusMessage returns tutorial message for <= 3 shortcuts and concise message for > 3', () => {
    expect(savedStatusMessage('gh', 1)).toBe('Saved! Type "gh" in your address bar and press Enter to jump.');
    expect(savedStatusMessage('gh', 3)).toBe('Saved! Type "gh" in your address bar and press Enter to jump.');
    expect(savedStatusMessage('gh', 4)).toBe('Saved "gh".');
    expect(savedStatusMessage('gh', 10)).toBe('Saved "gh".');
  });

  it('describeTarget formats redirect hostname, search urlTemplate, and bundle count + host preview', () => {
    expect(
      describeTarget({ key: 'gh', url: 'https://github.com/org/repo', type: 'redirect' }),
    ).toBe('github.com');

    expect(
      describeTarget({
        key: 's',
        url: 'https://fallback.example.com',
        urlTemplate: 'https://search.example.com/q=%s',
        type: 'parameterized',
      }),
    ).toBe('search.example.com');

    expect(
      describeTarget({
        key: 'b',
        url: 'https://github.com',
        bundleUrls: ['https://github.com/a', 'https://linear.app/b', 'https://notion.so/c'],
        type: 'bundle',
      }),
    ).toBe('3 tabs · github.com, linear.app +1');
  });

  it('hasShortcutTargetCollision detects collisions across types, url, urlTemplate, and bundleUrls', () => {
    const baseRedirect: Shortcut = { key: 'gh', url: 'https://github.com', type: 'redirect' };

    expect(hasShortcutTargetCollision(undefined, baseRedirect)).toBe(false);
    expect(hasShortcutTargetCollision(baseRedirect, { ...baseRedirect })).toBe(false);

    // Different URL
    expect(
      hasShortcutTargetCollision(baseRedirect, { key: 'gh', url: 'https://gitlab.com', type: 'redirect' }),
    ).toBe(true);

    // Different type even with identical fallback url
    expect(
      hasShortcutTargetCollision(baseRedirect, {
        key: 'gh',
        url: 'https://github.com',
        urlTemplate: 'https://github.com/search?q=%s',
        type: 'parameterized',
      }),
    ).toBe(true);

    // Different urlTemplate when fallback url is identical
    const searchA: Shortcut = {
      key: 'ghs',
      url: 'https://github.com',
      urlTemplate: 'https://github.com/search?q=%s',
      type: 'parameterized',
    };
    const searchB: Shortcut = {
      key: 'ghs',
      url: 'https://github.com',
      urlTemplate: 'https://github.com/issues?q=%s',
      type: 'parameterized',
    };
    expect(hasShortcutTargetCollision(searchA, searchB)).toBe(true);
    expect(hasShortcutTargetCollision(searchA, { ...searchA })).toBe(false);

    // Different bundleUrls when primary url is identical
    const bundleA: Shortcut = {
      key: 'work',
      url: 'https://github.com',
      bundleUrls: ['https://github.com', 'https://linear.app'],
      type: 'bundle',
    };
    const bundleB: Shortcut = {
      key: 'work',
      url: 'https://github.com',
      bundleUrls: ['https://github.com', 'https://notion.so'],
      type: 'bundle',
    };
    expect(hasShortcutTargetCollision(bundleA, bundleB)).toBe(true);
    expect(hasShortcutTargetCollision(bundleA, { ...bundleA, bundleUrls: [...bundleA.bundleUrls!] })).toBe(false);
  });

  it('groupShortcuts groups aliases sharing normalized URL or urlTemplate and keeps bundles distinct', () => {
    const shortcuts: Shortcut[] = [
      { key: 'gh', url: 'https://github.com/', type: 'redirect' },
      { key: 'b1', url: 'https://github.com', bundleUrls: ['https://github.com'], type: 'bundle' },
      { key: 'github', url: 'https://github.com', type: 'redirect' },
      { key: 'b2', url: 'https://github.com', bundleUrls: ['https://github.com'], type: 'bundle' },
      { key: 'ghs1', url: 'https://github.com', urlTemplate: 'https://github.com/search?q=%s', type: 'parameterized' },
      { key: 'ghs2', url: 'https://github.com/explore', urlTemplate: 'https://github.com/search?q=%s', type: 'parameterized' },
    ];

    const grouped = groupShortcuts(shortcuts);
    expect(grouped).toEqual([
      { shortcut: shortcuts[0], isAlias: false },
      { shortcut: shortcuts[2], isAlias: true },
      { shortcut: shortcuts[1], isAlias: false },
      { shortcut: shortcuts[3], isAlias: false },
      { shortcut: shortcuts[4], isAlias: false },
      { shortcut: shortcuts[5], isAlias: true },
    ]);
  });

  it('renderOverwriteConfirm fires onOverwrite and onSaveAs(altKey)', async () => {
    const statusEl = domMock.doc.createElement('div');
    const existing: Shortcut = { key: 'gh', url: 'https://github.com', type: 'redirect' };

    let overwritten = false;
    let savedAs: string | null = null;

    renderOverwriteConfirm(
      statusEl as any,
      existing,
      'gh2',
      () => { overwritten = true; },
      (alt) => { savedAs = alt; },
    );

    expect(statusEl.textContent).toContain('"gh" already points to github.com.');
    const buttons = statusEl.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Overwrite');
    expect(buttons[1].textContent).toBe('Save as "gh2"');

    await buttons[0].click();
    expect(overwritten).toBe(true);

    await buttons[1].click();
    expect(savedAs).toBe('gh2');
  });

  it('showUndoToast invokes onUndo on click and removes the toast', async () => {
    let undone = false;
    showUndoToast('Deleted "gh"', () => {
      undone = true;
    });

    const toast = domMock.body.querySelector('.undo-toast');
    expect(toast).toBeTruthy();
    expect(toast?.textContent).toContain('Deleted "gh"');

    const undoBtn = toast?.querySelector('.undo-btn');
    expect(undoBtn).toBeTruthy();

    await undoBtn!.click();
    expect(undone).toBe(true);
    expect(domMock.body.querySelector('.undo-toast')).toBeNull();
  });

  it('openShortcut opens only http/https URLs via chrome.tabs.create and calls touchShortcut', async () => {
    await upsertShortcut({
      key: 'mix',
      url: 'https://github.com',
      bundleUrls: ['https://github.com', 'javascript:alert(1)', 'chrome://extensions', 'http://example.com'],
      type: 'bundle',
    });
    const storeBefore = await getStore();
    expect(storeBefore.shortcuts['mix'].useCount ?? 0).toBe(0);

    openShortcut(storeBefore.shortcuts['mix']);
    await flushPromises();

    expect(mockChrome.chrome.tabs.create).toHaveBeenCalledTimes(2);
    expect(mockChrome.chrome.tabs.create).toHaveBeenNthCalledWith(1, {
      url: 'https://github.com',
      active: true,
    });
    expect(mockChrome.chrome.tabs.create).toHaveBeenNthCalledWith(2, {
      url: 'http://example.com',
      active: false,
    });

    const storeAfter = await getStore();
    expect(storeAfter.shortcuts['mix'].useCount).toBe(1);
    expect(storeAfter.shortcuts['mix'].lastUsed).toBeTypeOf('number');
  });
});
