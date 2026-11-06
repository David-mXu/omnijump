# 2026-11-06 — Why "You often visit Localhost. Save 'loc' as a shortcut?" was nonsense

## Problem

With `smartSuggestions` enabled, the side panel sometimes showed:

> You often visit **Localhost**. Save **'loc'** as a shortcut?

Accepting it created a redirect shortcut `loc → http://localhost/` — which is dead for
any dev-server workflow, because real dev servers live on non-80 ports
(`localhost:3000`, `localhost:5173`, `localhost:9022`, …).

## Root cause

Two compounding details in `src/background.ts` `handleSmartTip()`:

1. **Counting is keyed by hostname, and `hostname` excludes the port.**
   `url.hostname` for `http://localhost:3000` is `localhost` — the port only lives in
   `url.host`. So every distinct dev server (ports 3000, 5173, 9022, …) got lumped into
   one "localhost" bucket and crossed `TIP_THRESHOLD = 3` very quickly.
2. **The suggested URL is reconstructed without the port:**
   `siteUrl = \`${parsed.protocol}//${host}/\`` → `http://localhost/` — i.e. port 80,
   where nothing is listening. Even if the user wanted a localhost shortcut, the one the
   banner offered was broken by construction.

"loc" comes from `suggestKeyFromUrl()` (`src/suggest.ts`): base = `localhost`, longer
than 3 chars, so it takes the first 3 characters. "Localhost" is
`formatSiteName()` capitalizing the first hostname label.

Key concept — hostname vs. origin: browsers model an *origin* as
`scheme://hostname:port`. Visits keyed only by hostname collapse different origins
(services) together. For ordinary websites that's fine (example.com ≈ one site); for
localhost it's wrong by design, since the port *is* the service identity.

## Fix

Loopback / local-dev hosts are now rejected by the existing single "never suggest this
host" gate, `isBlocklisted()` in `src/background.ts` — the same place where search
engines were already excluded:

```ts
if (host === 'localhost' || host.endsWith('.localhost')) return true;
if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
if (host === '[::1]') return true;
```

Details worth knowing:

- `*.localhost` subdomains are excluded too — they're loopback per the WHATWG URL spec
  and often used by multi-tenant dev servers.
- The WHATWG URL parser **normalizes** IPv4 forms, so `http://127.1/` parses to
  hostname `127.0.0.1` — the `/^127(?:\.\d{1,3}){3}$/` regex only ever sees the dotted
  quad, but matching the full `127.0.0.0/8` range (not just `127.0.0.1`) is still
  correct since any `127.x` address is loopback.
- IPv6 loopback hostname keeps its brackets: `new URL('http://[::1]:3000/').hostname`
  → `'[::1]'` (verified against Node's WHATWG URL; browsers behave the same).

Placing the rule inside `isBlocklisted()` means blocked hosts also get
`clearTipState()` — a previously-shown localhost banner is cleared on the next
navigation to any host, so no stale banners linger.

## Alternative considered (not taken)

**Port-keyed suggestions** (`host:port` counting + `origin`-based URL reconstruction)
would yield *useful* dev shortcuts like `loc → http://localhost:5173/`. It requires
changing the suggestion `host` field semantics, the `alreadyCovered` comparison, the
dismissal list, and the panel display. Rejected for now: more intrusion, and the
motivating complaint was that the suggestion is noise. If users later ask for
dev-server suggestions, count by `parsed.host` instead of `parsed.hostname` and revert
the loopback exclusion.

## Verification

- New test in `src/background.test.ts` ("never triggers smart tips for localhost /
  loopback hosts"): 4 visit cycles each for `localhost`, `api.localhost`,
  `127.0.0.1`, `[::1]` — asserts no visit counts, no `suggestion_${tabId}`, no TIP badge.
- `npm test` → 216/216 pass. `npx tsc --noEmit` → clean.
- Hostname parsing assumptions verified with a direct WHATWG URL check in Node
  (port-stripping, `127.1` normalization, IPv6 brackets).
