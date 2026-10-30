# ADR-015 — Releases with changesets and one bundled CLI

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** release
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Ork ships to users as a command, `ork`. The bare `ork` package name is taken on
npm. Node cannot run TypeScript from `node_modules`, so the run-from-source
packages ([ADR-002](./ADR-002-typescript-from-source.md)) cannot be published as
they are. The maintainer's containerized-state repository already releases with
changesets and wanted the same route here.

## Decision

1. **One published package: `@krapht/ork`** (bin `ork`), under the maintainer's
   `@krapht` scope. tsdown bundles the internal packages into it.
2. **Internal packages follow the same naming** and stay private:
   `@krapht/ork-schema`, `@krapht/ork-core`, `@krapht/ork-runtime-claude`,
   `@krapht/ork-nodes`, `@krapht/ork-server`. Any of them can be published later
   without a rename.
3. **Changesets.** Every change to shipped code carries a changeset; a pull
   request check runs `changeset status` (skipping the release branch).
4. **The containerized-state route.** On every push to `main`,
   `changesets/action` opens or updates a "version packages" pull request;
   merging it publishes to npm and creates a GitHub release, with
   `@changesets/changelog-github` changelogs.
5. **Hardened publishing:** npm provenance, SHA-pinned actions, least-privilege
   job permissions, frozen lockfile, no lifecycle scripts; the npm token is a
   repository secret only the release job reads.
6. **Versions stay on 0.x** until the workflow format and CLI are stable.

Procedure: [runbook/development/release.md](../runbook/development/release.md).

## Options considered

- **Names:** `@mimshins/ork`, `@ork/cli` (needs the `ork` npm org), `ork-cli`,
  or `@krapht/ork` — the maintainer chose `@krapht/ork`.
- **What to publish:** one bundled CLI, or every package — one bundled CLI,
  since only the CLI needs to ship today.
- **Release tooling:** changesets, semantic-release, or manual tags —
  changesets, as in containerized-state.

## Rationale

One package is one thing to install, version, and audit. Changesets keep release
notes written by people at the time of the change, and the release pull request
makes every publish an explicit, reviewable merge.

## Consequences

- The CLI needs a build for publishing only; development still runs from source.
- Publishing needs an `NPM_AUTH_TOKEN` repository secret with publish rights on
  `@krapht`, configured by the maintainer.
- A package published later needs its own build and public flag; its name is
  already settled.
