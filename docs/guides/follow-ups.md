# Follow-ups

A change that merges leaves work behind, and not only code: a message to a
partner, a note for an agent working in another project on your machine, infra
only you can do, a check after deploy. A **follow-up** is Ork's note of that
work. It says who acts, what kind of work it is and when it is due; Ork keeps it
where your project says, tells you when it comes due, and brings the code ones
back as a later run's brief.

Follow-ups are about your product. They are not [feedback](./feedback.md), which
is about how Ork and your workflows did, and they never appear there.

## An example

`se-backend` changes its webhook. When the pull request is ready, the run left
four follow-ups:

```sh
ork follow-ups list
```

```
Due (1)
  for me
    5a6b7c22  task    Move the webhook secret to the new vault (now)

Waiting (3)
  for agent
    6b7c8d33  change  Add retries to the billing client (after-merge #142)
  for person:acme-ops
    4f2a1c11  message Tell Acme the webhook moved (after-merge #142)
  for project:se-frontend
    7c8d9e44  change  Update the SDK's webhook types (after-merge #142)
```

- **A message to a partner** (`for: person:acme-ops`). Ork drafts it; you send
  it.
- **Work for another project's agent** (`for: project:se-frontend`). Ork put it
  in `se-frontend`'s list, and, when a run of `se-frontend` was live, told its
  session.
- **Infra steps** only you can do (`for: me`), with the commands to copy.
- **A change for a later run** (`for: agent`).

When the pull request merges, the `after-merge` ones become **due**. `ork watch`
says so while it runs, `ork ui` shows a count on the Follow-ups tab, and any
`ork follow-ups` call checks first.

## What one holds

| Part    | Says                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------- |
| `for`   | Who acts: `agent` (a later run), `me`, `project:<name>` (a registered project) or `person:<name>`. |
| `kind`  | `change`, `message`, `task` or `check`.                                                            |
| `due`   | `now`, `after-merge`, `after-deploy` or a date (`2026-11-20`).                                     |
| status  | `waiting`, `due`, `done` or `dropped`. `done` on a message means you sent it.                      |
| a draft | For a message: who it is to, a channel hint (`slack`, `email`, `github`) and the text.             |
| steps   | For a task or check: what to do, in order, with commands to copy.                                  |

Every follow-up has an id; the first six characters are enough (`4f2a1c`).

## Reading and closing them

```sh
ork follow-ups list            # due first, then waiting; --status all adds done and dropped
ork follow-ups show 4f2a1c     # one whole, with its draft or its steps to copy
ork follow-ups done 4f2a1c     # a message: you sent it. Use drop when it no longer applies
ork follow-ups reopen 4f2a1c   # bring a done or dropped one back
```

`list` takes `--for agent` (or `me`, `project:se-frontend`), `--status`,
`--kind`, `--due`, `--project`, `--ids`, `--limit` and `--json`
([filtering lists](./filtering-lists.md)). In the browser view, the
**Follow-ups** panel does the same: the list by due and by who it is for,
filters, the draft with **Copy message**, each command with a copy button, and
**Mark due**, **Mark done** or **Mark sent**, **Drop** and **Reopen**. Each
button names the command it stands for.

### A message for a person

Ork never sends a message to a person. Open it with `show`, copy the text, send
it yourself, then `ork follow-ups done 4f2a1c`. If its channel is `github` and
its `to` is an issue or a pull request URL
(`https://github.com/<owner>/<repo>/(issues|pull)/<n>`), Ork can post it as a
comment with your own `gh`, once you confirm:

```sh
ork follow-ups post 4f2a1c            # shows what it would post, and where
ork follow-ups post 4f2a1c --confirm  # posts it, and marks it sent
```

`post --confirm` posts the draft **as stored when you run it**, not what an
earlier `post` printed, so `ork follow-ups show 4f2a1c` it first. The panel's
**Post to GitHub…** posts exactly the text it shows and refuses a changed draft.

### Steps and checks

A task shows its steps and commands. **Ork never runs them**: copy each command,
run it yourself, then mark the follow-up done.

### Another project's agent

A follow-up `for: project:se-frontend` goes into that registered project's list,
under its own [rule](./project-rules.md#where-follow-ups-are-kept). If a run of
`se-frontend` is live, its leading agent node is also told, as a notice, and
acts on it only if it fits its task. An unknown project is refused, with the
names of the registered ones
([working across projects](./working-across-projects.md)).

## Having an agent do one

An `agent` follow-up is a change for a later run. Take it as the brief:

```sh
ork run start --follow-ups 6b7c8d,9c1e07
```

Each id is checked first: one that isn't an `agent` follow-up, or is closed,
stops the run and changes nothing. The run is recorded as the one that took them
(`show` and `list` say `taken by` which), and they are done when it publishes.
`--follow-ups` fills the workflow's `brief` input, so the workflow needs one:
`start` and `plan` have it, a fresh `ork init` project has none. One that a run
still going has taken is refused ("taken by run 3f9a, still running"), and `due`
skips it; one a finished, failed or crashed run took can be taken again.

To take every agent follow-up due in this project, use
`ork run start --follow-ups due`. It checks pull requests first, as
`ork follow-ups list` does, and skips follow-ups for someone else. With nothing
due, the run does not start (with `--detach` too). Mix it with ids
(`--follow-ups due,6b7c8d`): each is taken once. A bare `--follow-ups` says it
needs ids or `due`. Tab after it offers `due` and the open agent follow-ups with
their titles ([tab completion](./tab-completion.md)).

## When one comes due

- **`after-merge`** waits on the pull request or branch the run published. Ork
  reads it with your own `gh`: merged, or a branch already in the default
  branch, makes it due. A pull request **closed without merging** makes it due
  too, with a note saying so, so it is never dropped quietly.
- **A date** is due that day.
- **`after-deploy`** is due when you say so: `ork follow-ups due 5a6b7c22`, or
  `ork follow-ups due <run>` for everything a run left.

If `gh` isn't signed in, the follow-ups simply wait, and the command (one line
per call), the panel and `ork ui` say "Can't check PRs", with `gh auth login` to
fix it; any other `gh` failure is named in the same line. Ork checks on every
`ork follow-ups` call, every 10 minutes while `ork watch` or `ork ui` runs, and
never otherwise. It does not send a desktop notification.

## Adding one yourself

```sh
ork follow-ups add "Rotate the Acme API key" --for me --due after-deploy \
  --step "Create the new key :: acme keys create --env prod" \
  --step "Update the vault"
ork follow-ups add "Tell Dana the API moved" --for person:Dana --channel slack \
  --text "The API moved to v2; the old one stops on the 20th."
```

A message needs `--text` (its draft), and `--to` says who it is to (default: the
person). For `--channel github`, `--to` is the issue or pull request URL, and
`add` refuses one without it. `--step` is `text` or `text :: command`, and a
step needs its text. Without `--kind`, a person's is a message, an agent's or a
project's a change, and the rest a task.

## What Ork keeps, and where

Ork's own store keeps every follow-up, per project, on your machine; it is never
committed. Your project's
[`followUps` rule](./project-rules.md#where-follow-ups-are-kept) also writes
each one to a **file** in the repository or a **GitHub issue**.

> **A `file` lives in your repository.** What a session writes before the change
> is published is committed with it; what `build` records after the publish is
> left in the worktree to commit. In a public repository it is public: don't use
> it for what only you should read. The same holds for the issues a `github`
> store creates in a public repository.

The text of every follow-up, from a session or added by hand, is scrubbed first
with the same redactor feedback uses (secrets, paths, emails and hosts; a secret
in your `env:` too), so an address or a host in a draft or a command may be
taken out; check a draft before you send it. Ork stores no credential: `gh` is
your own login ([accounts](./accounts.md)).

## In `build`

When review passes, the `build` workflow reads the notes and what no one
checked, and asks you once what to do with the follow-ups it found: take its
recommendation, defer them all, or choose each. It does the small agent ones in
one more round, with a review of that round, and records the rest once the
change is published, with the pull request they wait on. Nothing is deferred,
dropped or sent without your choice. A plan's `Follow-ups` section lists the
ones you already know. What the run learned that isn't work goes into the specs
and memories, not here.

## Limits

Closing a follow-up changes Ork's store only: a `file` entry isn't rewritten, a
`github` issue isn't closed, and an issue you close yourself isn't noticed. The
panel reads and closes follow-ups; adding one is `ork follow-ups add`. The
[limits](../../specs/gaps/follow-ups-limits.md) list the rest.
