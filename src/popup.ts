// popup.ts - Popup UI for managing shortcuts

import { 
  getShortcuts, 
  saveShortcut, 
  deleteShortcut, 
  generateId,
  exportData,
  importData
} from './storage.js';
import type { Shortcut } from './types.js';

/**
 * Render the list of shortcuts
 */
async function renderShortcuts(): Promise<void> {
  const shortcuts = await getShortcuts();
  const listEl = document.getElementById('shortcutList');
  
  if (!listEl) return;
  
  const shortcutArray = Object.values(shortcuts).sort((a, b) => 
    a.keyword.localeCompare(b.keyword)
  );
  
  if (shortcutArray.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        No shortcuts yet. Add one above to get started!
      </div>
    `;
    return;
  }
  
  listEl.innerHTML = shortcutArray.map(shortcut => `
    <div class="shortcut-item" data-id="${shortcut.id}">
      <div class="shortcut-header">
        <span class="shortcut-keyword">${escapeHtml(shortcut.keyword)}</span>
        <div class="shortcut-actions">
          <button class="delete-btn danger" data-id="${shortcut.id}">Delete</button>
        </div>
      </div>
      <div class="shortcut-url">${escapeHtml(shortcut.url)}</div>
      ${shortcut.description ? `<div class="info">${escapeHtml(shortcut.description)}</div>` : ''}
    </div>
  `).join('');
  
  // Add event listeners to delete buttons
  listEl.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      if (id && confirm('Delete this shortcut?')) {
        await deleteShortcut(id);
        await renderShortcuts();
      }
    });
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Add a new shortcut
 */
async function addShortcut(): Promise<void> {
  const keywordEl = document.getElementById('keyword') as HTMLInputElement;
  const urlEl = document.getElementById('url') as HTMLInputElement;
  const descriptionEl = document.getElementById('description') as HTMLInputElement;
  
  if (!keywordEl || !urlEl) return;
  
  const keyword = keywordEl.value.trim();
  const url = urlEl.value.trim();
  const description = descriptionEl?.value.trim();
  
  if (!keyword || !url) {
    alert('Please enter both keyword and URL');
    return;
  }
  
  // Basic URL validation
  try {
    new URL(url.replace('%s', 'test'));
  } catch {
    alert('Please enter a valid URL');
    return;
  }
  
  const shortcut: Shortcut = {
    id: generateId(),
    keyword,
    url,
    description,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  await saveShortcut(shortcut);
  
  // Clear form
  keywordEl.value = '';
  urlEl.value = '';
  if (descriptionEl) descriptionEl.value = '';
  
  // Refresh list
  await renderShortcuts();
}

/**
 * Export shortcuts as JSON
 */
async function handleExport(): Promise<void> {
  const data = await exportData();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `omnibar-shortcuts-${Date.now()}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
}

/**
 * Import shortcuts from JSON
 */
async function handleImport(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      await importData(text);
      await renderShortcuts();
      alert('Import successful!');
    } catch (error) {
      alert('Import failed: ' + (error as Error).message);
    }
  };
  
  input.click();
}

/**
 * Initialize popup
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Render initial shortcuts
  await renderShortcuts();
  
  // Add shortcut button
  const addBtn = document.getElementById('addBtn');
  addBtn?.addEventListener('click', addShortcut);
  
  // Enter key in inputs
  ['keyword', 'url', 'description'].forEach(id => {
    document.getElementById(id)?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addShortcut();
      }
    });
  });
  
  // Export/Import buttons
  document.getElementById('exportBtn')?.addEventListener('click', handleExport);
  document.getElementById('importBtn')?.addEventListener('click', handleImport);
});
