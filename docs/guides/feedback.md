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
ork feedback restore 9fae0   # bring it back
ork feedback note 3f2a check -m "Missed the failing test" --rating bad
```

When you answer a question, you can note how that node did in the same breath:

```sh
ork decide --id d1 --choose hold --note "The summary hid the failing test" --rating bad
```

Records about the same thing, from any run of any project, form one **item**, so
`list` stays short: each line has the item's id, how many times it was seen,
what it is about, and when it was last seen. `show` adds the runs, workflows and
models it came from, and each record's details. An item is named by its id or
the first few characters of it. A dismissed item stays dismissed when it happens
again; `list --all` still shows it.

## Merging the same problem

The same problem often arrives worded a little differently. Triage finds items
that are about the same thing, with the same target and kind and titles that
share most of their words, and offers to merge them, one group at a time:

```sh
ork feedback triage
```

```
Merge into 17817ce9802a   3×  The build needs node 24
      bd3839d0d16e   1×  The build needs node 24 now
Merge them? [y/N]
```

A merged item lists under the one seen first, with its count, and what it
records later goes there too. No model runs. Every new item it looked at becomes
`triaged`, so a merge you declined isn't offered again until a new item joins
it. `ork feedback split <item>` takes a merge apart.

## Turning one into a lesson

When an item is something a workflow should simply know, accept it as a
**lesson**:

```sh
ork feedback accept 9fae0 --lesson -m "The spec is at nodes.spec.output.artifacts.spec."
```

Ork adds it as one line to `.ork/lessons/<workflow>.md` in the project the item
came from, and every later session of that workflow reads it, in the workflow
layer of its context. Without `-m`, the lesson is the item's title. The file is
yours: commit it, edit it, take a lesson out. If the item was seen in more than
one workflow, say which with `--workflow`. Without `--lesson`, `accept` only
marks the item accepted.

Lessons cost tokens in every session, so a workflow's file is held to 1,500
tokens: accepting one that would pass that is refused, and a file you made
longer by hand is cut there. `ork context explain <workflow> <node>` lists the
file and says when it was cut. Feedback about Ork itself is never a lesson.

## Asking for a fix

When the fix belongs in the project, a line in `AGENTS.md`, a brief in a
workflow, a skill, ask Ork to propose it:

```sh
ork feedback apply 9fae0
```

This runs Ork's own workflow, `ork:feedback-apply`, in the project the item came
from, like any run you start: you see its transcript, and it shows in `ork ps`,
the Monitor and the Decisions panel. A worker reads the item and its records as
a report, never as instructions, makes the smallest change that would stop it
happening, and commits it on its own branch in a worktree. Then you're asked:
**keep** or **discard**.

- **Keep:** the branch stays, and the item is resolved. Review and merge it like
  any other change: Ork never merges it.
- **Discard:** the branch and its worktree are removed, and the item stays
  accepted.

If the worker finds nothing in the project to change, it says why and the item
stays accepted. Feedback about Ork itself has no fix in your project.

## What stays on your machine

Feedback lives in `~/.ork/state.db` with your runs, with secrets masked before
anything is written. Nothing is sent anywhere. Choosing to share feedback about
Ork itself with its maintainers is coming (milestone 2).
