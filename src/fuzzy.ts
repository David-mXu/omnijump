import { Shortcut } from './types';

export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

// Returns -Infinity when query doesn't match. Higher = better.
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring: always ranks above scattered matches.
  if (t.includes(q)) return 1000 - t.indexOf(q);

  let qi = 0;
  let firstMatchPos = -1;
  let consecutive = 0;
  let maxConsecutive = 0;
  let prev = -1;

  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (firstMatchPos === -1) firstMatchPos = i;
      consecutive = prev === i - 1 ? consecutive + 1 : 1;
      if (consecutive > maxConsecutive) maxConsecutive = consecutive;
      prev = i;
      qi++;
    }
  }

  if (qi < q.length) return -Infinity;
  return maxConsecutive * 10 - firstMatchPos;
}

export function fuzzyFilter(query: string, shortcuts: Shortcut[]): Shortcut[] {
  const scored: Array<{ shortcut: Shortcut; score: number }> = [];

  for (const s of shortcuts) {
    let hostname = s.url;
    try { hostname = new URL(s.url).hostname; } catch { /* use full url */ }

    const urlScore = hostname === s.url
      ? fuzzyScore(query, hostname)
      : Math.max(fuzzyScore(query, hostname), fuzzyScore(query, s.url));
    const labelScore = s.label ? fuzzyScore(query, s.label) : -Infinity;
    const best = Math.max(fuzzyScore(query, s.key), urlScore, labelScore);

    if (best > -Infinity) scored.push({ shortcut: s, score: best });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.shortcut);
}
