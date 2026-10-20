import { describe, it, expect } from 'vitest';
import { normalizeKey } from './storage';
import { deriveSearchFallbackUrl, getUrlAncestors, normalizeUrl, suggestKeyFromUrl, uniqueKey } from './suggest';

describe('normalizeKey', () => {
  it('lowercases and trims', () => {
    expect(normalizeKey('  GitHub  ')).toBe('github');
  });
  it('collapses any run of whitespace to a single hyphen', () => {
    expect(normalizeKey('hello world')).toBe('hello-world');
    expect(normalizeKey('hello   world')).toBe('hello-world');
  });
  it('strips non-alphanumeric non-hyphen characters', () => {
    expect(normalizeKey('g@h!')).toBe('gh');
    expect(normalizeKey('c++')).toBe('c');
  });
  it('preserves hyphens', () => {
    expect(normalizeKey('my-site')).toBe('my-site');
  });
  it('returns empty string for blank or symbol-only input', () => {
    expect(normalizeKey('   ')).toBe('');
    expect(normalizeKey('!!!')).toBe('');
  });
});

describe('suggestKeyFromUrl', () => {
  it('returns first 3 chars of the hostname base', () => {
    expect(suggestKeyFromUrl('https://github.com')).toBe('git');
    expect(suggestKeyFromUrl('https://google.com')).toBe('goo');
  });
  it('strips www before extracting the base', () => {
    expect(suggestKeyFromUrl('https://www.github.com/path')).toBe('git');
  });
  it('returns the full base when it is 3 chars or fewer', () => {
    expect(suggestKeyFromUrl('https://gh.io')).toBe('gh');
    expect(suggestKeyFromUrl('https://a.com')).toBe('a');
  });
  it('builds an acronym from a hyphenated hostname', () => {
    expect(suggestKeyFromUrl('https://some-long-site.com')).toBe('sls');
  });
  it('returns empty string for an invalid URL', () => {
    expect(suggestKeyFromUrl('not a url')).toBe('');
    expect(suggestKeyFromUrl('')).toBe('');
  });
});

describe('uniqueKey', () => {
  it('returns the base when it is not taken', () => {
    expect(uniqueKey('gh', new Set())).toBe('gh');
    expect(uniqueKey('gh', new Set(['yt', 'goo']))).toBe('gh');
  });
  it('appends an incrementing number on collision', () => {
    expect(uniqueKey('gh', new Set(['gh']))).toBe('gh2');
    expect(uniqueKey('gh', new Set(['gh', 'gh2']))).toBe('gh3');
    expect(uniqueKey('gh', new Set(['gh', 'gh2', 'gh3']))).toBe('gh4');
  });
});

describe('getUrlAncestors', () => {
  it('returns root domain for a URL with path and query string', () => {
    expect(getUrlAncestors('https://amazon.ca/s?k=laptop')).toEqual(['https://amazon.ca/']);
  });
  it('returns root domain for a single-segment path', () => {
    expect(getUrlAncestors('https://example.com/search')).toEqual(['https://example.com/']);
  });
  it('returns root and intermediate paths for multi-segment paths', () => {
    expect(getUrlAncestors('https://example.com/a/b/c')).toEqual([
      'https://example.com/',
      'https://example.com/a/',
      'https://example.com/a/b/',
    ]);
  });
  it('returns empty array for a root URL with no path', () => {
    expect(getUrlAncestors('https://example.com')).toEqual([]);
  });
  it('returns empty array for a root URL with trailing slash only', () => {
    expect(getUrlAncestors('https://example.com/')).toEqual([]);
  });
  it('returns root domain for URL with only query string', () => {
    expect(getUrlAncestors('https://example.com?q=test')).toEqual(['https://example.com/']);
  });
  it('returns empty array for an invalid URL', () => {
    expect(getUrlAncestors('not a url')).toEqual([]);
  });
});

describe('normalizeUrl', () => {
  it('prepends https:// when no protocol is specified', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('  github.com/search  ')).toBe('https://github.com/search');
  });

  it('preserves existing http:// and https://', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
  });

  it('blocks non-http(s) schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('');
    expect(normalizeUrl('data:text/html,test')).toBe('');
    expect(normalizeUrl('file:///etc/passwd')).toBe('');
  });

  it('handles empty input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
  });
});

describe('deriveSearchFallbackUrl', () => {
  it('uses explicit fallback URL when valid', () => {
    expect(deriveSearchFallbackUrl('https://github.com/search?q=%s', 'github.com/explore'))
      .toBe('https://github.com/explore');
  });

  it('removes query param containing %s and strips dangling ?', () => {
    expect(deriveSearchFallbackUrl('https://github.com/search?q=%s'))
      .toBe('https://github.com/search');
    expect(deriveSearchFallbackUrl('https://docs.google.com/document/u/0/?q=%s'))
      .toBe('https://docs.google.com/document/u/0/');
  });

  it('preserves other query parameters when removing %s param', () => {
    expect(deriveSearchFallbackUrl('https://site.com/search?category=all&q=%s'))
      .toBe('https://site.com/search?category=all');
    expect(deriveSearchFallbackUrl('https://site.com/search?q=%s&category=all'))
      .toBe('https://site.com/search?category=all');
  });

  it('cleans %s from URL hash', () => {
    expect(deriveSearchFallbackUrl('https://site.com/search#%s'))
      .toBe('https://site.com/search');
    expect(deriveSearchFallbackUrl('https://site.com/search#query=%s'))
      .toBe('https://site.com/search');
  });

  it('cleans %s from pathname', () => {
    expect(deriveSearchFallbackUrl('https://dictionary.com/browse/%s'))
      .toBe('https://dictionary.com/browse/');
  });

  it('adds https:// if template lacks protocol', () => {
    expect(deriveSearchFallbackUrl('github.com/search?q=%s'))
      .toBe('https://github.com/search');
  });
});
