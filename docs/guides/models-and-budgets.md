# Models, effort and budgets

Every Claude node picks its own model and effort, and has its own limits, so a
planner can think hard on a large model while reviewers run fast and cheap. The
run as a whole has a hard budget.

## Model and effort

```yaml
defaults:
  model: sonnet
  effort: medium
nodes:
  planner:
    type: claude.leader
    model: opus
    effort: high
  linter:
    type: claude.worker
    parent: planner
    model: haiku
    effort: low
```

- `model`: `opus`, `sonnet`, `haiku`, or a full model id such as
  `claude-opus-5-5`.
- `effort`: how hard the model thinks, `low`, `medium`, `high`, `xhigh` or
  `max`.
- A node's own value wins, then `defaults`, then Claude Code's default for the
  model. A spawned worker (`tests-2`) takes its template's.

## Limits per node

```yaml
nodes:
  builder:
    type: claude.worker
    budgetUsd: 3 # this session's spend cap
    maxTurns: 60 # this session's turn cap
```

Both can also go in `defaults`. A session that hits a limit ends, and without a
valid report its status is `fail`, so a `when: status == 'fail'` edge can handle
it.

## Limits per run

```yaml
limits:
  budgetUsd: 20 # hard cap for the whole run
  concurrency: 2 # Claude sessions at once (default 4)
```

- Each session gets the smaller of its own budget and what is left of the run's.
  Once the run's budget is spent, no new session starts and the run ends as
  `budget_exhausted`.
- `concurrency` limits only Claude sessions; tools and gates are not limited. A
  leader waiting on its children lends them its slot.

Costs come from Claude Code's own estimate in each session's final result. The
run summary shows the total, and `--json` gives each node's usage: cost, tokens
(including cache reads and writes), turns and time.

## The driver

```yaml
defaults:
  driver: cli # or sdk (the default)
```

`driver` picks how Ork reaches Claude, per workflow or per node, and
`ork run --driver` overrides both. The two drivers behave the same; they differ
in whose login they use ([Accounts and credentials](./accounts.md)).

## Saving tokens

Ork is built to keep sessions small:

- Workers start a fresh session for each task; only leaders are long-lived, and
  a leader resumes its session instead of starting over.
- Owners pass briefs, not transcripts, and children return short summaries.
- What Ork adds to the prompt is ordered so nodes share a cached prefix
  ([Skills and context](./skills-and-context.md)).
- The built-in `caveman` practice keeps chat and reports terse.
- Every loop has a `maxRounds`, so nothing runs forever.

A good start: `opus` with `high` effort for the node that plans, `sonnet` for
the ones that build, and `haiku` or `low` effort for checks and reviews. Use
`ork context explain` to see how big each node's prompt is.
