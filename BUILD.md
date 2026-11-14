# Building OmniJump from source

This document describes how `dist/firefox` (the package submitted to
addons.mozilla.org) is produced. Firefox Add-ons reviewers require it for
minified/bundled extension builds.

## Environment

- Node.js 24 (the version used by CI in `.github/workflows/*.yml`)
- npm 11+
- Linux, macOS, or Windows; no native toolchain is required

## Exact commands

```bash
npm ci
npm run build:firefox
```

`npm run build:firefox` runs Vite with `--mode firefox`, which reads
`vite.config.ts` and `src/manifest.ts` and writes the unpacked extension to
`dist/firefox/`.

For a local parity check with the Chrome build:

```bash
npm run build:all
```

## How the bundle is produced

OmniJump is written in TypeScript and HTML/CSS. Vite (with `@crxjs/vite-plugin`)
is a module bundler: it transpiles TypeScript, bundles ES modules, minifies the
output, and emits the `dist/firefox` directory. The source for every emitted
file is in this repository; there is no remote code loading or generated code
from outside the checkout.

`package-lock.json` pins the exact dependency graph. `npm ci` installs from that
lockfile, so rebuilding with the same Node version produces the same package.

## Source archive contents

The release workflow packages these paths for AMO:

- `src/`
- `scripts/`
- `images/`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vite.config.ts`
- `BUILD.md`

Tests and documentation are available in the public repository and are not
needed to rebuild the submitted package.
