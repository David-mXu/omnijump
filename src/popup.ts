/**
 * Popup UI logic
 */

import { StorageManager } from './storage.js';

// DOM elements
const keywordInput = document.getElementById('keyword') as HTMLInputElement;
const targetInput = document.getElementById('target') as HTMLTextAreaElement;
const addButton = document.getElementById('add-shortcut') as HTMLButtonElement;
const shortcutsList = document.getElementById('shortcuts-list') as HTMLDivElement;
const exportButton = document.getElementById('export-shortcuts') as HTMLButtonElement;
const importButton = document.getElementById('import-shortcuts') as HTMLButtonElement;
const importFile = document.getElementById('import-file') as HTMLInputElement;

// Tab switching
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.getAttribute('data-tab');
    
    // Update active tab
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Update active content
    tabContents.forEach(content => {
      content.classList.remove('active');
      if (content.id === `${tabName}-tab`) {
        content.classList.add('active');
      }
    });
  });
});

/**
 * Render the shortcuts list
 */
async function renderShortcuts() {
  const shortcuts = await StorageManager.getShortcuts();
  const shortcutEntries = Object.values(shortcuts);

  if (shortcutEntries.length === 0) {
    shortcutsList.innerHTML = '<div style="text-align: center; color: #5f6368; padding: 20px;">No shortcuts yet. Add your first shortcut above!</div>';
    return;
  }

  shortcutsList.innerHTML = shortcutEntries
    .sort((a, b) => a.keyword.localeCompare(b.keyword))
    .map(shortcut => `
      <div class="shortcut-item">
        <div class="shortcut-keyword">${escapeHtml(shortcut.keyword)}</div>
        <div class="shortcut-target">${escapeHtml(shortcut.target)}</div>
        <div class="shortcut-actions">
          <button class="delete-btn" data-keyword="${escapeHtml(shortcut.keyword)}">Delete</button>
        </div>
      </div>
    `)
    .join('');

  // Attach delete handlers
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const keyword = (e.target as HTMLButtonElement).getAttribute('data-keyword')!;
      await StorageManager.removeShortcut(keyword);
      await renderShortcuts();
    });
  });
}

/**
 * Add a new shortcut
 */
async function addShortcut() {
  const keyword = keywordInput.value.trim();
  const target = targetInput.value.trim();

  if (!keyword || !target) {
    alert('Please enter both keyword and target URL');
    return;
  }

  // Validate URL
  try {
    new URL(target.replace('%s', 'test'));
  } catch {
    alert('Please enter a valid URL');
    return;
  }

  await StorageManager.addShortcut(keyword, target);
  
  // Clear inputs
  keywordInput.value = '';
  targetInput.value = '';
  
  // Re-render
  await renderShortcuts();
  
  // Focus keyword input for quick adding
  keywordInput.focus();
}

/**
 * Export shortcuts to JSON file
 */
async function exportShortcuts() {
  const jsonData = await StorageManager.exportData();
  const blob = new Blob([jsonData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `omnibar-shortcuts-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
}

/**
 * Import shortcuts from JSON file
 */
async function importShortcuts() {
  importFile.click();
}

/**
 * Handle file import
 */
importFile.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    await StorageManager.importData(text);
    await renderShortcuts();
    alert('Shortcuts imported successfully!');
  } catch (err) {
    alert('Error importing shortcuts: ' + (err as Error).message);
  }
  
  // Reset file input
  importFile.value = '';
});

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check for pending shortcut URL from context menu
 */
async function checkPendingUrl() {
  chrome.runtime.sendMessage({ type: 'getPendingUrl' }, (response) => {
    if (response?.url) {
      targetInput.value = response.url;
      keywordInput.focus();
    }
  });
}

// Event listeners
addButton.addEventListener('click', addShortcut);
exportButton.addEventListener('click', exportShortcuts);
importButton.addEventListener('click', importShortcuts);

// Handle Enter key in inputs
keywordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    targetInput.focus();
  }
});

targetInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    addShortcut();
  }
});

// Initialize
renderShortcuts();
checkPendingUrl();
