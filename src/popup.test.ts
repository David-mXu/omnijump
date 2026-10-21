import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('popup layout and margins/padding integrity', () => {
  const popupHtmlPath = path.resolve(__dirname, 'popup.html');
  const themeCssPath = path.resolve(__dirname, 'theme.css');

  it('popup.html designates body with .popup class and sets padding', () => {
    const html = fs.readFileSync(popupHtmlPath, 'utf8');
    expect(html).toMatch(/<body class="[^"]*popup[^"]*">/);
    expect(html).toContain('padding: var(--s4)');
  });

  it('theme.css defines body.popup layout rules with padding token', () => {
    const css = fs.readFileSync(themeCssPath, 'utf8');
    expect(css).toMatch(/body\.popup\s*\{[^}]*padding:\s*var\(--s4\)/);
  });

  it('theme.css base body reset does not zero out body padding', () => {
    const css = fs.readFileSync(themeCssPath, 'utf8');
    // Ensure the global body reset rule doesn't stomp on body padding
    const bodyResetMatch = css.match(/body\s*\{([^}]+)\}/);
    expect(bodyResetMatch).toBeTruthy();
    expect(bodyResetMatch![1]).not.toContain('padding: 0');
  });
});
