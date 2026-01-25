// popup.ts

// 1. Get the button from the HTML
const button = document.getElementById('changeColorBtn') as HTMLButtonElement | null;

if (button) {
  // 2. Add a click listener
  button.addEventListener('click', async () => {
    try {
      // 3. Get the active tab
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab?.id) {
        // 4. Inject a script into that tab
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // This function runs INSIDE the web page, not the popup!
            document.body.style.backgroundColor = 'lightblue';
          },
        });
      } else {
        console.error('No active tab found or tab ID is missing.');
      }
    } catch (error) {
      console.error('An error occurred:', error);
    }
  });
} else {
  console.error('Button with ID "changeColorBtn" not found in the DOM.');
}