import { normalizeKey } from './storage';

function extractBase(hostname: string): string {
  const cleaned = hostname.replace(/^www\./i, '');
  const parts = cleaned.split('.').filter(Boolean);
  return parts[0] ?? cleaned;
}

function buildAcronym(base: string): string {
  if (base.includes('-')) {
    return base
      .split('-')
      .filter(Boolean)
      .map((part) => part[0])
      .join('');
  }

  if (base.length <= 3) {
    return base;
  }

  return base.slice(0, 3);
}

export function suggestKeyFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const base = extractBase(hostname);
    return normalizeKey(buildAcronym(base));
  } catch {
    return '';
  }
}

export function uniqueKey(base: string, existing: Set<string>): string {
  if (!existing.has(base)) {
    return base;
  }

  let i = 2;
  while (existing.has(`${base}${i}`)) {
    i += 1;
  }
  return `${base}${i}`;
}

export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  // Block non-http(s) schemes (javascript:, data:, vbscript:, file:, blob:, etc.)
  if (/^[a-z][a-z0-9+\-.]*:/i.test(s)) return '';
  return `https://${s}`;
}

export function deriveSearchFallbackUrl(template: string, explicitFallback?: string): string {
  if (explicitFallback) {
    const explicit = normalizeUrl(explicitFallback);
    if (explicit) return explicit;
  }
  let raw = template.trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw) && !raw.includes('://')) {
    raw = `https://${raw}`;
  }
  try {
    const u = new URL(raw);
    const keysToDelete: string[] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (k.includes('%s') || v.includes('%s')) {
        keysToDelete.push(k);
      }
    }
    for (const k of keysToDelete) {
      u.searchParams.delete(k);
    }
    if (u.hash.includes('%s')) {
      u.hash = u.hash
        .replace(/([?&#]|^#)[^?&#=]*=%s/g, '')
        .replace(/%s/g, '')
        .replace(/[?&=]+$/, '');
      if (u.hash === '#') u.hash = '';
    }
    if (u.pathname.includes('%s')) {
      u.pathname = u.pathname.replace(/%s/g, '');
    }
    return u.toString().replace(/[\?&#]+$/, '');
  } catch {
    return raw.replace(/%s/g, '').replace(/[\?&][^&=]*=(?=&|$)/g, '').replace(/[\?&#]+$/, '');
  }
}

export function getUrlAncestors(url: string): string[] {
  try {
    const parsed = new URL(url);
    const ancestors: string[] = [];
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    // Always offer root origin (skip if URL is already there)
    const root = parsed.origin + '/';
    if (parsed.pathname !== '/' || parsed.search) {
      ancestors.push(root);
    }

    // Offer intermediate path levels (skip final segment — that's the current URL)
    for (let i = 0; i < pathParts.length - 1; i++) {
      ancestors.push(parsed.origin + '/' + pathParts.slice(0, i + 1).join('/') + '/');
    }

    return ancestors;
  } catch {
    return [];
  }
}
