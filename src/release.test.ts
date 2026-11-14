import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(
  path.join(root, '.github/workflows/publish-firefox.yml'),
  'utf8',
);

describe('Firefox release automation', () => {
  it('uploads the source archive AMO requires for the bundled build', () => {
    expect(workflow).toContain('--upload-source-code=firefox-source.zip');
    expect(workflow).toContain('Package source archive');
    for (const input of [
      'src',
      'scripts',
      'images',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'BUILD.md',
    ]) {
      expect(workflow).toContain(input);
    }
  });

  it('does not block the publish job on the default review timeout', () => {
    expect(workflow).toContain('--approval-timeout=0');
  });

  it('documents the reproducible build for reviewers', () => {
    const build = fs.readFileSync(path.join(root, 'BUILD.md'), 'utf8');
    expect(build).toContain('npm ci');
    expect(build).toContain('npm run build:firefox');
    expect(build).toContain('Node.js 24');
    expect(build).toContain('package-lock.json');
  });
});
