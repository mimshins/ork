# Limits: usage and quotas

_Part of [Known gaps and limits](../gaps.md)._

What limits across runs do for now, by choice
([ADR-050](../../decisions/ADR-050-limits-across-runs.md)).

- **L74 · Usage shows estimates, and a plan's limits only when they bite.**
  Costs are Claude Code's estimates, which are not a subscription's bill. A
  plan's limit is acted on when it says `rejected`, and shown from
  `allowed_warning`. How much of a window is used is not shown, as that figure
  isn't in the part of Claude Code's output its types declare.
  ([usage](../usage.md#reports))
- **L99 · A quota can be passed.** The ledger sees only finished sessions, so
  runs already working don't see each other, and each session may spend all that
  was left when it started. Lower caps or `limits.concurrency` make that
  smaller. A session can also run past its cap: one capped at $0.001 reported
  $0.0019. One that never finishes adds nothing to the ledger until it is
  resumed. Reservations would stop every other run on spending that may never
  happen. ([usage](../usage.md#limits-across-runs))
- **L100 · A quota counts what Ork spent here.** It reads this machine's store,
  so it sees neither other machines nor Claude Code used outside Ork. A
  project's cap doesn't count what its runs spend calling into another project,
  which counts there. ([usage](../usage.md#limits-across-runs))
- **L101 · Two accounts on one machine share plan limits.** The store can't tell
  them apart, so one's refusal stops the other's runs until it resets. It lifts
  by itself, or with `ork usage --clear-plan-limits`.
  ([usage](../usage.md#limits-across-runs))
- **L102 · At a limit a run stops, and doesn't wait.** Something has to run
  `ork resume` once it lifts, so an unattended run on a plan ends at a five-hour
  window. Waiting would hold a process for up to a month, and depends on
  [C11](../gaps.md#chores).
  ([ADR-050](../../decisions/ADR-050-limits-across-runs.md))
