# Models, effort and limits

_Part of [Models, effort and budgets](../models-and-budgets.md)._

## Model and effort

```yaml
defaults:
  model: claude-code.sonnet
  effort: medium
nodes:
  planner:
    type: agent.leader
    model: claude-code.opus
    effort: high
  linter:
    type: agent.worker
    parent: planner
    model: claude-code.haiku
    effort: low
```

- `model`: `opus`, `sonnet`, `haiku`, or a full model id such as
  `claude-opus-5-5`; prefix a driver (`claude-code.opus`) to pin the tool
  ([drivers](../drivers.md#naming-the-driver-in-the-model)).
- `effort`: how hard it thinks: `low`, `medium`, `high`, `xhigh` or `max`.
- A node's own value wins, then `defaults`, then Claude Code's default for the
  model. A spawned worker (`tests-2`) takes its template's.

## Limits per node

```yaml
nodes:
  builder:
    type: agent.worker
    budgetUsd: 3 # this session's spend cap, in dollars
    budgetTokens: 400000 # ...or in tokens, on any driver
    maxTurns: 60 # this session's turn cap
```

All three can also go in `defaults` (and in an [agent file](../agents.md)). A
session that hits a limit ends, and without a valid report its status is `fail`,
so a `when: status == 'fail'` edge can handle it. `budgetUsd` and `budgetTokens`
are independent: set both and whichever is reached first ends the session
([budgets in tokens](#budgets-in-tokens)).

## Limits per run

```yaml
limits:
  budgetUsd: 20 # hard cap for the whole run, in dollars
  budgetTokens: 2000000 # ...or in tokens
  concurrency: 2 # Claude sessions at once (default 4)
```

- Each session gets the smaller of its own budget and what is left of the run's,
  less what sessions running beside it were given, and with none left waits for
  one to finish. A session that doesn't fit is refused ("nothing is left of the
  run's tokens", or dollars). Once the budget is spent, no new session starts
  and the run ends as `budget_exhausted`, also when a session reaches the run's
  budget mid-way: no `when: status == 'fail'` edge fires, and `ork resume`
  continues that session. Dollars and tokens are set aside side by side, each
  against its own limit, and `ork resume` goes on from what was already used.
- **Give a leader a cap of its own.** A leader with none sets aside all that is
  left of the run's budget as it starts, and holds it while it delegates, so the
  nodes it owns are refused. `ork validate` and `ork run` warn about it
  (`budget.leader`).
- A `workflow.call` shares this budget with the run it starts
  ([calling a workflow](../working-across-projects.md#calling-a-workflow)).
- `concurrency` limits only Claude sessions; tools and gates are not limited. A
  leader waiting on its children lends them its slot. It counts this run's
  sessions only: two runs at the default can hold 8. To cap spending across
  runs, use [quotas](./across-runs-and-time.md#limits-across-runs).

Costs come from Claude Code's own estimate, reported at the end of each turn and
in each session's final result. The run summary shows the total, and `--json`
gives each node's usage: cost, input, output, cache-read and cache-write tokens
apart, turns and time; the run's `tokens` is the counted total (input, output
and cache write). To see them over time, see
[what you spent](./driver-and-usage.md#what-you-spent).

## Budgets in tokens

Not every tool reports a price: Command Code reports tokens and no dollars, so
`budgetUsd` can't stop it. `budgetTokens` works on every driver:

```yaml
defaults:
  budgetTokens: 400000 # each session
limits:
  budgetTokens: 3000000 # the whole run
```

- **What counts:** input, output and cache-write tokens. Cache reads never
  count: they are most of what a long session reads, and cost a fraction.
- **A session stops** once its counted tokens reach the cap, and ends as
  `budget_limit` ([why a node stopped](../why-a-node-stopped.md#budget-limit)).
  Ork checks at each usage report the tool prints, so a session can pass the cap
  by up to one step: a model response on `claude-code`, a step on `open-code`, a
  model request on `command-code`. A report the node had already handed in still
  decides how it ended.
- **A run's** `limits.budgetTokens` sets each session's cap aside, as the
  dollars do. A node's own cap wins over `defaults.budgetTokens`, then the
  smaller of that and what is left of the run's applies.
- **Caps are per activation.** A node's `budgetUsd`, `budgetTokens` and
  `maxTurns` count one activation: raise one, then `ork resume`, and the node
  gets the whole new cap. Only the run's spend carries over.
- **Tokens and dollars never convert.** There is no price table: a cap in one
  does not stop the other, and whichever is reached first ends the session or
  the run. Claude Code's own dollar cap stays in force on `claude-code`.
- **A stopped session keeps its tokens** (by its token cap or `ork stop`): the
  ones the tool reported before the stop count toward the run, the day quota and
  `ork usage`. **Its dollars read $0** on `claude-code` and `command-code`,
  which print a cost only when they finish, so a dollar limit under-counts it. A
  session whose tool crashed records nothing.
- **On a driver with no price** (`command-code` today), a node with only
  `budgetUsd`, or under a `limits.budgetUsd` it can't see, is not refused.
  `ork validate` and `ork run` warn: "only budgetTokens applies on
  command-code". Add `budgetTokens`. A run that mixes priced and unpriced
  drivers shows its dollar total as partial, with tokens beside it
  ([what you spent](./driver-and-usage.md#what-you-spent)).
