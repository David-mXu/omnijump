// Dev-only: connects to the watch build's reload server (see scripts/dev-reload-plugin.ts)
// and reloads the whole extension after every rebuild. Compiled out of production builds.
const PORT = 35729;

export function startDevReload(): void {
  const connect = () => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    // Periodic traffic keeps the MV3 service worker alive (Chrome 116+).
    const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 20_000);
    ws.onmessage = (e) => {
      if (e.data === 'reload') chrome.runtime.reload();
    };
    ws.onclose = () => {
      clearInterval(ping);
      setTimeout(connect, 1000);
    };
  };
  connect();
}
