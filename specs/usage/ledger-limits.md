# Limits: the usage ledger and pruning

_Part of [Usage: what runs spent over time](../usage.md)._

How the [usage ledger](../usage.md) and [`ork prune`](../usage.md#ork-prune)
work for now, by choice
([ADR-046](../../decisions/ADR-046-usage-ledger-and-prune.md)). Pruning stays by
hand, and the ledger is kept for good: the gaps review kept both.

- **L72 · Pruning is by hand.** Nothing removes old runs unless `ork prune` is
  run, so the store grows until then, and there is no retention setting.
  ([usage](../usage.md#ork-prune))
- **L73 · A session's cap is per process.** Claude Code's `maxBudgetUsd` counts
  only that process's spend. Held legs and late-message turns reuse the cap set
  before the session began, so a run can pass its budget by that much.
  ([ADR-046](../../decisions/ADR-046-usage-ledger-and-prune.md))
- **L75 · Usage hints have fixed thresholds.** They are not set per project.
  ([usage](../usage.md#reports))
- **L76 · Old runs keep their old cost.** Runs recorded before ADR-046 keep
  their overstated `cost_usd` in `ork ps` and `ork tree`; the ledger is
  corrected. Resuming such a run goes on from the overstated figure, so it can
  stop early against its budget.
  ([ADR-046](../../decisions/ADR-046-usage-ledger-and-prune.md))
- **L77 · The ledger is never pruned.** It grows by a row per session, for good,
  so `ork usage` keeps its history. ([usage](../usage.md#ork-prune))
- **L78 · Prune takes a missing project folder as gone for good.** An unmounted
  disk reads the same, so its runs can go, and `ork worktrees` then misses their
  custom-named branches. ([usage](../usage.md#ork-prune))
- **L79 · Prune cannot see a chat in progress.** A chat that outlasts
  `--older-than` can lose its run and that turn's ledger row, and shrinking the
  store can fail a long chat's next write. ([usage](../usage.md#ork-prune))
