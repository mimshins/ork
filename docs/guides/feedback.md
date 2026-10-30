# Feedback from your runs

Every run teaches something: a loop that kept running out of rounds, a tool you
kept denying, a brief that left an agent guessing. Ork notes these as it goes,
on your machine only, and groups them so you can see what keeps happening and
fix it at the source.

Contract details: [Feedback and self-improvement](../../specs/feedback.md).

## Where it comes from

- **Ork itself**, from the run's own events, with no model call: a loop out of
  rounds, a run out of budget, a tool you denied, an Ork tool that failed, a
  gate that timed out, and an answer you gave that was not the one recommended.
- **The agents**, with the `feedback` tool every Claude node in a run gets. Its
  description asks only for what materially got in the way, in a line and a
  short body, and Ork takes at most 3 reports from a session.

Each one shows in the transcript as it happens:

```
reviews │ ✎ feedback (workflow, workflow): The loop reviews -> lead ran out of its 2 rounds
build   │ ✎ feedback (project, context-gap): AGENTS.md has no test command
```

and in `ork logs` beside what caused it. What it is about decides who should act
on it: `ork` (the harness), `workflow` (its briefs, models, budgets and loops)
or `project` (`AGENTS.md`, `CLAUDE.md`, skills, docs).

## Reading it

```sh
ork feedback list            # items, most recently seen first
ork feedback show 9fae0      # one item and every record of it
ork feedback dismiss 9fae0   # done with it: it leaves the list
```

Records about the same thing, from any run of any project, form one **item**, so
`list` stays short: each line has the item's id, how many times it was seen,
what it is about, and when it was last seen. `show` adds the runs, workflows and
models it came from, and each record's details. An item is named by its id or
the first few characters of it. A dismissed item stays dismissed when it happens
again; `list --all` still shows it.

## What stays on your machine

Feedback lives in `~/.ork/state.db` with your runs, with secrets masked before
anything is written. Nothing is sent anywhere. Turning items into fixes and
lessons, and choosing to share feedback about Ork itself with its maintainers,
come with the UI (milestone 2).
