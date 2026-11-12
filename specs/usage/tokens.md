# Counted tokens, the token quota and partial totals

_Part of [Usage: what runs spent over time](../usage.md)._

Status: **Built** ([spend.ts](../../packages/core/src/usage/spend.ts),
[quota.ts](../../packages/core/src/usage/quota.ts),
[report.ts](../../packages/core/src/usage/report.ts),
[tests](../../packages/core/test/budget-tokens.test.ts),
[CLI tests](../../packages/cli/test/budget-tokens.test.ts)), except the browser
view, which is built beside it and worded differently
([L283](../gaps/budget-tokens-limits.md)). Why:
[ADR-084](../../decisions/ADR-084-budgets-and-quotas-in-tokens.md).

Every driver can be capped. Command Code reports tokens and no price, so
`budgetUsd` can't bind it; `budgetTokens` and `quotas.dayTokens` do, on any
driver. Nothing converts one unit to the other: there is no price table and no
per-model weight, so a cap in tokens and one in dollars are independent, and
whichever is reached first ends the session, the run or the day's sessions.

## Counted tokens

**Counted tokens = input + output + cache write.** Cache reads never count: in
RFC-014's probe they were about 60% of input, and they cost a fraction of the
rest. [`countedTokens`](../../packages/core/src/usage/spend.ts) is the one
definition: the session runner's cap, the run's reserves, the day quota and
every report use it. The ledger already stores the four kinds apart, so the
token quota needs no migration ([the ledger](../usage.md#the-ledger)).

A stopped session (by `ork stop` or its token cap) counts the tokens its driver
reported before the stop: they reach its `session.finished`, so the ledger,
`ork ps`, the day quota and resume's earlier spend all see them
([session ends](../runtime/session-ends.md#the-token-cap)). A running session's
tokens show only once it ends or is stopped
([gaps](../gaps/budget-tokens-limits.md)).

### Prompt, output and counted on screen

Three figures, each with one name in `ork usage`, `ork tree` and the browser UI:

- **prompt** is the whole prompt: input + cache read + cache write. It is what
  "from cache" is a share of. It is never called "in" ("in" read as uncached
  input in `ork tree` and as the whole prompt elsewhere).
- **out** is output tokens.
- **counted** is input + output + cache write, as above: what a budget spends.

`ork usage`'s totals line reads
`1 run · 1 session · 4 turns · 4.0k prompt / 500 out (1.5k counted) · 75% from cache`;
each table row, under the `TOKENS` header, reads `4.0k prompt / 500 out` with no
counted figure (the tables' width). `ork tree` shows only the counted figure,
`125 tok`, then ` · $0.0123` for a priced node (an unpriced node's `125 tok` is
its cost slot, so nothing follows). The Usage panel's totals read "Prompt
tokens", "Output tokens" and "Tokens counted"
([panels](../ui/panels-chats-notifications-and-usage.md)). The run summary's
`100 in / 20 out (80 cached)` is a different line, a session's own figures from
the driver, and keeps its words.

## Where a token cap applies

- **A session:** `budgetTokens` on a node, in `defaults` or in an agent file (a
  positive integer). The shared session runner stops it once its counted tokens
  reach the cap, and it ends `budget_limit`
  ([how it stops, driver by driver](../runtime/session-ends.md#the-token-cap)).
  The cap counts one activation, as `budgetUsd` and `maxTurns` do: a resumed
  node gets the whole cap again.
- **A run:** `limits.budgetTokens`. Each session's cap is the node's own
  (`defaults`' when the node sets none), then the least of that, what is left of
  the run's, and what is left of the day quota; it is set aside as the session
  starts, as dollars are ([budget](../scheduler.md#budget-and-concurrency),
  [ADR-077](../../decisions/ADR-077-reserve-session-caps.md)): reserves hold
  dollars and tokens side by side. A session that doesn't fit waits for a
  reserve to free, or is refused with "nothing is left of the run's tokens".
  Once spent, the run ends `budget_exhausted`, also when a session whose cap was
  the run's remainder reaches it: no failure edge fires, and `ork resume`
  continues that session ([budget](../scheduler.md#budget-and-concurrency)). A
  resumed run starts from the tokens already used.
- **A day:** `quotas.dayTokens`, below.

## The token quota

`quotas.dayTokens` sits beside `dayUsd` in `.ork/project.yaml` (this project)
and `~/.ork/settings.yaml` (every project), and is a positive integer. There is
only a day window in tokens: no `weekTokens` or `monthTokens`. What counts is
the counted tokens of the ledger's rows in the calendar day (the machine's time
zone), summed by [`tokensSince`](../../packages/core/src/store/usage.ts), so
`ork chat` and called runs count, as in dollars. Everything about
[limits across runs](../usage.md#limits-across-runs) applies: both caps are
enforced when both are set, a project's can only lower the user's, `ork run`
refuses a workflow with a session while the day's tokens are spent, the
scheduler checks before each session, a session may use no more than what is
left, and at the cap the run ends `quota_exhausted`, saying when it lifts. It
passes by what the running sessions were given ([L99](./limits.md)).

## Partial totals

A driver with no `price` capability (`command-code` today,
[drivers](../runtime/which-driver.md)) reports no dollars, so its sessions add
$0 to a dollar total. A total that leaves some out is **partial**:

- `UsageTotals` (and each group) has `tokens` and `partial`; `RunRecord` and
  `RunResult` have `tokens` and, when a session ran on an unpriced driver,
  `partial`. A report sets `partial` from each row's driver
  ([`unpriced`](../../packages/core/src/usage/spend.ts)).
- **`ork usage`, `ork ps` and the run summary** print
  `$1.2000 (partial) · 1.5k tokens`: the dollar figure, `(partial)`, and the
  counted tokens (only when partial). `ork usage`'s Limits line shows a token
  cap after the dollar caps,
  `  all projects, this day: 1.2M of 2.0M tokens, resets <time>` (`this project`
  for a project's cap), flagged when none is left. The tables of `--by` carry no
  mark ([L282](../gaps/budget-tokens-limits.md)).
- **The browser view** prefixes the total `≥ $1.20` with a tip and shows the
  counted tokens beside it (`12.3k tokens`); a node on an unpriced driver shows
  its tokens in the cost slot; the Usage panel's totals gain "Tokens counted",
  and its Limits show a meter "This project, this day, in tokens" with the note
  "Tokens counted: input, output and cache write. Cache reads are not counted."
  The chart stays in dollars ([panels](../ui/panels-runs-and-monitor.md)). The
  CLI says `(partial)` and the UI says `≥`
  ([L283](../gaps/budget-tokens-limits.md)).

## Budget warnings

`ork validate` and `ork run` read `budgetWarnings`
([driver-needs.ts](../../packages/core/src/run/driver-needs.ts)) beside the
driver-fit refusals
([graph compiler](../graph-compiler/diagnostics.md#driver-fit)), and they are
never refusals. For a session node on a driver without `price`:

- Only `budgetUsd` (its own or `defaults`') and no `budgetTokens`: "node `x`
  sets only budgetUsd, but driver `command-code` reports no dollars: only
  budgetTokens applies on command-code".
- The workflow has `limits.budgetUsd`: "node `x` runs under the workflow's
  limits.budgetUsd, but driver `command-code` reports no dollars, so that limit
  can't see its sessions".

`ork validate` prints each as a diagnostic (severity warning, code
`driver.budget`, path `nodes/<id>`); `ork run` prints `warning <message>` on
stderr and goes on. The exit code is unchanged. Declined in RFC-015: refusing a
mixed run.

The compiler adds `budget.leader`
([leader-budget.ts](../../packages/core/src/graph/leader-budget.ts),
[diagnostics](../graph-compiler/diagnostics.md)), on every driver: the workflow
has `limits.budgetTokens` (or `limits.budgetUsd`), and a leader with children
sets no cap of its own in that unit, nor does `defaults`. Its session would set
aside all that is left of the run's budget, and a leader's reserve is never
waited on ([ADR-077](../../decisions/ADR-077-reserve-session-caps.md)), so the
nodes it owns are refused. It is a warning: give the leader a cap.
