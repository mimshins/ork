# Where you reach them

_Part of [Follow-ups](../follow-ups.md)._

## The CLI

([command](../../packages/cli/src/commands/follow-ups.ts),
[tests](../../packages/cli/test/follow-ups-command.test.ts)) The project is the
one you are in, or `--project <id>`. Every call first runs the due check; a `gh`
that fails only warns on stderr. `list` filters as every list does
([list filters](../cli/list-filters.md)).

```
ork follow-ups list [--status s|all] [--for <for>] [--kind k] [--due d] [--project p|all]
                    [--limit n] [--ids] [--json]      # due first, then waiting; grouped by who it is for
ork follow-ups show <id> [--json]                     # one whole: its draft and its steps, to copy
ork follow-ups add <title> [--for …] [--kind …] [--due …] [--body …] [--where <file>]… [--ref …]
                   [--to … --channel … --text …] [--step "text :: command"]… [--json]
ork follow-ups done <id> | drop <id> | reopen <id>    # done on a message means sent
ork follow-ups due <id|run>                           # a waiting one, or all of a run's, due now
ork follow-ups post <id> [--confirm]                  # a github-channel draft, as a comment, only with --confirm
ork follow-ups published <ref>                        # inside a run: what it left now waits on <ref>
```

- **Ids** are prefixes: a unique one is enough. An unknown or ambiguous one says
  so and names the candidates.
- **`add`** defaults to `--for me`, `--due now`, and a kind by `--for`
  (`message` for a person, `change` for an agent or a project, `task`
  otherwise). `--text` with `--to` (default: the person's name) makes a
  message's draft, and a message without `--text` is refused ("a message needs
  --text"). With `--channel github`, `--to` must be an issue or pull request URL
  and has no default. Each `--step` is `text` or `text :: command`, and a step
  without text is refused. A follow-up for another project goes to that project
  and, when a run is live there, to its session.
- **`list`** with no flags shows the `due` and `waiting` ones, grouped by status
  (due, then waiting), then by who it is for. `--status` takes `due`, `waiting`,
  `done`, `dropped` or `all` and shows what it names (`--status all` adds the
  done and dropped ones); `--for` takes `agent`, `me`, `project:<name>` or
  `person:<name>`; `--kind` `change`, `message`, `task` or `check`; `--due`
  `now`, `after-merge`, `after-deploy` or `date` (any dated one); `--project` a
  registered project's id or root, or `all`, and refuses one not registered,
  listing those that are. A filter narrows, so `--for agent --kind change` lists
  the agent's changes. `--ids` prints the follow-up ids on one line, and
  `--limit` keeps the first N after the grouping. `--all` still works, as
  `--status all`, with a warning on stderr ([L340](../gaps.md#limits)).
- **`post`** without `--confirm` prints what would be posted and where, and
  exits 0 (the preview on stdout, the "Run again with --confirm" hint on
  stderr); with it, posts through `gh` and marks the follow-up done. It refuses
  a message that is not drafted for `github`, or is already closed.
- **`published`** needs `ORK_RUN`; it is what `build`'s `published` step runs.
- **`ork run <workflow> --follow-ups <ids>`** takes `agent` follow-ups as the
  run's brief
  ([taking them](./due-and-delivery.md#taking-them-as-a-runs-brief)).
- `ork watch` checks every 10 minutes and prints a line for each follow-up that
  came due.

## The server

([routes](../../packages/server/src/follow-up-routes.ts),
[contract](../../packages/server/src/contract-follow-ups.ts),
[tests](../../packages/server/test/follow-ups.test.ts)) The same core functions
as the CLI, under a registered project's id (or root):

| Route                                                                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects/:id/follow-ups?status=&for=`                                | The list after the due check: `{ project, followUps, due, checker: { available, errors } }`. `status` is `open` (the default: due and waiting), `all`, `due`, `waiting`, `done` or `dropped`.                                                                                                                                                                                                                                                        |
| `GET /api/projects/:id/follow-ups/:followUp`                                   | One whole: `{ followUp, actions, cause?, keptIn, delivery?, draftDigest?, copy }`. `actions` gives each of `done`, `drop`, `reopen`, `due` and `post` as `{ ok: true }` or `{ ok: false, kind, why, error }`, where `kind` is `status` (the follow-up's status refuses it) or `draft` (its draft can't be posted; copying helps); `cause` is `merged`, `overdue`, `closed-unmerged` or `marked`; `copy` is the draft's text and the steps' commands. |
| `POST /api/projects/:id/follow-ups/:followUp` `{ action }`                     | `done`, `drop`, `reopen` or `due`; answers the new detail, or 409 with the action's reason.                                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/projects/:id/follow-ups/:followUp/post` `{ confirm: true, digest }` | Posts a github-channel draft through the user's `gh`, only when `digest` is the draft's `draftDigest`; answers `{ url?, followUp }`. A draft that changed since is refused (409) and nothing is posted.                                                                                                                                                                                                                                              |

`keptIn` is `{ place, rule, url?, fallback? }`: where it is, where the rule
says, and, when they differ, a sentence about why (derived, not recorded:
[L306](../gaps/follow-ups-limits.md)). `delivery` (for `project:<name>`) says
whether the project is registered, its root, where its own rule keeps them and a
live run there. The overview stream (`GET /api/stream`) also sends `followUps`,
`{ count, items }`, the due ones of the projects it covers (at most 20 items),
whenever they change, and not before one is due. `ork ui` checks the refs every
10 minutes while it runs. None of these routes runs a command.

## The Follow-ups panel

([spec](../ui/panels-follow-ups.md),
[panel](../../packages/ui/src/panels/followups-panel.tsx)) The twin of
`ork follow-ups list | show | add | done | drop | reopen | due | post`, apart
from Feedback: list by due and for, filters with counts, an item's facts, its
draft with **Copy message** and **Post to GitHub…**, its steps with a copy on
each command, the buttons its status allows (the server decides, nothing is
optimistic), and the due count on the tab and the rail button ("Follow-ups, 3
due", `99+` past 99). It has no add form ([L307](../gaps/follow-ups-limits.md)).

## The build workflow

([build.ork.yaml](../../.ork/workflows/build.ork.yaml),
[tests](../../packages/nodes/test/build-publish.test.ts)) After `review` passes,
`followups` (Sonnet, read-only, $0.50) reads the reviewers' `notes` and
`unchecked`, the leader's `unchecked` and the decisions, merges duplicates, and
reports `items` (with `for`, `kind`, `due`, `size` of `trivial`, `real` or
`not-worth-it`, and `recommend` of `do`, `defer` or `drop`), `insights`, and the
counts the edges read. With no items the run goes on to `ratify` and asks
nothing.

- **`followup-gate`** asks once: `take-recommended`, `defer-all` or
  `choose-each`; **`followup-pick`** ($0.30) then asks one `ask_user` per item.
  Only an `agent` `change` due `now` can be done in the run. Nothing is
  deferred, dropped or sent without the maintainer's choice.
- **`polish`** ($3, the implementer) does the chosen items in one round, and
  `pnpm check` runs after; **`polish-review`** ($1.50, correctness only) runs
  when an item it did was `real`, and sends `polish` back at most once
  (`maxRounds: 1`): `polish` reports `fixedReview` when it ran again to fix the
  review, and a review that still blocks then goes on to `ratify`, with its
  findings, instead of looping.
- **`ratify`** lists the follow-ups, the choice, what was done and what was not;
  **`docs`** receives the `insights` and writes them into specs and memories,
  never as follow-ups.
- After the change is published (or kept for the maintainer), **`published`**
  runs `ork follow-ups published <branch>` (a failure only warns), then
  **`declare`** records, with `follow_up`, the plan's `Follow-ups` section and
  the deferred items: with a `ref` of the branch when the choice was a branch
  and pull request, `due` `now` for an `after-merge` follow-up when it went to
  main, and no `ref` when kept uncommitted
  ([L308](../gaps/follow-ups-limits.md)).

## Security and credentials

Ork reads no token: the `github` store, the due checks and **Post** use the
user's own `gh` ([accounts](../../docs/guides/accounts.md)). Text from sessions
is scrubbed before it is stored, written to a file, relayed or posted. A `file`
store is committed with the change a session makes (not what `declare` adds
after the publish), so it is public in a public repository. A task's commands
are shown and never run, and nothing is sent to a person by Ork.
