---
"@krapht/ork": patch
---

Budgets and usage report what really happened. A run whose `limits.budgetUsd` or
`limits.budgetTokens` runs out while a session is working now ends
`budget_exhausted` instead of `failed`: no failure edge fires, and `ork resume`
continues that session. A session stopped by `ork stop` or its token cap keeps
the tokens it used, so `ork ps`, `ork usage`, the day quota and resume count
them. `ork validate` and `ork run` warn (`budget.leader`) when a leader with
nodes to delegate to has no cap of its own under a run budget, since it would
hold the whole budget and its workers would be refused; the `ork init` starter's
leader now has `budgetUsd: 2`. A budget stop reads
`reached its budget (used 250 of 200 tokens)`; a budget that is not a whole
number above 0 says so; nodes still queued when a run stops count as skipped;
`ork usage --clear-plan-limits` says how many it cleared; the Limits line shows
both sides of a dollar cap alike; and `ork usage`, `ork tree` and the Usage
panel name token figures one way: prompt, out and counted. The guides now say
that a node's caps start over on each activation and that a session's tokens
show once it ends or is stopped.
