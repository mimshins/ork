# ADR-002 — A TypeScript monorepo run from source, with supply-chain policies

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** toolchain
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Ork has a CLI, an engine, Claude drivers, and later a localhost UI. The Claude
Agent SDK is a TypeScript package, the UI will be React, and workflow schemas
must be shared between the CLI, the engine, and the UI. The tool runs agents and
programs on the user's machine, so its own dependencies are part of its attack
surface.

## Decision

1. **One language.** TypeScript end to end, in a pnpm workspace of packages (see
   [specs/architecture.md](../specs/architecture.md)).
2. **Run from source.** Node 24.20+ runs the `.ts` sources directly with type
   stripping: no build step for development or tests. Only erasable syntax is
   allowed (no enums, parameter properties, or namespaces), relative imports
   carry the `.ts` extension, and `tsc` (TypeScript 7) only typechecks
   ([tsconfig.base.json](../tsconfig.base.json)). Publishing bundles the CLI
   ([ADR-015](./ADR-015-changesets-and-one-bundled-cli.md)).
3. **Strict TypeScript.** `exactOptionalPropertyTypes`,
   `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`,
   `skipLibCheck: false`, and the rest of the strict set.
4. **Supply-chain policies** in [pnpm-workspace.yaml](../pnpm-workspace.yaml): a
   version must be 7 days old (`minimumReleaseAge`, strict), dependency
   lifecycle scripts are off (`strictDepBuilds`), versions are saved exact
   (`savePrefix: ""`), and `trustPolicy: no-downgrade`. GitHub Actions are
   pinned by commit SHA; Dependabot uses the same 7-day cooldown.

## Options considered

- **Go backend and React UI.** A single static binary, but the Agent SDK is not
  available in Go and schemas would be duplicated.
- **TypeScript with a build step (tsc/tsdown) for development.** Familiar, but
  every change waits for a build and source maps get in the way of debugging.
- **TypeScript run from source** — chosen.

## Rationale

One language shares the Zod workflow model with every surface and gives the
Agent SDK first-class support. Native type stripping removes a build from the
inner loop; the erasable-syntax rule is a small price. The supply-chain rules
are cheap and stop the most common npm attacks (fresh malicious versions,
install scripts).

## Consequences

- The newest release of a dependency is never installable on its first week;
  pick the newest version that is at least 7 days old rather than adding an
  exclusion.
- Code must avoid TypeScript features that are not erasable.
- Node cannot strip types inside `node_modules`, so the published CLI is bundled
  to JavaScript.
- A few third-party type files need care under `skipLibCheck: false` (one shim:
  [types/dom-shims.d.ts](../types/dom-shims.d.ts)).
