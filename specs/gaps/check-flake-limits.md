# Limits found stopping RFC number clashes and flaky final checks

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building this repository's own tooling: the `rfc` workflow re-checks its
RFC number at publish ([RFCs](../../rfcs/README.md)), a change's ADRs and gap
ids are renumbered the same way ([ADRs](../../decisions/README.md)), and the
`build` workflow's final check takes a machine slot, retries a timed-out test
file once alone and re-runs after a flake
([check once](../check-once.md#in-this-repository), [slots](../machine.md)).
What was left simpler:

- **L490 · The retry reads a vitest JSON report and only retries a bare
  `pnpm test`.** `tools/check/run-tests.ts` asks vitest for its JSON reporter,
  and retries once, alone, only the files whose every failure is a
  `Test timed out` or `Hook timed out` line. A worker crash, a report it cannot
  read, or `pnpm test <args>` is not retried. A test that is really too slow
  passes alone and is hidden; the notice on stderr names the files.
- **L491 · After a renumber, the `rfc` workflow's outputs show the old number.**
  `outputs.path` and `rfc` still hold the path the draft reported
  (`rfcs/active/RFC-027-…`), and the run's draft node keeps it, while the
  published file is RFC-028. The publish step prints the new number; nothing
  reads the outputs afterwards.
- **L492 · The replay needs an RFC-only commit.** `tools/rfcs/renumber.ts`
  replays a commit that touches only new RFC files and `rfcs/README.md` on the
  upstream tip. Any other commit is renumbered in place and rebased, and a
  conflict (the index table, most often) stops the publish with the commit left
  in the worktree, as before. The replay rebuilds the index from upstream's
  README plus the RFC's own rows, so any other edit to `rfcs/README.md` in that
  commit is dropped. Its path guard refuses absolute paths and `..`, not paths
  outside `rfcs/`, on purpose: rewriting a link must touch the other files the
  commit already changes.
- **L494 · Renumber edge cases left as they are.** Links are renamed one move at
  a time, so two added RFCs with the same slug would cascade into each other
  (not reachable in practice). When the clash is with the tool's own ref, the
  printed reason may name the wrong ref; the numbers are right.
- **L495 · A renumber failure prints only the tool's message.** The rebase path
  adds that the RFC is committed in the worktree; the renumber path does not.
- **L496 · A flake in the last allowed round ends the build committed, not
  pushed.** `amend` exits 0 on a flake, so the `amend -> check` edge spends its
  `maxRounds: 2`, and a flake in the last round ends the run as any exhausted
  loop does, with the change committed in the worktree.
- **L524 · ADR and gap-id renumbering leaves the shared lines to the resolver.**
  `tools/decisions/renumber.ts` renames an added ADR that clashes and rewrites
  its ids, but the index rows two changes append and the "next id" line both
  raise still conflict on the rebase, for the resolver. It rewrites only the
  lines the change adds, and a bare `ADR-NNN`, `by NNN` or `L…` only when
  nothing else in the change or its base has that number; a link to the moved
  file is always rewritten. Several commits are renumbered by amending the last
  one. `build`'s publish step runs it before its rebase, as `rfc` runs its own.
- **L493 · `pnpm run check` in the `rfc` publish takes no slot.** It is run
  through `-C "$WORKTREE"`, so the script's heavy-command match does not see it
  ([L363](./machine-limits.md)). It runs the static checks only (`--on` leaves
  the tests out), so the cost is small.
