# ADR-001 — Spec-driven development and the knowledge layout

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** repository / process
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Ork's first design lived in one document, `docs/design.md`, which grew past 450
lines and mixed current contracts, rationale, and plans. Decisions made in
conversation (the runtime drivers, structured-output reports, the in-house MCP
server) were recorded nowhere but the code and commit messages. The maintainer
uses a spec-driven workflow in other repositories (sudo-overclock,
se-client-kit, se-backend) and wanted the same practice here, including
se-backend's rule for splitting long documents.

## Decision

1. **Knowledge layout.** Each kind of knowledge has one home, and all of it
   stands without AI tooling:
   - [`specs/`](../specs/README.md) — the contract for current and specified
     behavior, one spec per area, each with a status line;
   - `rfcs/active/` and `rfcs/archived/` — proposals with real alternatives
     ([rfcs/README.md](../rfcs/README.md));
   - `decisions/` — accepted decisions and why (this folder);
   - `runbook/` — procedures a human follows (develop, release, docs);
   - `docs/` — the overview and the
     [interaction map](../docs/interaction-map/README.md);
   - `.ai/` — the agent layer: memories, skills, templates, and local,
     gitignored task specs in `.ai/specs/` ([.ai/README.md](../.ai/README.md)).
2. **Workflow.** An architectural change starts from a task spec
   ([template](../.ai/templates/spec.md)), is clarified, goes through an RFC
   when there are real alternatives, is broken into tasks, and is confirmed with
   the maintainer before code. It lands with its spec updated and, when hard to
   reverse, an ADR. Routine changes and bug fixes need no spec.
3. **Long documents.** A document in `specs/`, `docs/`, or `runbook/` over 200
   lines is a hub (`## Contents`) plus a one-level folder of chunks, each chunk
   under 280 lines and linking back with `_Part of [Hub](…)._`. ADRs and RFCs
   stay atomic. `pnpm docs:check`
   ([tools/docs/check.ts](../tools/docs/check.ts)) enforces links, anchors, and
   this structure; the procedure is
   [runbook/development/docs.md](../runbook/development/docs.md).

## Options considered

- **Keep one design document.** Simple, but a 450-line file is hard to review,
  hard to link precisely, and gives no place for the _why_.
- **Task specs only, local** (sudo-overclock). Leaves contributors without a
  committed contract to code against; Ork is open source and needs one.
- **Committed specs only** (se-backend). Gives no lightweight, disposable place
  for in-flight work.
- **Both committed specs and local task specs** — chosen.

## Rationale

Committed specs give contributors and agents a precise contract; local task
specs keep planning noise out of the history; ADRs keep the reasoning after the
conversation that produced it is gone. The hub/chunk rule keeps each file
reviewable and each anchor stable, and a checker makes it cheap to keep.

## Consequences

- `docs/design.md` became an overview hub; its content moved into `specs/`.
- Every change that alters behavior updates its spec in the same change; the
  [knowledge-drift-sync](../.ai/skills/knowledge-drift-sync/SKILL.md) skill
  lists what to review.
- More files to keep in sync, which `pnpm docs:check` and `pnpm map:check` make
  visible.
