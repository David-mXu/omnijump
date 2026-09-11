import type { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = 35729;

// Starts a WebSocket server during `vite build --watch` and tells connected
// extensions to reload after each successful rebuild.
export function devReload(): Plugin {
  let wss: WebSocketServer | undefined;
  let failed = false;
  return {
    name: 'omnijump-dev-reload',
    apply: 'build',
    buildStart() {
      failed = false;
      if (!wss) {
        wss = new WebSocketServer({ port: PORT });
        console.log(`[dev-reload] listening on ws://localhost:${PORT}`);
      }
    },
    buildEnd(err) {
      failed = !!err;
    },
    closeBundle() {
      if (failed || !wss) return;
      // Small delay so every output file is flushed before the extension reloads.
      setTimeout(() => {
        let n = 0;
        wss!.clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) {
            c.send('reload');
            n++;
          }
        });
        console.log(`[dev-reload] rebuilt — reloaded ${n} extension(s)`);
      }, 200);
    },
  };
}
