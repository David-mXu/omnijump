import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import createManifest from './src/manifest';

export default defineConfig(({ mode }) => {
  const browser = mode === 'firefox' ? 'firefox' : 'chrome';

  return {
    plugins: [
      crx({
        manifest: createManifest(browser),
      }),
    ],
    build: {
      outDir: `dist/${browser}`,
      emptyOutDir: true,
    },
  };
});
