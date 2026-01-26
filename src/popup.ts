import { upsertShortcut } from './storage';
import { suggestKeyFromUrl, uniqueKey } from './suggest';

const form = document.getElementById('shortcutForm') as HTMLFormElement | null;
const keyInput = document.getElementById('shortcutKey') as HTMLInputElement | null;
const urlInput = document.getElementById('shortcutUrl') as HTMLInputElement | null;
const statusEl = document.getElementById('status') as HTMLDivElement | null;

function setStatus(message: string): void {
	if (statusEl) {
		statusEl.textContent = message;
	}
}

async function init(): Promise<void> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tab?.url && urlInput) {
			urlInput.value = tab.url;
			const suggested = suggestKeyFromUrl(tab.url);
			if (keyInput && suggested) {
				keyInput.value = suggested;
				keyInput.focus();
				keyInput.select();
			}
		}
	} catch (error) {
		setStatus('Failed to read active tab.');
		console.error(error);
	}
}

form?.addEventListener('submit', async (event) => {
	event.preventDefault();
	if (!keyInput || !urlInput) {
		return;
	}

	const key = keyInput.value.trim();
	const url = urlInput.value.trim();

	if (!key || !url) {
		setStatus('Enter a keyword and URL.');
		return;
	}

	try {
		const store = await chrome.storage.sync.get('omnibarShortcuts');
		const existingKeys = new Set<string>(
			Object.keys(store.omnibarShortcuts?.shortcuts ?? {})
		);
		const unique = uniqueKey(key, existingKeys);

		await upsertShortcut({
			key: unique,
			url,
			type: 'redirect',
		});

		setStatus(`Saved ${unique}.`);
	} catch (error) {
		setStatus('Failed to save shortcut.');
		console.error(error);
	}
});

init();
