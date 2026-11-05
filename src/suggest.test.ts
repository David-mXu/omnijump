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

  it('blocks non-http(s) schemes and obfuscated schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('');
    expect(normalizeUrl('data:text/html,test')).toBe('');
    expect(normalizeUrl('vbscript:msgbox(1)')).toBe('');
    expect(normalizeUrl('file:///etc/passwd')).toBe('');
    expect(normalizeUrl('chrome://extensions')).toBe('');
    expect(normalizeUrl('edge://settings')).toBe('');
    expect(normalizeUrl('about:blank')).toBe('');
    expect(normalizeUrl('//evil.com/path')).toBe('');
    expect(normalizeUrl('\x01javascript:alert(1)')).toBe('');
    expect(normalizeUrl('java\tscript:alert(1)')).toBe('');
  });

  it('rejects hostless, whitespace, single-label non-localhost, and %s-hostname URLs', () => {
    expect(normalizeUrl('https://')).toBe('');
    expect(normalizeUrl('http://')).toBe('');
    expect(normalizeUrl('hello world')).toBe('');
    expect(normalizeUrl('https://bad host.com')).toBe('');
    expect(normalizeUrl('.example.com')).toBe('');
    expect(normalizeUrl('example.com.')).toBe('');
    expect(normalizeUrl('intranet')).toBe('');
    expect(normalizeUrl('https://%s')).toBe('');
    expect(normalizeUrl('https://%s/path')).toBe('');
  });

  it('accepts localhost, IPv4, IPv6, and valid %s templates', () => {
    expect(normalizeUrl('http://localhost:3000/test')).toBe('http://localhost:3000/test');
    expect(normalizeUrl('localhost:8080')).toBe('https://localhost:8080');
    expect(normalizeUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizeUrl('http://[::1]:8080')).toBe('http://[::1]:8080');
    expect(normalizeUrl('https://example.com/search?q=%s')).toBe('https://example.com/search?q=%s');
    expect(normalizeUrl('youtube.com/results?search_query=%s')).toBe('https://youtube.com/results?search_query=%s');
  });

  it('handles empty or non-string input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
    expect(normalizeUrl(null as unknown as string)).toBe('');
  });
});

describe('deriveSearchFallbackUrl', () => {
  it('uses explicit fallback URL when valid and rejects unsafe explicit fallback', () => {
    expect(deriveSearchFallbackUrl('https://github.com/search?q=%s', 'github.com/explore'))
      .toBe('https://github.com/explore');
    expect(deriveSearchFallbackUrl('https://github.com/search?q=%s', 'javascript:alert(1)'))
      .toBe('');
  });

  it('rejects non-http(s) templates including schemes with ://', () => {
    expect(deriveSearchFallbackUrl("javascript:alert('%s')")).toBe('');
    expect(deriveSearchFallbackUrl('chrome://settings/%s')).toBe('');
    expect(deriveSearchFallbackUrl('edge://settings/%s')).toBe('');
    expect(deriveSearchFallbackUrl('file:///%s')).toBe('');
    expect(deriveSearchFallbackUrl('data:text/html,%s')).toBe('');
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
