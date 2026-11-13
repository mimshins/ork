# Due, delivery and taking them

_Part of [Follow-ups](../follow-ups.md)._

## When one comes due

A `waiting` follow-up moves to `due` by one of four ways, each leaving a `note`
saying why ([due.ts](../../packages/core/src/follow-ups/due.ts)):

- **`after-merge`** waits on its `ref`. Ork reads it through the user's own
  `gh`, in the project's folder: `gh pr view <ref> --json state` (a pull request
  by its URL, number or head branch); when that fails, the default branch is
  read (`gh repo view`) and the ref is compared with it
  (`gh api …/compare/<base>...<ref>`). Merged, or a branch the default branch
  already holds, makes it `due` ("`<ref>` merged"). **Closed without merging**
  makes it `due` too, with a note saying so ("`<ref>` was closed without
  merging; decide whether it still applies"): it is never dropped silently. A
  ref still open leaves it waiting. An `after-merge` follow-up with no `ref` yet
  waits until a run records one ([published](#taking-them-as-a-runs-brief)).
- **A date** is due on that day, in local time ("due on 2026-11-20").
- **`after-deploy`** is due only when someone says so:
  `ork follow-ups due <id>`, or for every follow-up a run left,
  `ork follow-ups due <run>`, or **Mark due** in the panel.
- **`now`** is due when added.

Each ref is read once per check, however many follow-ups wait on it. A `gh` that
is missing, not signed in or failing is **not an error**: the check reports it
(`errors`), the follow-ups wait, and the CLI, the server and the panel say
"Can't check PRs" with what to do. The CLI prints one line per call: for a `gh`
that isn't signed in (its "not logged in" or "gh auth login" text), "Can't check
PRs: `gh` isn't signed in. After-merge follow-ups stay waiting; run
`gh auth login` yourself."; for any other failure,
`Can't check PRs: <first error>. After-merge follow-ups stay waiting.` Ork reads
no token.

**When it checks.** On every `ork follow-ups` call, and on every read of a
project's list by the server; and on a schedule, every 10 minutes, while
`ork watch` runs (it prints a line for each follow-up that came due) and while
`ork ui` runs (its overview stream sends the due ones;
[surfaces](./surfaces.md#the-server)). Nothing polls when neither is running.
Ork sends no desktop notification of its own
([L304](../gaps/follow-ups-limits.md)).

## Delivery by who it is for

([deliver.ts](../../packages/core/src/follow-ups/deliver.ts)) Before anything is
kept, a follow-up is checked: a title, a `for` of one of the four forms, a `due`
Ork knows, a draft for a `message`, and text in every step. Then:

- **`agent`**: kept in this project's list. A later run takes it as its brief
  ([below](#taking-them-as-a-runs-brief)).
- **`me`**: kept in this project's list. A `task` or `check` shows its steps and
  their commands to copy; the maintainer runs them and marks it `done`. Ork
  never runs a command.
- **`person:<name>`** (a `message`): kept with its draft. Ork never sends it:
  the maintainer copies the text, sends it themselves, and marks it **sent**
  (`ork follow-ups done`). A draft whose channel is `github` and whose `to` is
  an issue or pull request URL can be **posted** through the user's `gh` as a
  comment, and only after the maintainer confirms exactly this text:
  `ork follow-ups post <id> --confirm`, or **Post to GitHub…** in the panel,
  which sends the draft's digest so a draft that changed meanwhile is refused.
  The text is scrubbed with the feedback redactor first, and the follow-up is
  `done` once `gh` printed no error. Any other channel is only drafted. A github
  draft whose `to` isn't `https://github.com/<owner>/<repo>/(issues|pull)/<n>`
  (a bare `142` or `#142` names neither the repo nor which it is) is refused
  before any `gh` runs, with the reason "its `to` isn't a GitHub issue or pull
  request URL" (`followUpActions(f).post`, the same check in
  [post.ts](../../packages/core/src/follow-ups/post.ts)); a draft can't be
  edited, so the maintainer copies that text and sends it themselves.
- **`project:<name>`**: kept in **that registered project's** list, through that
  project's own `followUps` rule, not this one's. An unknown name is refused,
  naming the registered projects. When a run of that project is **live**, the
  running agent node highest in its tree is also told, as an Ork notice (a row
  in the store and a wake on its socket, as `ork relay` does): "A follow-up for
  this project from run `<run>` … It is in this project's follow-ups; act on it
  only if it fits your task." The tool's result and `ork follow-ups add` say it
  was relayed. A follow-up that merged into one already kept is not relayed
  again.

No `follow-up.added` run event exists: the store keeps the follow-up, the
sending session's `tool.result` records the outcome, and the receiving run logs
`link.notice`.

Nothing reaches a person, or another project's session, without going through
the rules above, and nothing is sent to a person by Ork
([ADR-086](../../decisions/ADR-086-follow-ups.md)).

## Taking them as a run's brief

`ork run <workflow> --follow-ups <ids>` (ids, or unique prefixes, repeated or
comma-separated) takes open `agent` follow-ups as the run's **`brief`** input
([cli](../cli.md)). `start` is the usual workflow:
`ork run start --follow-ups 4f2a1c,9c1e07`. Each is checked before any is
marked: an unknown id, one for someone else (`me`, `project:…`, `person:…`), a
closed one, a workflow with no `brief` input, or an `--input brief=…` beside the
flag stops the run before it starts, naming each reason, and no follow-up is
changed. The brief is each title, id, body and files
([L305](../gaps/follow-ups-limits.md)).

`--follow-ups due` takes **every `agent` follow-up that is due** in the current
project, after the same due check every `ork follow-ups` call runs first (so an
`after-merge` one whose pull request merged counts). It combines with ids
(`--follow-ups due,4f2a1c`): the union, each taken once. Follow-ups for someone
else are skipped silently by `due` (named ids still refuse them), and done and
dropped ones are not due. With nothing due, the run does not start: it exits 1,
takes nothing and says on stderr that no agent follow-ups are due, naming
`ork follow-ups list`. When `gh` cannot check pull requests, `due` still takes
what is already due, with the one-line warning the due check gives.

`--follow-ups` with no value (`--follow-ups`, `--follow-ups ""`,
`--follow-ups=`, or a next argument that starts with `--`) exits 1 before the
workflow loads: "`--follow-ups` needs follow-up ids, or `due` for every due
agent follow-up. `ork follow-ups list` shows them." It never reaches the
"missing required input brief" error
([code](../../packages/cli/src/follow-ups/brief.ts),
[tests](../../packages/cli/test/follow-ups-run.test.ts)).

The run is recorded as each follow-up's `takenBy`. A run that **publishes**
tells Ork so with `ork follow-ups published <ref>` (called by `build`'s
`published` step, with `ORK_RUN` set): the open follow-ups that run left without
a `ref` now wait on `<ref>`, and the `agent` follow-ups it took become `done`
("done by run `<run>`, published as `<ref>`"). A resumed run keeps its brief;
the flag is for a new run.
