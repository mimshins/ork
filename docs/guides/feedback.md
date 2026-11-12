# Feedback from your runs

Every run teaches something: a loop that kept running out of rounds, a tool you
kept denying, a brief that left an agent guessing. Ork notes these as it goes,
on your machine only, and groups them so you can see what keeps happening and
fix it at the source.

## Where it comes from

- **Ork itself**, from the run's own events, with no model call: a loop out of
  rounds, a run out of budget, a tool you denied, an Ork tool that failed, a
  gate that timed out, and an answer you gave that was not the one recommended.
- **A node's end**, filed by who should act
  ([why a node stopped](./why-a-node-stopped.md)): `unknown` and
  `driver_crashed` are Ork bugs, a workflow kind a workflow note, an agent kind
  a context gap; an account's, provider's or your own stop is a setup hint, not
  filed. A report the `report` tool refuses is the agent's context gap
  (`report.rejected`), not an Ork bug.
- **The agents**, with the `feedback` tool every agent node in a run gets. Its
  description asks only for what materially got in the way, in a line and a
  short body, and Ork takes at most 3 reports from a session.

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
([answering questions](./running-workflows/running-and-answering.md#answering-questions)).

Records about the same thing, from any run of any project, form one **item**, so
`list` stays short: each line has the item's id, how many times it was seen,
what it is about, and when it was last seen. `show` adds the runs, workflows and
models it came from, and each record's details. An item is named by its id or
the first few characters of it. A dismissed item stays dismissed when it happens
again; `list --status all` still shows it.

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

## Turning one into a lesson

When an item is something a workflow should simply know, accept it as a
**lesson**:

```sh
ork feedback accept 9fae0 --lesson -m "The spec is at nodes.spec.output.artifacts.spec."
```

Ork adds it as one line to `.ork/lessons/<workflow>.md` in the item's project,
and every later session of that workflow reads it, in the workflow layer of its
context. Without `-m`, the lesson is the item's title. The file is yours: commit
it, edit it, take a lesson out. If the item was seen in more than one workflow,
say which with `--workflow`. Without `--lesson`, `accept` only marks the item
accepted.

What you can do with an item depends on where it stands, the same in a terminal
and in the browser:

- A dismissed item takes nothing until you `restore` it.
- `accept` works only on a new or triaged item; a lesson can still be added to
  one already accepted, resolved or published.
- An item is published once, and has one `apply` at a time.

A workflow's lessons file is held to 1,500 tokens, as lessons cost tokens in
every session: accepting one that would pass that is refused, and a longer file
is cut there. `ork context explain <workflow> <node>` says when. Feedback about
Ork itself is never a lesson.

## Asking for a fix

When the fix belongs in the project, a line in `AGENTS.md`, a brief in a
workflow, a skill, ask Ork to propose it:

```sh
ork feedback apply 9fae0
```

This runs Ork's own workflow, `ork:feedback-apply`, in the project the item came
from (Ork names it before it starts), like any run you start: you see its
transcript, and it shows in `ork ps`, the Monitor and the Decisions panel.

A worker reads the item and that project's records of it, makes the smallest
change that would stop it happening, and Ork commits it on its own branch in a
worktree. Feedback is model output, and what a repository's sessions wrote can
try to steer the worker, so the worker can only read and edit files; it runs no
commands.

Then you're asked: **keep** or **discard**. The question shows what the branch
changes (`git diff --stat`) and the command to read the whole of it. **Read the
diff before you keep it**: the worker's own account of it comes last, and is
only its claim.

- **Keep:** the branch stays, and the item is resolved. Review and merge it like
  any other change: Ork never merges it. If the branch holds no new commits,
  there's nothing to keep: Ork removes it and its worktree, and the item stays
  accepted.
- **Discard:** the branch and its worktree are removed, and the item stays
  accepted.

If the worker finds nothing to change, it says why and the item stays accepted.
Feedback about Ork itself has no fix in your project, and an item already
resolved, published or dismissed isn't applied again.

## Sharing feedback about Ork

When an item is about Ork itself (a tool that failed, a bug in the engine), you
can share it with Ork's maintainers:

```sh
ork feedback publish 0893f
```

Ork takes out what shouldn't leave your machine: secrets, your projects' paths
(`<project>/…`) and your home folder (`~`), emails, host names and IP addresses;
`--hide-names` takes out your workflows' and folders' names too. It adds what
the problem was seen with (Ork's version, the driver, model and node type) and
how often, and looks, with your own `gh`, for a thread about the same item in
the "Agent feedback" category of Ork's Discussions. Then it shows you exactly
what it would post (a new thread, or a "+1" on the one there) and asks. Nothing
is sent unless you say `y`, and there is no flag to skip the question. It needs
a terminal, and `gh auth login` done by you.

To share feedback another way, between your machines or a team, move it as JSON
lines:

```sh
ork feedback export -o feedback.jsonl     # add --all for dismissed items too
ork feedback import feedback.jsonl        # skips what's already here
```

## In the browser

`ork ui`'s **Feedback** panel does the same, beside your runs. It lists every
item (Status shows the dismissed ones too, About narrows to `ork`, `workflow` or
`project`), and an item you choose shows its facts, its records newest first
with the way to each run, and what you can do with it; a button that doesn't
apply says why.

- **Add lesson…** shows the lessons file and how full it is before anything is
  written, and asks which workflow when there's more than one.
- **Propose fix…** names the project, asks before it starts the run (with a
  choice of driver) and takes you to it in the Monitor; keep or discard it in
  Decisions.
- **Publish…** shows exactly what would be posted, as text, and posts only when
  you press **Post**. If what it would send changed since you read it, it shows
  you the new text instead.

To note how a run or node went, use **Note…** in the Monitor.

## What stays on your machine

Feedback lives in `~/.ork/state.db` with your runs, with secrets masked before
anything is written. Nothing is sent anywhere unless you publish an item, and
then only what you read and confirmed
([where Ork keeps things](./where-ork-keeps-things.md)). For the full rules:
[feedback and self-improvement](../../specs/feedback.md).
