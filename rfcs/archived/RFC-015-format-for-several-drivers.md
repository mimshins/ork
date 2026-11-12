# RFC-015 — A workflow format for several drivers

- **Status:** Implemented
- **Date:** 2026-11-10
- **Supersedes:** —
- **Superseded by:** —

## Context

[RFC-014](../archived/RFC-014-cli-drivers-only.md) lets Ork run OpenCode and
Command Code beside `claude`. Three parts of the workflow file assume Claude:

- **Node types** are `claude.worker` and `claude.leader`
  ([ADR-006](../../decisions/ADR-006-workflow-file-format.md)), though either
  would now run any of the three tools.
- **`model`** takes Claude Code's names (`sonnet`, `opus`). OpenCode wants
  `provider/model`, and Command Code its own ids
  (`deepseek/deepseek-v4.1-flash`), so `model: sonnet` means nothing to them.
  The `driver` field and `ork run --driver` pick the tool
  ([ADR-064](../../decisions/ADR-064-driver-chosen-at-run-time.md)).
- **Budgets** are in dollars only (`budgetUsd`). RFC-014 measured that Command
  Code reports tokens and no price, while OpenCode reports both per step. The
  token counts come in four kinds: input, output, cache read and cache write.
  Cache reads dominate: about 20,000 of 33,000 input tokens in the Command Code
  probe.

`claude` resolves an alias such as `sonnet` to the newest model it knows, and
the session's start event records the model it resolved, so a run shows what it
used.

## Options

### Option A — Name the driver in the model, rename node types, add token budgets

`model: <driver>.<model>`; `agent.worker` and `agent.leader`; `budgetTokens`
beside `budgetUsd`.

- **Pros:** One field says both the tool and the model, so they can't disagree.
  Node names stop naming one vendor. Every driver gets a budget.
- **Cons:** A breaking change to every workflow file, while the format is alpha.

### Option B — Keep the format; map per driver in project rules

Node types and `model` stay; `.ork/project.yaml` maps `sonnet` to each tool's
id.

- **Pros:** No file changes.
- **Cons:** The mapping is one more thing to keep, and `claude.worker` running
  Command Code reads wrong. Dollar-only budgets stay unenforceable on Command
  Code.

## Decision

The maintainer chose **Option A** on 2026-11-10:

- **A model names its driver.** `model` is `<driver>.<model>`:
  `claude-code.sonnet`, `open-code.anthropic/claude-sonnet-5-5`,
  `command-code.deepseek/deepseek-v4.1-flash`. The text before the first `.` is
  the driver id (driver ids have no dots), and the rest is passed to that tool
  as it is. The prefix picks the driver: such a node needs no `driver` field,
  `ork run --driver` doesn't override it, and `ork validate` refuses a prefix
  that contradicts a `driver` the node sets. A `model` with no prefix goes to
  the driver chosen at run time, as today.
- **Aliases in Ork's own workflows.** This repository's `.ork/workflows/` and
  `examples/` name models by alias (`claude-code.sonnet`), not by full id, so
  they follow each tool's newest model. The resolved model is logged per
  session.
- **Node types are renamed:** `claude.worker` becomes `agent.worker`,
  `claude.leader` becomes `agent.leader`, and `claude.subagent` becomes
  `agent.subagent` (a driver whose tool has no subagents is refused for it
  through its declared capabilities), matching the `<family>.<kind>` names of
  every other node type. A command rewrites old files (`ork migrate` today moves
  projects into `.ork/`, [ADR-036](../../decisions/ADR-036-ork-migrate.md), so
  this is a new mode or a new command), and `ork validate` names the new type
  when it reads an old one.
- **Budgets in tokens as well as dollars.** `budgetTokens` sits wherever
  `budgetUsd` does: on a node, in `defaults`, in `limits`. It works on every
  driver, and counts input, output and cache-write tokens; cache reads don't
  count. A driver that reports no price can't enforce `budgetUsd`, so there
  `ork validate` warns that only `budgetTokens` applies, rather than refusing
  the node.

Order: the node rename and the model prefix together, then `budgetTokens`. Both
come after RFC-014's SDK removal, so the driver ids exist.

## Consequences

- **Format:** every workflow file changes, this repository's included, with the
  JSON Schema, the Builder, the examples and the docs. The change is breaking,
  so its ADR supersedes the node-type names in ADR-006.
- **Spend:** a run's spend is recorded in tokens beside dollars, in `ork usage`,
  `ork ps` and the UI, and the project's daily quota may need a token form too.
- **Walking and validation:** `ork validate` checks the prefix against the
  registered drivers and the budget fields against each driver's declared
  capabilities (RFC-014).

## Resolved questions

Answered by the maintainer, 2026-11-11:

1. **A token quota.** Yes: `quotas.dayTokens` sits beside `dayUsd`, counting
   what `budgetTokens` counts (input, output and cache-write tokens), so a
   project on a driver without prices still has a daily cap.
2. **Mixed budgets on one run.** Warn and show it: `ork validate` warns when a
   run's dollar limit can't see some of its nodes, and `ork usage`, `ork ps` and
   the UI mark such a dollar total as partial, with tokens beside it. The mix is
   not refused.

Built in two changes, in the RFC's order: the node rename, the model prefix and
the migration first
([ADR-083](../../decisions/ADR-083-agent-node-types-and-driver-prefixed-models.md));
then `budgetTokens`, `dayTokens` and the mixed-run warnings
([ADR-084](../../decisions/ADR-084-budgets-and-quotas-in-tokens.md)).
