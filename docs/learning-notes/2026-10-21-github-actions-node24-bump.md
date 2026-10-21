# Moving GitHub Actions off the deprecated Node 20 runtime

## Why

The [v1.2.4 release run](https://github.com/David-mXu/omnijump/actions/runs/39683035091)
succeeded, but GitHub annotated it:

> Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced
> to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4,
> softprops/action-gh-release@v2.

GitHub is currently force-running Node 20 actions on Node 24 as a compatibility shim.
That shim is temporary: once GitHub stops forcing it, any workflow still pinned to a
Node 20 action stops running. Each action's `action.yml` declares its runtime under
`runs.using`, which is why the fix is "move to a major version that declares
`node24`", not "change `node-version`".

Note the two different Node numbers in a workflow:

- `runs.using: node20` in the *action* → the runtime the action itself executes on.
- `with: node-version: 22` on `setup-node` → the Node used by *your* `run:` steps
  (`npm ci`, `tsc`, `vitest`). Bumping the action does not change this, and vice versa.

## What changed

Checked the newest release of every action used in `.github/workflows/` with
`gh api repos/<owner>/<repo>/releases/latest` and confirmed each `action.yml` declares
`runs.using: node24`:

| Workflow | Before | After |
|---|---|---|
| `ci.yml` | checkout@v4, setup-node@v4, node 22 | checkout@v7, setup-node@v7, node 24 |
| `release.yml` | checkout@v4, setup-node@v4, gh-release@v2, node 22 | checkout@v7, setup-node@v7, gh-release@v3, node 24 |
| `publish-firefox.yml` | checkout@v4, setup-node@v4, node 20 | checkout@v7, setup-node@v7, node 24 |
| `deploy-pages.yml` | checkout@v4, configure-pages@v5, upload-pages-artifact@v3, deploy-pages@v4 | checkout@v7, configure-pages@v6, upload-pages-artifact@v5, deploy-pages@v5 |

`node-version` moved to 24 as well, since Node 22 entered maintenance in October 2026
and the project already builds and tests on Node 24 locally (v24.16.0).

## Breaking changes that mattered

Read from each major's release notes before bumping:

- **checkout v7**: blocks checking out fork PRs for `pull_request_target` and
  `workflow_run` events; also an internal ESM migration. This repo triggers on `push`
  and `pull_request`, neither of which is restricted, so no impact.
- **setup-node v7**: ESM migration, adds `cache-primary-key`/`cache-matched-key`
  outputs, removes a dummy `NODE_AUTH_TOKEN` export. Inputs used here
  (`node-version`, `cache: npm`) are unchanged.
- **action-gh-release v3**: runtime bump only.
- **upload-pages-artifact v5**: composite action that now wraps `upload-artifact@v7`,
  adds `include-hidden-files` (default `false`). `docs/` has no hidden files, so the
  deployed artifact is unchanged.
- **deploy-pages v5 / configure-pages v6**: runtime bump plus polling backoff; inputs
  unchanged.

## How it was verified

- All four workflow files parse as YAML (`python3 -c "yaml.safe_load(...)"`).
- `gh api repos/<repo>/contents/action.yml?ref=<tag>` confirmed `runs.using: node24`
  for checkout v7.0.1, setup-node v7.1.0, action-gh-release v3.0.3, configure-pages
  v6.0.0, deploy-pages v5.0.1 (upload-pages-artifact v5 is composite).
- The push to `main` runs `CI`, which exercises checkout v7 + setup-node v7 on Node 24.
- The same push touches `docs/`, which triggers `deploy-pages` and so exercises the
  three bumped Pages actions.
- `release.yml` and `publish-firefox.yml` only run on tags, so their bumped actions
  are first exercised on the next release. Deliberately not dry-run: a manual Release
  dispatch would re-upload v1.2.4 to the Chrome Web Store while it is still in review.

## Tradeoff / follow-up

Major-version bumps trade stability for currency. The alternative — staying on the
Node 20 actions — works only until GitHub removes the forced-runtime shim. If a new
major ever misbehaves, pinning to the previous major (`@v6`, `@v2`) is a one-line
revert, and `uses:` entries can be pinned to a full SHA for supply-chain hardening
(the Pages actions already pin `upload-artifact` internally by SHA).
