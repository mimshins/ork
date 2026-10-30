# ADR-014 — The interaction map as the onboarding and audit view

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** documentation
- **RFC:** waived — the maintainer's request on 2026-10-30

## Context

A system of hierarchical agents, drivers, tools, and decisions is hard to grasp
from prose. The maintainer's se-interaction-map project shows how pieces fit
together as interactive maps and helps onboarding and audits. Ork needed the
same, and it had to stay honest while most of Ork is still specified, not built.

## Decision

1. **`docs/interaction-map/`** is a static, data-driven page (plain HTML, CSS,
   and ES modules, no build step, no dependencies), ported from
   se-interaction-map: maps of components and connections, and journeys that
   walk a flow step by step ([README](../docs/interaction-map/README.md)).
2. **Status is explicit and audited.** Every card and connection is `built`,
   `partial`, `specified`, `planned`, or `external`. The checker
   ([check.mjs](../docs/interaction-map/tools/check.mjs)) validates the data and
   every doc link, requires code links for built and partial cards, and lists
   specified cards whose code has appeared.
3. **Kept in sync.** `pnpm check` and CI run `pnpm map:check`; the
   [resync-map](../.ai/skills/resync-map/SKILL.md) skill brings the maps up to
   date with the code and records the synced commit.

## Options considered

- **Static diagrams in Markdown.** Cheap, but they go stale silently and cannot
  carry status.
- **A diagram generated from the code.** Accurate for what exists; shows nothing
  of what is specified or planned.
- **A data-driven map with an audit checker** — chosen.

## Rationale

The map shows the whole design, built or not, and the checker keeps its claims
honest, so it serves onboarding (how does it work) and audit (what exists today)
at once.

## Consequences

- A change in how parts interact updates the map in the same change.
- The renderer is excluded from oxlint (ported code with its own style); its
  tools lint clean.
