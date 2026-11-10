# Limits found fixing QA run e4894f17

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found fixing the 1.0.0-alpha QA run e4894f17 (fake `claude`, packed tarball,
2026-11-10). What was fixed is in the specs and guides it touches; what follows
is what was left simpler, or could not be checked.

- **L216 · Only a node's own sessions set their cap aside.** Since
  [ADR-077](../../decisions/ADR-077-reserve-session-caps.md) a session reserves
  its cap from `limits.budgetUsd` as it starts. A fork that answers a child's
  question for its leader, and a `workflow.call`, do not; they are offered what
  is left after the reserves and count when they end (L53). A session can still
  pass its own cap by the turn that crosses it, as `--max-budget-usd` stops it
  after that turn. ([limits](../usage.md))
- **L217 · A node that is delegated and run by an edge may keep a stale
  result.** `node.started` supersedes an earlier result by its round, used as a
  position, so a node run both ways in one run can read the older one.
- **L218 · Gone with the SDK driver.** Its `interrupted` branch was untested;
  RFC-014 removed the driver, and the claude-code driver's branch is tested.
- **L219 · The real `claude` may die when a question stays open.** The fake
  `claude` died after about five minutes with a question open. Only the failure
  reason text is fixed. The maintainer should check whether the real CLI does
  the same.
- **L220 · A failed `mcp.call` item has no `error` in `results`.** A failed
  program item gets `exitCode` and `error`; an item of `mcp.call` does not.
  ([running a node once per item](../scheduler/for-each.md))
- **L221 · The wait after a loop runs out carries no signal.** The question
  `askAboutLoop` asks has no abort signal and may keep waiting after a stop.
- **L222 · Ctrl-D at a prompt leaves the question unanswered.** It closes the
  readline interface; the question stays open for `ork decide`.
- **L223 · `ork decide` and `ork chat` keep the old Ctrl-C behavior.** Only the
  run's own question prompt interrupts on the first Ctrl-C.
- **L224 · `ork logs` can't know a terminal was asking.** It prints the
  `ork decide` command only.
- **L225 · `--run` takes an exact run id, not a prefix.** An unknown id is an
  error that names it.
- **L226 · An unrecorded `ork/` branch is never cleaned from Ork.**
  `ork worktrees` lists it as not created by Ork and keeps it; the user deletes
  it with git. ([worktrees](../worktrees.md))
- **L227 · A fanned item that fails with `ok: false` and no output may fail the
  node oddly.** The report was
  `Cannot read properties of undefined (reading 'json')`. `NodeResult.output` is
  required, so the reading in
  [fan-out.ts](../../packages/core/src/run/fan-out.ts) could not be reproduced;
  not guarded.
- **L228 · The Decisions panel shows a stale list while `ork ui` is
  unreachable.** The cards are the last list received; one answered elsewhere
  meanwhile leaves when the stream returns.
  ([the panel](../ui/panels-decisions-filters-and-keys.md#when-ork-ui-is-unreachable))
- **L229 · Not run by the testers.** Overflow `first` and `all`; per-item
  worktrees merging into a parent; `ork stop --node build.N` with real
  worktrees; `readonly` write denial; the Builder and Monitor views of fanned
  nodes; `defaults.isolation`; `pnpm add --global`.

- **L230 · A node's earlier sessions leave the budget check once it ends.** When
  a node settles, its in-flight costs are cleared and only its final session's
  own spend is added to what the run has spent, so an earlier session of the
  same node (a retry, a late turn) is no longer counted
  ([scheduler](../scheduler.md)).

## Chore

- **C14 · Two user pages sit at exactly 200 lines.**
  [quickstart.md](../../docs/getting-started/quickstart.md) and
  [installation.md](../../docs/getting-started/installation.md): the next
  addition to either forces a hub and chunks
  ([docs layout](../../runbook/development/docs.md)).
