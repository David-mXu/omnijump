import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createChromeMock } from './test/chrome-mock';
import { createDomMock } from './test/dom-mock';
import { Shortcut } from './types';

const mockChrome = createChromeMock();
const domMock = createDomMock();
(globalThis as any).chrome = mockChrome.chrome;
(globalThis as any).document = domMock.doc;

// Import modules once document and chrome are defined
const { buildShortcutRow, cancelPendingDelete } = await import('./ui');
const { upsertShortcut, getStore } = await import('./storage');

describe('UI delete confirmation flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    domMock.doc.reset();
    cancelPendingDelete();
  });

  afterEach(() => {
    cancelPendingDelete();
    vi.useRealTimers();
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
