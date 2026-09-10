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
      rollupOptions: {
        // onboarding.html isn't referenced by the manifest, so it must be an
        // explicit input to end up in dist (opened via chrome.tabs.create).
        input: {
          onboarding: 'src/onboarding.html',
          ...(browser === 'firefox' && { sidepanel: 'src/sidepanel.html' }),
        },
      },
    },
  };
});
