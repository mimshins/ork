# ADR-112 — Shipped reads without `pnpm`, and a refused call as feedback

- **Status:** Accepted
- **Date:** 2026-11-21
- **Topic:** runtime port, project rules, feedback
- **RFC:** waived: the maintainer decided it directly as the follow-through of
  [RFC-028](../rfcs/archived/RFC-028-permissions-without-asking.md); the options
  weighed are below.
- **Amends:** [ADR-109](./ADR-109-permissions-without-asking.md)

## Context

[ADR-109](./ADR-109-permissions-without-asking.md) gave every node a shipped set
of reads that run without a rule, and listed `pnpm ork …` and `pnpm -s ork …`
among them. `pnpm` runs whatever the project's `package.json` names `ork`, so a
node that can edit that file could change what a later node's "shipped read"
runs, with nobody asked. Separately, the shipped reads were `claude-code`'s
only: the Codex, Command Code and omp guards refused reads `claude-code` allows,
OpenCode's rules allowed none, and a call any of the four refused left no trace
but the node's own result, so a prompt that kept asking for a refused tool was
never visible as a gap to fix.

## Decision

- **The shipped reads name the installed `ork` binary only.** `pnpm ork …`,
  `pnpm -s ork …` and `pnpm --silent ork …` are not shipped reads. `ruleFor`
  still offers a rule for a `pnpm` runner script when a person is asked; it is
  not shipped. `isShippedRead` is one self-contained function (as
  `readShellLine` is), and `NO_FILES` and `LISTS` are exported from
  `@krapht/ork-core`, so the guards embed them and cannot drift from the
  `claude-code` verdict.
- **The Codex hook, Command Code's mod and omp's guard allow a shipped read.**
  After the deny, write-limit, `reading: extract`, `only` and yolo checks, a
  `Bash` line is allowed when every command is covered by an allow rule or is a
  shipped read whose path words resolve inside the worktree, on a line with no
  `cd` and no expanded word.
- **OpenCode gets no shipped reads.** Allow globs were planned for the programs
  with no refused form, gated on a check that an allowed `ls *` cannot write by
  redirect while edits are denied. The check failed in OpenCode 2.3.2's source
  ([L528](../specs/gaps/permissions-limits.md)).
- **`tool.result.fault` widens to `"arguments" | "refused"`** on the runtime
  port's `RuntimeEvent`. `"refused"` means the driver's own guard refused the
  call: the agent's context gap, not a failure of the tool. It is optional, so
  stored events without it still read. The Codex, Command Code, omp and OpenCode
  decoders set it; Codex marks its hook's own result, the others recognise the
  guard's refusal text with one shared recogniser
  ([refusal.ts](../packages/runtime/src/tools/refusal.ts)).
- **Core files `tool.refused` on the third refusal of one tool by one node.** A
  low `context-gap` for the `workflow`, titled by tool and not by node so one
  item covers every node, with the tool's name as its evidence
  ([capture](../specs/feedback/capture.md)). `claude-code` has no marker, so it
  never files it.

## Options considered

- **Keep `pnpm ork` shipped.** Rejected: it leaves the `package.json` path open.
- **Allow the installed `ork` and `pnpm ork` only when `package.json` is
  unchanged.** Rejected: a check on a file's history is more machinery than the
  binary on `PATH`, and a node that can change `PATH` needs an assignment, which
  is never covered.
- **Count refusals by matching text in core.** Rejected: the field keeps core
  free of driver wording; the matching sits in the decoders.
- **Give the guards full `cd` parity with the verdict.** Offered, not chosen:
  `cd x && ls` stays refused there
  ([L527](../specs/gaps/permissions-limits.md)).
- **Ship OpenCode globs without the redirect check.** Rejected: a node denied
  edits could write by redirect.

## Rationale

The shipped set is a trust claim ("Ork's own reads"); `pnpm ork` made it a claim
about a file a node may write. The binary on `PATH` is outside the checkout. A
field on the port is the one place all four decoders already write their tool
faults, and a count of three is cheap, local and reversible.

## Consequences

- A node that read through `pnpm ork …` is now asked, or refused; it reads with
  `ork …`, which needs the installed binary on `PATH`.
- Codex and Command Code nodes in `ork onboard` with no `Bash` rule can run
  shipped reads such as `ls` inside the worktree.
- A port change: every driver's decoder may set `fault: "refused"`, and a store
  that validates events must accept it.
- A reworded guard or OpenCode error is not counted until the recogniser learns
  it, and the threshold 3 is unmeasured
  ([L530, L532](../specs/gaps/permissions-limits.md)).
- OpenCode's own shell allow rules keep a redirect-write and outside-read hole
  that predates this change ([L531](../specs/gaps/permissions-limits.md)).
