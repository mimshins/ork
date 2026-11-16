# `ork onboard`

_Part of [The ork CLI](../cli.md)._

Status: **Built** ([RFC-018](../../rfcs/archived/RFC-018-onboard.md), Option B;
[ADR-097](../../decisions/ADR-097-onboarding-workflows.md)). What is not settled
is in [the limits](../gaps/onboard-limits.md); the first paid trial on the three
drivers is a follow-up.

`ork onboard` is a forward-deployed engineer built into Ork. It reads the
project, asks what hurts, proposes workflows that fit, writes the ones the user
picks on a branch, and ends at a gate that shows the diff. Run again in a
project that has workflows and runs, it reviews what the runs showed and may
change an existing workflow.

The command does the free steps itself (preconditions, `ork init`'s file steps,
the driver, a survey of the repository, the questions, a digest of past runs,
the cost preview) and runs two workflows Ork ships between them,
`ork:onboard-propose` and `ork:onboard-write`, on whichever of the three drivers
is ready. Each paid step has its own cap, and Ork never merges.

```
ork onboard [--driver <id>] [--review | --fresh]
```

- `--driver <id>`: the driver both built-in runs use; skips the question.
- `--review`: review mode even when the project holds nothing to review.
- `--fresh`: first-visit mode even when it does. With `--review`, refused.
- The global `--plain` applies, as everywhere ([terminal](./terminal.md)).

`ork onboard` needs a terminal: it asks, and it has no flags for the answers or
the picks.

## Contents

- [The flow](./onboard-flow.md)
  - [Refusals](./onboard-flow.md#refusals)
  - [Setting up](./onboard-flow.md#setting-up)
  - [The driver](./onboard-flow.md#the-driver)
  - [The survey](./onboard-flow.md#the-survey)
  - [Mode](./onboard-flow.md#mode)
  - [The history digest](./onboard-flow.md#the-history-digest)
  - [The questions](./onboard-flow.md#the-questions)
  - [The cost preview](./onboard-flow.md#the-cost-preview)
  - [Proposing and picking](./onboard-flow.md#proposing-and-picking)
  - [Writing and the gate](./onboard-flow.md#writing-and-the-gate)
  - [Errors](./onboard-flow.md#errors)
- [Built-ins, verbs and trust](./onboard-verbs.md)
  - [The two built-in workflows](./onboard-verbs.md#the-two-built-in-workflows)
  - [Suggestions](./onboard-verbs.md#suggestions)
  - [ork \_\_onboard](./onboard-verbs.md#ork-__onboard)
    - [format](./onboard-verbs.md#format)
    - [canon](./onboard-verbs.md#canon)
    - [filter](./onboard-verbs.md#filter)
    - [finish](./onboard-verbs.md#finish)
  - [Trust model](./onboard-verbs.md#trust-model)
  - [What each driver adds](./onboard-verbs.md#what-each-driver-adds)
- [Limits found building `ork onboard`](../gaps/onboard-limits.md)
