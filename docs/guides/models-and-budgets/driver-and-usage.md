# The driver and what you spent

_Part of [Models, effort and budgets](../models-and-budgets.md)._

## The driver

```yaml
defaults:
  driver: claude-code
```

`driver` picks how Ork reaches Claude, per workflow or per node, and
`ork run --driver` overrides both. With none named, a run uses the driver that's
ready on the machine running it, and `claude-code` (your own `claude`) when more
than one is ready. `claude-code`, `open-code` and `command-code` are all proven
on real sessions ([Drivers](../drivers.md),
[Accounts and credentials](../accounts.md)).

`ork validate` and `ork run` refuse a node its driver can't serve, naming both
([troubleshooting](../troubleshooting/setup.md)).

## What you spent

`ork usage` adds up what this project's sessions spent over the last 30 days:

```sh
ork usage                     # totals, by day, workflow, model and costliest node
ork usage --project all --since 90d   # every project, further back
ork usage --by node           # one table, in full
ork usage --json
```

`--since` and `--until` set the period (an age such as `30d`, or a day such as
`2026-11-01`; [filtering lists](../filtering-lists.md#times)), and `--workflow`
and `--project` narrow it; `--by` is `day`, `week`, `month`, `workflow`, `node`,
`model`, `driver` or `project`. The **Usage** panel in
[the browser view](../browser-view/panels-and-workspace.md#the-panels) shows the
same, with a chart. Both point at what is worth a look: spend on loop rounds, on
failed sessions, on one costly node, or a cold prompt cache.

A dollar total that leaves out a session on a driver with no price
(`command-code` today) is marked: `ork usage`, `ork ps` and the run summary
print it as `$1.2000 (partial)` with the counted tokens beside it
(`1.5k tokens`), the browser view as `≥ $1.20` with the tokens next to it, and a
node on such a driver shows its tokens where the cost would be. The Usage
panel's totals also show the tokens counted (input, output and cache write;
cache reads are not), and `ork usage`'s Limits line shows a token cap beside the
dollar ones. The chart stays in dollars. The two tools word "partial"
differently for now.

Token figures have one name each. **prompt** is the whole prompt (input, cache
read and cache write), what "from cache" is a share of; **out** is output; and
**counted** is what a budget spends (input, output and cache write). `ork usage`
reads `4.0k prompt / 500 out (1.5k counted)`, the Usage panel "Prompt tokens",
"Output tokens" and "Tokens counted", and `ork tree` shows only the counted
figure (`125 tok`).

A session's tokens show once it ends or is stopped: one stopped by `ork stop` or
its cap keeps the tokens its tool reported before the stop. While it runs, its
tokens are not shown yet, and if Ork itself is killed they are lost.

These are Claude Code's estimates, so on a subscription they are not your bill.
They can differ from adding up `ork ps`: usage counts `ork chat` sessions, and
counts a called workflow once.

Old runs' logs can go while what they spent stays:

```sh
ork prune --older-than 90d --dry-run   # see what would go
ork prune --older-than 90d             # asks first
```

A pruned run can no longer be read or resumed. Runs with a worktree or branch
left stay until `ork worktrees clean` deals with those. Ork never prunes on its
own.

## Saving tokens

Ork is built to keep sessions small:

- Workers start a fresh session for each task; only leaders are long-lived, and
  a leader resumes its session instead of starting over.
- Owners pass briefs, not transcripts, and children return short summaries.
- What Ork adds to the prompt is ordered so nodes share a cached prefix
  ([Skills and context](../skills-and-context.md)).
- The built-in `caveman` practice keeps chat and reports terse.
- Every loop has a `maxRounds`, so nothing runs forever.

A good start: `opus` with `high` effort for the node that plans, `sonnet` for
the ones that build, and `haiku` or `low` effort for checks and reviews. Use
`ork context explain` to see how big each node's prompt is.
