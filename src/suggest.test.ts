import { describe, it, expect } from 'vitest';
import { normalizeKey } from './storage';
import { suggestKeyFromUrl, uniqueKey } from './suggest';

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
