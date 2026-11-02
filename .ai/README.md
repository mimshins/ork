# .ai — agent knowledge layer

Map of the AI-oriented layer of this repository. It **links to** the project's
own knowledge (`specs/`, `decisions/`, `rfcs/`, `runbook/`, `docs/`,
`README.md`, `CONTRIBUTING.md`, the code and its config) and never duplicates
it. If every AI tool and this directory were removed, Ork and every decision
would still stand on their own
([ADR-001](../decisions/ADR-001-spec-driven-development.md)).

Entry point for agents: [`AGENTS.md`](../AGENTS.md), the only instruction
source. Tool adapters are pointers only: `CLAUDE.md` (`@AGENTS.md`) and the
symlinks `.claude/skills` → `.ai/skills` and `.claude/agents` → `.ai/agents`.

**Public repository:** everything here is world-readable. No secrets, tokens,
internal hostnames, dashboard links, or personal data, in memories included.

## Placement rules

| Location                | Holds                                                     | Test question                                                        |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `specs/`                | the contract for current and specified behavior, per area | Is this what Ork does, or is specified to do?                        |
| `rfcs/`                 | proposals (`active/`) and closed ones (`archived/`)       | Is it proposed, not yet decided?                                     |
| `decisions/`            | accepted decisions and why (ADRs)                         | Does it record _why_ something was decided?                          |
| `runbook/`              | procedures: develop, release, docs                        | Would a human follow it step by step, with no AI tooling?            |
| `docs/`                 | the overview and the interaction map                      | Does it explain how the whole fits together?                         |
| `.ai/memories/`         | short, present-state orientation for agents               | Does it help an agent decide, without being a contract or procedure? |
| `.ai/memories/working/` | committed in-flight context                               | Is it still unresolved?                                              |
| `.ai/specs/`            | local task specs (**gitignored**, never committed)        | Is it one piece of work's working spec?                              |
| `.ai/skills/`           | how to perform a reusable class of task                   | Is it a repeatable workflow?                                         |
| `.ai/agents/`           | subagent roles for building Ork (not shipped with it)     | Is it a role an agent takes on to work on this repository?           |
| `.ai/templates/`        | templates for task specs, RFCs, ADRs, and memories        | —                                                                    |

Rules: one source of truth — link, don't copy. Memories describe the present,
not history (history is ADRs, RFCs, and git). Runtime code never reads from
`.ai/`.

**Precedence** when sources disagree: explicit developer instructions >
code/config > `specs/` > `decisions/` > `runbook/` and `docs/` >
`.ai/memories/` > working memories > agent assumptions. An RFC that is not
`Accepted` never overrides any of them. Fix or flag the lower source and say so
in your report.

## Index

Load only what the task needs.

### Memories (`memories/`)

- [`overview.md`](./memories/overview.md) — what Ork is, the package map, and
  where knowledge lives. Read first.
- [`development-workflow.md`](./memories/development-workflow.md) — commits,
  pull requests, no AI attribution, the local quality gate. Before committing or
  opening a pull request.
- `working/` — in-flight context; resolve each file before its change lands.

### Skills (`skills/`)

- [`write-an-rfc`](./skills/write-an-rfc/SKILL.md) — route RFC vs. ADR vs. task
  spec; carry an RFC to an ADR and the archive.
- [`knowledge-drift-sync`](./skills/knowledge-drift-sync/SKILL.md) — reconcile
  code and knowledge before handing off; holds the knowledge-maintenance table.
- [`docs-structure`](./skills/docs-structure/SKILL.md) — the hub and chunk
  layout for long documents, and `pnpm docs:check`.
- [`resync-map`](./skills/resync-map/SKILL.md) — bring the interaction map up to
  date with the code.

### Agents (`agents/`)

Subagents for working on Ork itself; each links to `AGENTS.md` and never copies
it. None commits or pushes.

- [`implementer`](./agents/implementer.md) — builds one confirmed task of a task
  spec, with its tests and knowledge updates, until `pnpm check` passes.
- [`engine`](./agents/engine.md) — the scheduler, runtime drivers, store, run
  control and replay; designs and builds run semantics.
- [`ui-designer`](./agents/ui-designer.md) — the design system, copy and
  workspace; designs before code and reviews UI changes.
- [`reviewer`](./agents/reviewer.md) — read-only review for correctness and the
  repo's rules.
- [`a11y-auditor`](./agents/a11y-auditor.md) — read-only WCAG 2.2 AA audit in a
  real browser.
- [`docs-keeper`](./agents/docs-keeper.md) — runs the drift sync and map resync
  on documentation only.

### Templates (`templates/`)

- [`spec.md`](./templates/spec.md) — a local task spec in `.ai/specs/`.
- [`rfc.md`](./templates/rfc.md) — an RFC in `rfcs/active/`.
- [`adr.md`](./templates/adr.md) — an ADR in `decisions/`.
- [`memory.md`](./templates/memory.md) and
  [`working-memory.md`](./templates/working-memory.md) — memories.
