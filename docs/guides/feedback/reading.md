# Where feedback comes from, and how to read it

_Part of [Feedback from your runs](../feedback.md)._

## Where it comes from

- **Ork itself**, from the run's own events, with no model call: a loop out of
  rounds, a run out of budget, a tool you denied, an Ork tool that failed, a
  gate that timed out, an answer you gave that was not the one recommended, and
  a shell rule you keep allowing (`permission.suggest`: the same rule allowed 3
  times across 2 runs and not yet in your `permissions.allow`; it names the rule
  and the file to add it to, and Ork writes nothing
  ([permissions](../permissions.md#rules-ork-suggests))).
- **A node's end**, filed by who should act
  ([why a node stopped](../why-a-node-stopped.md)): `unknown` and
  `driver_crashed` are Ork bugs, a workflow kind a workflow note, an agent kind
  a context gap; an account's, provider's or your own stop is a setup hint, not
  filed. A report or arguments an Ork tool refuses are the agent's context gap
  (`report.rejected`, `tool.arguments`), not an Ork bug.
- **The agents**, with the `feedback` tool every agent node in a run gets. Its
  description asks only for what materially got in the way, in a line and a
  short body, and Ork takes at most 3 reports from a session.

When an Ork tool (`extract`, `follow_up`, …) refuses a call's arguments or
fails, the record says why: the first line of the tool's own message, at most
300 characters, with secrets and your `env:` values masked. It is titled by the
tool (`Ork's extract tool refused a call's arguments`), so every node that hits
the same refusal adds to one item instead of making its own. Only Ork's tools
are recorded this way: what Bash, Read or another tool printed is never kept,
and a run keeps the first message per tool, so `ork feedback show` lists the
runs that hit it. If the same refusal keeps recurring, the node's prompt or
context may need an example of that call.

Each one shows in the transcript as it happens:

```
reviews │ ✎ feedback (workflow, workflow): The loop reviews -> lead ran out of its 2 rounds
build   │ ✎ feedback (project, context-gap): AGENTS.md has no test command
```

and in `ork logs` beside what caused it. The pair in brackets is what it's
about, then what kind it is. What it is about decides who should act on it:
`ork` (the harness), `workflow` (its briefs, models, budgets and loops) or
`project` (`AGENTS.md`, `CLAUDE.md`, skills, docs).

## Reading it

```sh
ork feedback list            # items, most recently seen first (filters: --kind, --severity, …)
ork feedback show 9fae0      # one item and every record of it
ork feedback dismiss 9fae0   # done with it: it leaves the list (restore brings it back)
ork feedback resolve 9fae0   # fixed by hand: it leaves the list, and opens again if it recurs
ork feedback note 3f2a check -m "Missed the failing test" --rating bad
```

`ork feedback note` also takes `--kind` (`friction` by default, `bug`, …) and
`--severity` (`low`, `medium`, `high`). When you answer a question, you can note
how that node did in the same breath:

```sh
ork decide --id d1 --choose hold --note "The summary hid the failing test" --rating bad
```

That note is feedback, and the run never reads it; to tell the run something
with your answer, use `--say`
([answering questions](../running-workflows/running-and-answering.md#answering-questions)).

Records about the same thing, from any run of any project, form one **item**, so
`list` stays short: each line has the item's id, its count, what it is about,
and when it was last seen. `show` adds the runs, workflows and models, and each
record. An item is named by its id or its first few characters. A dismissed item
stays dismissed when it recurs; a resolved one opens again.

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

A merged item lists under the one seen first, with its count; later records go
there too. No model runs. Every item looked at becomes `triaged`, so a declined
merge isn't offered again until a new item joins it. `ork feedback split <item>`
undoes a merge. On a terminal it asks Yes/No (`--plain`: `[y/N]`).
