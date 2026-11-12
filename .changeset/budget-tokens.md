---
"@krapht/ork": patch
---

Every driver can now be capped in tokens. `budgetTokens` sits beside `budgetUsd`
on a node, in `defaults`, in a workflow's `limits` and in agent files, and
counts input, output and cache-write tokens (cache reads never count). A session
stops once it reaches its cap and ends `budget_limit`, at most one usage report
past it; a run's `limits.budgetTokens` is set aside per session as dollars are,
and `quotas.dayTokens` caps a project's day, shown in `ork usage`. A dollar
budget on a driver that reports no price (`command-code`) is no longer refused:
`ork validate` and `ork run` warn that only `budgetTokens` applies, and a dollar
total that misses such sessions reads `(partial)` in `ork usage`, `ork ps` and
the run summary, and `≥` in the browser view, with the counted tokens beside it.
