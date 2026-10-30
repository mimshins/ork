# ADR-022 — Integrations as adapters behind registries

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** architecture / extensibility
- **RFC:** [RFC-001](../rfcs/archived/RFC-001-integrations-as-adapters.md)

## Context

Adding an integration (GitLab, GCP, a new Claude driver) must be easy: an
interface, adapters, and a registry. Before this decision each integration was
spread over the workflow schema, the tool executor, `ork doctor` and `ork run`.

## Decision

1. **A new package, `@krapht/ork-integrations`,** at the bottom of the
   dependency direction:
   `integrations <- schema <- core <- runtime-claude, nodes <- server <- cli`.
2. **One adapter per tool integration** implementing `Integration`: `id` (the
   node type is `tool.<id>`), `label`, `program` (or `null` when the command
   names it), its extra node `options` (Zod), the `args` they add, and an
   optional `doctor` check. `INTEGRATIONS` lists them.
3. **Everything reads the registry:** the workflow schema builds one node schema
   per integration (and so the JSON Schema), the tool executor builds argv from
   the adapter, `ork doctor` runs each adapter's check, and the compiler's
   report fields for `tool.*` come from one place.
4. **Claude drivers** get the same treatment: `CLAUDE_DRIVERS` descriptors (id,
   label, doctor) here, and a factory per `DriverId` in
   `@krapht/ork-runtime-claude` (`createRuntime`), typed so a new driver does
   not compile without one. `DriverSchema` comes from the ids.
5. **The refactor moves `gh`, `aws` and `shell` only;** new adapters are added
   when needed. Integrations declared in a workflow (RFC-001, Option B) stay a
   possible follow-up.

## Options considered

See [RFC-001](../rfcs/archived/RFC-001-integrations-as-adapters.md): adapters
plus a registry (chosen); the same plus workflow-declared integrations; one
generic `tool` node with `use:`, which breaks existing files.

## Rationale

One file per integration keeps each one typed, tested and reviewable on its own,
gives editors autocomplete for its options, and leaves the workflow format
unchanged.

## Consequences

- Adding GitLab: write `packages/integrations/src/gitlab.ts`, list it in
  `INTEGRATIONS`, add a test. No other file changes.
- The schema's tool node type is the shared tool shape; an integration's own
  options are validated at parse time and read by its adapter.
- Integrations ship with Ork releases until declared integrations exist.
