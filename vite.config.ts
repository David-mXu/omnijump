import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import createManifest from './src/manifest';

export default defineConfig(({ mode }) => {
  const browser = mode === 'firefox' ? 'firefox' : 'chrome';

  return {
    plugins: [
      crx({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manifest: createManifest(browser) as any,
      }),
    ],
    build: {
      outDir: `dist/${browser}`,
      emptyOutDir: true,
    },
  };
});
