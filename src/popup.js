"use strict";
// popup.ts
Object.defineProperty(exports, "__esModule", { value: true });
// 1. Get the button from the HTML
const button = document.getElementById('changeColorBtn');
// 2. Add a click listener
button.addEventListener('click', async () => {
    // 3. Get the active tab
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
        // 4. Inject a script into that tab
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                // This function runs INSIDE the web page, not the popup!
                document.body.style.backgroundColor = 'lightblue';
            }
        });
    }
});
//# sourceMappingURL=popup.js.map