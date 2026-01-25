// popup.ts - Popup UI for managing shortcuts

import { 
  getShortcuts, 
  saveShortcut, 
  deleteShortcut,
  getBundles,
  saveBundle,
  deleteBundle, 
  generateId,
  exportData,
  importData
} from './storage.js';
import type { Shortcut, Bundle } from './types.js';

/**
 * Render the list of bundles in the select dropdown
 */
async function renderBundleSelect(): Promise<void> {
  const bundles = await getBundles();
  const selectEl = document.getElementById('bundleSelect') as HTMLSelectElement;
  
  if (!selectEl) return;
  
  const bundleArray = Object.values(bundles).sort((a, b) => 
    a.name.localeCompare(b.name)
  );
  
  selectEl.innerHTML = '<option value="">No bundle</option>' + 
    bundleArray.map(bundle => 
      `<option value="${bundle.id}">${escapeHtml(bundle.name)}</option>`
    ).join('');
}

/**
 * Render the list of bundles
 */
async function renderBundles(): Promise<void> {
  const bundles = await getBundles();
  const listEl = document.getElementById('bundleList');
  
  if (!listEl) return;
  
  const bundleArray = Object.values(bundles).sort((a, b) => 
    a.name.localeCompare(b.name)
  );
  
  if (bundleArray.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        No bundles yet. Create one to organize your shortcuts!
      </div>
    `;
    return;
  }
  
  listEl.innerHTML = bundleArray.map(bundle => `
    <div class="bundle-item" data-id="${bundle.id}">
      <div class="bundle-info">
        <div class="bundle-name">${escapeHtml(bundle.name)}</div>
        ${bundle.description ? `<div class="info">${escapeHtml(bundle.description)}</div>` : ''}
      </div>
      <div class="bundle-actions">
        <label class="toggle-switch">
          <input type="checkbox" class="bundle-toggle" data-id="${bundle.id}" ${bundle.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <button class="delete-bundle-btn danger" data-id="${bundle.id}">Delete</button>
      </div>
    </div>
  `).join('');
  
  // Add event listeners
  listEl.querySelectorAll('.bundle-toggle').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      if (id) {
        const bundle = bundles[id];
        if (bundle) {
          bundle.enabled = (e.target as HTMLInputElement).checked;
          bundle.updatedAt = Date.now();
          await saveBundle(bundle);
        }
      }
    });
  });
  
  listEl.querySelectorAll('.delete-bundle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      if (id && confirm('Delete this bundle? Shortcuts in this bundle will not be deleted.')) {
        await deleteBundle(id);
        await renderBundles();
        await renderBundleSelect();
      }
    });
  });
}

/**
 * Render the list of shortcuts
 */
async function renderShortcuts(): Promise<void> {
  const shortcuts = await getShortcuts();
  const bundles = await getBundles();
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
  
  listEl.innerHTML = shortcutArray.map(shortcut => {
    let bundleInfo = '';
    if (shortcut.bundleId) {
      const bundle = bundles[shortcut.bundleId];
      if (bundle) {
        bundleInfo = `<div class="info">📦 ${escapeHtml(bundle.name)}</div>`;
      }
    }
    
    return `
      <div class="shortcut-item" data-id="${shortcut.id}">
        <div class="shortcut-header">
          <span class="shortcut-keyword">${escapeHtml(shortcut.keyword)}</span>
          <div class="shortcut-actions">
            <button class="delete-btn danger" data-id="${shortcut.id}">Delete</button>
          </div>
        </div>
        <div class="shortcut-url">${escapeHtml(shortcut.url)}</div>
        ${shortcut.description ? `<div class="info">${escapeHtml(shortcut.description)}</div>` : ''}
        ${bundleInfo}
      </div>
    `;
  }).join('');
  
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
  const bundleSelectEl = document.getElementById('bundleSelect') as HTMLSelectElement;
  
  if (!keywordEl || !urlEl) return;
  
  const keyword = keywordEl.value.trim();
  const url = urlEl.value.trim();
  const description = descriptionEl?.value.trim();
  const bundleId = bundleSelectEl?.value || undefined;
  
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
    bundleId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  await saveShortcut(shortcut);
  
  // Clear form
  keywordEl.value = '';
  urlEl.value = '';
  if (descriptionEl) descriptionEl.value = '';
  if (bundleSelectEl) bundleSelectEl.value = '';
  
  // Refresh list
  await renderShortcuts();
}

/**
 * Add a new bundle
 */
async function addBundle(): Promise<void> {
  const nameEl = document.getElementById('bundleName') as HTMLInputElement;
  const descriptionEl = document.getElementById('bundleDescription') as HTMLInputElement;
  
  if (!nameEl) return;
  
  const name = nameEl.value.trim();
  const description = descriptionEl?.value.trim();
  
  if (!name) {
    alert('Please enter a bundle name');
    return;
  }
  
  const bundle: Bundle = {
    id: generateId(),
    name,
    description,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  await saveBundle(bundle);
  
  // Clear form
  nameEl.value = '';
  if (descriptionEl) descriptionEl.value = '';
  
  // Refresh lists
  await renderBundles();
  await renderBundleSelect();
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
      await renderBundles();
      await renderBundleSelect();
      alert('Import successful!');
    } catch (error) {
      alert('Import failed: ' + (error as Error).message);
    }
  };
  
  input.click();
}

/**
 * Switch tabs
 */
function switchTab(tabName: string): void {
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
  
  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}-tab`)?.classList.add('active');
}

/**
 * Initialize popup
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Render initial data
  await renderShortcuts();
  await renderBundles();
  await renderBundleSelect();
  
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = (e.target as HTMLElement).getAttribute('data-tab');
      if (tabName) switchTab(tabName);
    });
  });
  
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
  
  // Add bundle button
  const addBundleBtn = document.getElementById('addBundleBtn');
  addBundleBtn?.addEventListener('click', addBundle);
  
  // Enter key in bundle inputs
  ['bundleName', 'bundleDescription'].forEach(id => {
    document.getElementById(id)?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addBundle();
      }
    });
  });
  
  // Export/Import buttons
  document.getElementById('exportBtn')?.addEventListener('click', handleExport);
  document.getElementById('importBtn')?.addEventListener('click', handleImport);
});
