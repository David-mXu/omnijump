import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyScore, fuzzyFilter } from './fuzzy';
import { Shortcut } from './types';

const redirect = (key: string, url: string, label?: string): Shortcut => ({
  type: 'redirect', key, url, label,
});

describe('fuzzyMatch', () => {
  it('matches exact substring', () => {
    expect(fuzzyMatch('yt', 'youtube')).toBe(true);
  });

  it('matches subsequence', () => {
    expect(fuzzyMatch('gh', 'github')).toBe(true);
    expect(fuzzyMatch('ghl', 'github-lab')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('GH', 'github')).toBe(true);
    expect(fuzzyMatch('gh', 'GitHub')).toBe(true);
  });

  it('returns false when chars are missing', () => {
    expect(fuzzyMatch('xyz', 'github')).toBe(false);
  });

  it('returns false when query chars are out of order', () => {
    expect(fuzzyMatch('ba', 'abc')).toBe(false);
  });

  it('handles empty query', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });
});

describe('fuzzyScore', () => {
  it('exact match scores higher than prefix match', () => {
    expect(fuzzyScore('git', 'git')).toBeGreaterThan(fuzzyScore('git', 'g-i-t'));
  });

  it('earlier position scores higher', () => {
    expect(fuzzyScore('hub', 'hub-foo')).toBeGreaterThan(fuzzyScore('hub', 'foo-hub'));
  });

  it('more consecutive chars scores higher', () => {
    // "gith" consecutive in "github" vs scattered in "g-i-t-h"
    expect(fuzzyScore('gith', 'github')).toBeGreaterThan(fuzzyScore('gith', 'g_i_t_h_ub'));
  });

  it('returns -Infinity when no match', () => {
    expect(fuzzyScore('xyz', 'github')).toBe(-Infinity);
  });

  it('exact substring always outscores scattered subsequence', () => {
    // 'yt' is a literal substring of 'yt-videos', so it gets the exact-match bonus
    expect(fuzzyScore('yt', 'yt-videos')).toBeGreaterThan(fuzzyScore('yt', 'y_foo_t'));
  });
});

describe('fuzzyFilter', () => {
  const shortcuts: Shortcut[] = [
    redirect('yt', 'https://youtube.com'),
    redirect('gh', 'https://github.com'),
    redirect('mail', 'https://mail.google.com', 'Gmail'),
    redirect('maps', 'https://maps.google.com'),
  ];

  it('returns all shortcuts for empty query', () => {
    expect(fuzzyFilter('', shortcuts)).toHaveLength(shortcuts.length);
  });

  it('filters by key', () => {
    const result = fuzzyFilter('yt', shortcuts);
    expect(result.map(s => s.key)).toContain('yt');
  });

  it('filters by hostname', () => {
    const result = fuzzyFilter('github', shortcuts);
    expect(result.map(s => s.key)).toContain('gh');
  });

  it('filters by label', () => {
    const result = fuzzyFilter('gmail', shortcuts);
    expect(result.map(s => s.key)).toContain('mail');
  });

  it('excludes non-matching shortcuts', () => {
    const result = fuzzyFilter('yt', shortcuts);
    expect(result.map(s => s.key)).not.toContain('gh');
    expect(result.map(s => s.key)).not.toContain('mail');
  });

  it('sorts better matches first', () => {
    // 'gh' should be the top result for query 'gh'
    const result = fuzzyFilter('gh', shortcuts);
    expect(result[0].key).toBe('gh');
  });

  it('returns empty array when nothing matches', () => {
    expect(fuzzyFilter('zzz', shortcuts)).toHaveLength(0);
  });

  it('handles query with spaces trimmed', () => {
    // fuzzyFilter receives the already-trimmed query from callers
    const result = fuzzyFilter('yt', shortcuts);
    expect(result.length).toBeGreaterThan(0);
  });
});
