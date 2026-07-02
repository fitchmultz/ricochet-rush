# Dependency Policy

This project keeps runtime and tooling dependencies exact-pinned in `package.json` and locked in `package-lock.json`. Use the pinned `packageManager` value, `npm@11.16.0`, for install-script policy and lockfile updates.

## Local Gate

```sh
npm ci
npm outdated --json
npm audit
npm approve-scripts --allow-scripts-pending
npm run ci
```

`npm run ci` starts with `npm run deps:verify`, which exercises the reviewed runtime override surfaces: Cursor SDK sqlite storage opens and disposes, Connect Node initializes its transport, and Cursor SDK exports the expected Agent API.

Optional live Cursor SDK verification, when `CURSOR_API_KEY` is available:

```sh
npm run sdk:probe
npm run sdk:reliability
```

Before merging changes that affect Cursor generation behavior, maintainers should run `npm run sdk:probe` with `CURSOR_API_KEY` set. GitHub Actions PR CI does not run the live SDK probe.

## Reviewed Overrides

Reviewed on July 1, 2026 by the project maintainer. Overrides are scoped to the dependency branch that needs them.

| Override | Scope | Why it exists | Cleanup trigger |
| --- | --- | --- | --- |
| `undici@8.5.0` | `@cursor/sdk` → `@connectrpc/connect-node` → `undici` | Keeps the Connect Node transport polyfill dependency on the current Undici release. This requires Node `>=22.19.0`. | Remove when `@connectrpc/connect-node` or `@cursor/sdk` resolves Undici 8+ without an override. |

`npm ci` must not emit deprecation warnings. If a dependency update introduces one, treat it as release-blocking dependency debt and replace, upgrade, or remove the source before shipping.

## Reviewed Install Scripts

`allowScripts` is pinned to exact package versions. Re-run `npm approve-scripts --allow-scripts-pending` after dependency updates and approve only packages whose install hooks are expected for native binaries or optional platform integrations.

Current approvals:

- `esbuild@0.28.1`
- `fsevents@2.3.2`
- `fsevents@2.3.3`

## Cursor SDK Model Contract

The game defaults to `composer-2.5` with explicit `fast=true` model parameters. Server startup discovers the live Cursor model catalog with a bounded timeout, uses the catalog-backed Composer 2.5 entry when available, and falls back to the pinned local selection if catalog discovery fails. It uses `{ id: "auto" }` only when the catalog is reachable and no Composer 2.5 alias is exposed.
