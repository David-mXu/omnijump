// URL validation helpers. Leaf module: no imports, safe to use from both
// storage.ts and suggest.ts without creating import cycles.

export function normalizeUrl(input: string): string {
  if (typeof input !== 'string') return '';
  const s = input.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!s) return '';
  if (s.startsWith('//')) return '';

  let candidate = s;
  if (!/^https?:\/\//i.test(s)) {
    // Block non-http(s) schemes (javascript:, data:, vbscript:, file:, blob:, etc.)
    // while allowing schemeless host:port (e.g. localhost:8080 or example.com:3000/path).
    if (/^[a-z][a-z0-9+\-.]*:/i.test(s) && !/^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(s)) return '';
    candidate = `https://${s}`;
  }

  try {
    const testUrl = candidate.replace(/%s/g, '__omnijump_param__');
    const parsed = new URL(testUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const host = parsed.hostname;
    if (
      !host ||
      /\s/.test(host) ||
      host.includes('__omnijump_param__') ||
      host.startsWith('.') ||
      host.endsWith('.')
    ) {
      return '';
    }
    if (host !== 'localhost' && !host.startsWith('[') && !host.includes('.')) {
      return '';
    }
    return candidate;
  } catch {
    return '';
  }
}

export function deriveSearchFallbackUrl(template: string, explicitFallback?: string): string {
  if (explicitFallback && explicitFallback.trim()) {
    return normalizeUrl(explicitFallback);
  }
  const raw = normalizeUrl(template);
  if (!raw) return '';
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
    const cleaned = u.toString().replace(/[\?&#]+$/, '');
    return normalizeUrl(cleaned) || u.origin;
  } catch {
    const cleaned = raw.replace(/%s/g, '').replace(/[\?&][^&=]*=(?=&|$)/g, '').replace(/[\?&#]+$/, '');
    return normalizeUrl(cleaned);
  }
}
