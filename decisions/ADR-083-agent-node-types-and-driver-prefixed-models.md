# ADR-083 — Agent nodes are `agent.*`, and a model may name its driver

- **Status:** Accepted; supersedes the node type names of
  [ADR-006](./ADR-006-workflow-file-format.md)
- **Date:** 2026-11-11
- **Topic:** workflow format, runtime drivers, CLI
- **RFC:** [RFC-015](../rfcs/archived/RFC-015-format-for-several-drivers.md)
  (option A, accepted 2026-11-10); the RFC stays active until its part 2, the
  token budgets, ships

## Context

[RFC-014](../rfcs/archived/RFC-014-cli-drivers-only.md) lets Ork run OpenCode
and Command Code beside `claude` ([ADR-076](./ADR-076-cli-drivers-only.md)), but
the workflow file still named one vendor: the node types were `claude.worker`,
`claude.leader` and `claude.subagent`, and `model` took Claude Code's aliases,
which mean nothing to the other tools. A node's tool and model could disagree
without a word.

## Decision

- **The node types are `agent.worker`, `agent.leader` and `agent.subagent`.**
  The rename is mechanical: nothing else about them changes. No alias is kept
  for the old names, and `main` never carries both: `ork validate` and `ork run`
  refuse `claude.worker` (and the others) with "`claude.worker` was renamed to
  `agent.worker`; run `ork migrate`".
- **A `model` may start with its driver: `<driver>.<model>`.** The text before
  the first `.` is the driver when it is a registered driver id (ids have no
  dots), and the rest goes to that tool as written. Otherwise the whole value is
  a plain model for the run's driver, so `deepseek/deepseek-v4.1-flash` is
  unchanged. It is read in one place (`driverOf`) for the compiler, the driver
  fit check, each `forEach` item's rendered `{{item.model}}` and the Builder.
- **A prefix pins the session's driver, ahead of `--driver`.** The order is the
  model's prefix, `--driver`, the node's (or its agent's) `driver`,
  `defaults.driver`, then the driver ready on the machine. A prefix that
  contradicts the node's own `driver` is a compile error (`model.driver`).
- **A driver says whether it runs subagents.** `DriverCapabilities` gains
  `subagents`: `claude-code` yes; `open-code` and `command-code` no, unmeasured
  (L274). An `agent.subagent` under a leader on a driver without it is refused
  at validate and at run, naming the driver.
- **`ork migrate` rewrites the format.** It renames the types in the project's
  workflow files in the YAML document (comments and layout kept), leaves `model`
  values alone, prints one line per file, and `--dry-run` writes nothing. A file
  it cannot parse is named and left untouched.
- **`schemaVersion` stays 1.** The format is alpha, and `ork migrate` is the
  path; a bump would add a second way to break a file for no one.
- **Ork's own workflows and examples** name models with the prefix by alias
  (`claude-code.sonnet`, `claude-code.opus`).

## Options considered

- **A: driver-prefixed models and `agent.*` types** (chosen).
- **B: a per-driver model mapping in project rules, keeping `claude.*`.**
  Declined: a model would still mean different things by the tool chosen at run
  time, and the node's types would still name one vendor.
- **An alias period** for the old names. Declined: the format is alpha, and two
  names for one node would outlive the migration they were kept for.

## Rationale

One field says both the tool and the model, so they cannot disagree, and the
node names stop saying `claude` for a node that runs on any tool. Breaking the
format now, while it is alpha, costs a `ork migrate`; later it would cost every
user's workflows.

## Consequences

- Every user workflow needs `ork migrate` once. The changeset and the release
  notes say so.
- Records (ADRs, archived RFCs, changesets, benchmarks) keep the old names: they
  describe the past.
- Limits: `ork migrate` scans only the workflows folder (L273); written item
  values are checked at run (L275); a few TypeScript identifiers keep `claude`
  (L276). See [the register](../specs/gaps/agent-types-limits.md).
- Part 2 of RFC-015 (`budgetTokens`, `dayTokens`, mixed-run warnings) builds on
  this.
