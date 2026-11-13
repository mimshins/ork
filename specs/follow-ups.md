# Follow-ups

Status: **Built**: the record and its states, the `follow_up` session tool
(capped, duplicates merged), the three places a project keeps them (`store`,
`file`, `github`), the due check through the user's `gh`, delivery by who a
follow-up is for (another project's list and a live session there, a drafted
message, a task's steps), `ork follow-ups` and `ork run --follow-ups`, the
server's routes and the overview stream's due count, the Follow-ups panel, and
`build`'s `followups` review and its `declare` and `published` steps
([types](../packages/core/src/follow-ups/types.ts),
[store](../packages/core/src/follow-ups/store.ts),
[places](../packages/core/src/follow-ups/file.ts),
[due](../packages/core/src/follow-ups/due.ts),
[delivery](../packages/core/src/follow-ups/deliver.ts),
[tool](../packages/runtime/src/tools/follow-up.ts),
[tests](../packages/core/test/follow-ups.test.ts),
[delivery tests](../packages/core/test/follow-up-delivery.test.ts),
[tool tests](../packages/runtime/test/follow-up-tool.test.ts),
[CLI tests](../packages/cli/test/follow-ups-command.test.ts),
[server tests](../packages/server/test/follow-ups.test.ts),
[panel tests](../packages/ui/test/panels/followups-panel.test.tsx)). Not part of
Ork: sending to people (Slack, email), syncing a follow-up closed on GitHub
back, priorities and assignees, and the same review nodes in `plan`, `rfc` and
`start`. How it works for now: [limits](./gaps/follow-ups-limits.md). Why:
[ADR-086](../decisions/ADR-086-follow-ups.md).

A shipped change leaves work behind, and not only code: a message to a colleague
or a partner, a note to an agent working in another project on this machine,
infra work only the maintainer can do, a check after deploy. A **follow-up**
says who acts, what kind of work it is and when it is due. Ork keeps it where
the project's rule says, tells the maintainer when it comes due, delivers what
it can without credentials, drafts what a person must send or do, and brings
code follow-ups back as a later run's brief.

Follow-ups are about the **product**. They are apart from **feedback**
([feedback](./feedback.md)), which is about the process (improving Ork, its
workflows and a project's context) and is never a backlog, and from
**insights**, things learned that are not work, which `build`'s `docs` node
writes into specs and memories. A follow-up never appears in `ork feedback`, its
lessons or `ork feedback publish`, and feedback never appears here.

## Contents

- [The record](#the-record)
- [Adding them](#adding-them)
- [Keeping them](#keeping-them)
- [Due, delivery and taking them](./follow-ups/due-and-delivery.md)
  - [When one comes due](./follow-ups/due-and-delivery.md#when-one-comes-due)
  - [Delivery by who it is for](./follow-ups/due-and-delivery.md#delivery-by-who-it-is-for)
  - [Taking them as a run's brief](./follow-ups/due-and-delivery.md#taking-them-as-a-runs-brief)
- [Where you reach them](./follow-ups/surfaces.md)
  - [The CLI](./follow-ups/surfaces.md#the-cli)
  - [The server](./follow-ups/surfaces.md#the-server)
  - [The Follow-ups panel](./follow-ups/surfaces.md#the-follow-ups-panel)
  - [The build workflow](./follow-ups/surfaces.md#the-build-workflow)
  - [Security and credentials](./follow-ups/surfaces.md#security-and-credentials)
- [Limits: follow-ups](./gaps/follow-ups-limits.md)

## The record

| Field    | Values                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | Eight hex characters; the CLI and the UI show the first six, and a unique prefix is enough.                                     |
| `title`  | One line.                                                                                                                       |
| `body`   | What and why, briefly.                                                                                                          |
| `for`    | `agent` (a later run of this project), `me` (the maintainer), `project:<name>` (a registered project) or `person:<name>`.       |
| `kind`   | `change`, `message`, `task` or `check`.                                                                                         |
| `due`    | `now`, `after-merge`, `after-deploy` or a `YYYY-MM-DD` date.                                                                    |
| `where`  | The files it is about, relative to the project root.                                                                            |
| `from`   | The run and node that left it; the maintainer's own have neither.                                                               |
| `status` | `waiting`, `due`, `done` or `dropped`.                                                                                          |
| `ref`    | The pull request or branch an `after-merge` follow-up waits on.                                                                 |
| `draft`  | For a `message`: `to`, a `channel` hint (`github`, `slack`, `email`…) and the `text` the maintainer sends. A message needs one. |
| `steps`  | For a `task` or `check`: each step's text and, optionally, a command. Ork shows the commands and never runs them.               |

A step whose text is blank (only spaces) is refused, as an empty title is
(`followUpProblem`). For the `github` channel, the draft's `to` is the issue or
pull request URL it is posted on
([due-and-delivery](./follow-ups/due-and-delivery.md)).

Also kept: `place` (where it was written out, and its `url`: the issue's, or the
file), a `note` saying why its status last changed, `takenBy` (the run that took
it as its brief) and the times it was added and last changed. A follow-up starts
`due` when its `due` is `now`, otherwise `waiting`. `done` on a message means it
was **sent**. Every call that changes a status goes through one rule
([change.ts](../packages/core/src/follow-ups/change.ts)), the same for the CLI
and the server: `done` and `drop` start from `waiting` or `due`, `reopen` from
`done` or `dropped` (back to `due` when it was due `now`, else `waiting`), `due`
from `waiting`; each says why it refuses, and the server hands the UI the same
answer for every action (`followUpActions`).

## Adding them

- **A session leaves one** with the `follow_up` tool: `title`, `body`, `for`,
  `kind`, `due`, `where`, and a message's `draft` or a task's `steps`. Every
  agent node in a run gets it when the run keeps follow-ups, `ork run --node`
  too. At most **30 per session**; the 31st is refused, and the session is told
  to put the rest in its report. A malformed one is refused with what to fix
  (the `for` or `due` it doesn't know, a message with no draft). It is not for
  problems with Ork or the workflow (that is `feedback`) nor for what the
  session can finish now. The run and node it came from are recorded by Ork, not
  taken from the call.
- **The maintainer adds one** with `ork follow-ups add`, or in a plan: the plan
  template's optional `Follow-ups` section lists the ones already known, and
  `build` records them once the change is published
  ([the build workflow](./follow-ups/surfaces.md#the-build-workflow)).
- **Duplicates merge.** One with the same `for`, the same files and a title
  whose words are at least 80% the same (Jaccard) as an **open** follow-up's
  merges into it: its body is added if new, and it takes a draft or steps the
  kept one lacked. The result says it merged, and when a different `--text` was
  given, that the new text was not kept (the first draft stays). A closed one
  never absorbs a new one.
- **Text is scrubbed first** with the feedback redactor
  ([redact.ts](../packages/core/src/feedback/redact.ts)): secrets masked, a home
  folder written `~`, the project's paths `<project>/…`, and emails, hosts and
  IP addresses removed, in the title, body, files, who it is for, its ref, the
  draft (its channel too) and steps, before it is stored, written to a file,
  relayed or posted ([L303](./gaps/follow-ups-limits.md)).

## Keeping them

Ork's own store (the `follow_ups` table in `~/.ork/state.db`) **indexes every
follow-up**, whatever the rule, so they can be listed, come due and be closed in
one place; it is per project and never committed. The project's rule says where
a new one is also written out:

```yaml
# .ork/project.yaml
followUps:
  store: store # store | file | github
  file: .ork/follow-ups.md # for store: file; relative to the project root
  label: ork-follow-up # for store: github
```

- **`store`** (the default): nowhere else.
- **`file`**: appended to the markdown file in **the session's worktree**, so it
  is committed with the change a session makes (through `build`, the entries
  `declare` adds after the publish come after the commit,
  [L311](./gaps/follow-ups-limits.md)). A file path outside the project is
  refused. It is public in a public repository: do not use it for what only the
  maintainer should read.
- **`github`**: an issue in the project's repository through the user's own
  `gh`, labelled `ork-follow-up` (the label is created if missing), its URL
  kept. When `gh` is not signed in, or cannot create the issue, the follow-up is
  kept in Ork's store instead and the result says so; a write that throws does
  the same, so a follow-up is never lost.

The rule is read from the project's `followUps` key, so a project registered
from outside its repository keeps it in `~/.ork/projects/<id>/project.yaml`
([project rules](./project-rules.md)). A new place is one adapter in the
registry (`FOLLOW_UP_PLACES`), not a branch in shared code
([ADR-022](../decisions/ADR-022-integration-registry.md)). Status changes update
Ork's store only ([L300](./gaps/follow-ups-limits.md)).
