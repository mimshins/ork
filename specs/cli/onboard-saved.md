# A saved proposal

_Part of [`ork onboard`](./onboard.md)._

Status: **Built**.

`ork onboard` keeps nothing of its own between visits: the proposal a person
left at the pick, or a propose run that did not finish, is found in the store
(`packages/cli/src/onboard/saved.ts`). After the survey and the mode line, and
before any question, the command looks for the newest `ork:onboard-propose` run
of this project (a built-in run recorded under its root, matched by its name and
the `.ork/runs/.builtin/` path, so a user's workflow of the same name never
matches) that no `ork:onboard-write` run followed. The newest such run decides,
so an older one is never offered over it. If it succeeded, it is offered, with
its age and id:

```
A proposal from <age> is saved (run <id>); it was read from the files as they were then.
Use it, and skip the questions and the proposing run? Writing then costs at most <write cap>. [y/N]
```

- **Yes** skips the questions, the cost preview and the paid propose run. The
  `survey` and `answers` are the ones the run started with (its `run.started`
  inputs, stored with secrets masked as every event is); the suggestions are the
  `propose` node's output in its result, checked again by
  [the filter](./onboard-verbs.md#the-filter) against the files as they are now,
  so a suggestion whose evidence is gone is dropped and shown with its reason.
  The pick and the write run go on as in
  [the flow](./onboard-flow.md#proposing-and-picking). The write cap is the one
  the question names; there is no second "Start?".
- **No**, or `--fresh`, starts as a visit with no saved proposal: the questions,
  the preview, a new propose run.
- Ctrl-C at the offer stops with exit 130.

Nothing is offered when there is no such run, a write run (of any outcome)
started after it, the project is another one, or no suggestion survives today's
checks. No file, state or event type is added for this.

## An unfinished proposal

When the newest propose run did not succeed, the command offers to resume it,
but only if `ork resume` would accept it (`resumable` in `@krapht/ork-core`) and
its stored `survey` and `answers` are text. A run that is still running (a
paused run whose process is alive counts), one `resumable` refuses, one of
another project, a user's workflow of the same name, and one a write run
followed are not offered. A run that used its budget (`budget_exhausted`) is not
offered either: a resumed run's budget counts what it already spent, and the
built-in's caps cannot be raised, so it would stop at once. The status shown is
the one the store shows (`failed`, `interrupted`, `crashed` and so on). When the
newest run is unfinished but not offered, nothing is offered, even if an older
run succeeded.

```
An unfinished proposal from <age> (run <id>, <status>) can be resumed.
Resume it, and skip the questions? Spent so far <spent>; it can spend up to <propose cap> in total. [y/N]
```

- **Yes** skips the questions and the preview and resumes that same run (no new
  propose run), as `ork resume <run>` does, with the driver picked now and the
  built-in workflow of the Ork installed now. The `survey` and `answers` are the
  stored ones, masked as stored, and stay untrusted. When it succeeds the flow
  goes to [the pick](./onboard-flow.md#proposing-and-picking) with its
  suggestions checked again by [the filter](./onboard-verbs.md#the-filter); when
  it does not, the command stops with the run's failure lines and exit 1, as a
  new propose run does.
- **No**, or `--fresh`, starts as a visit with the questions, the preview and a
  new run. Ctrl-C at the offer stops with exit 130.

A crash inside the survey or the three questions leaves no run, so that part
starts again ([L391](../gaps/onboard-limits.md)). Nothing is stored beyond the
resumed run's own events.
