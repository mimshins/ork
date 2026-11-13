# API

_Part of [The local server](../server.md)._

JSON under `/api`. A refusal is `{ "error": "…" }` with the CLI's words. Runs
are named by id or a unique prefix: no match is 404, several are 400.

| Method | Path                                                  | Does                                                                                                                                                                       | As                               |
| ------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| GET    | `/api/health`                                         | `{ version, pid, startedAt }`                                                                                                                                              | —                                |
| GET    | `/api/projects`                                       | the registered projects                                                                                                                                                    | `ork projects --json`            |
| GET    | `/api/projects/:id/workflows`                         | its workflows folder: each `name`, `file`, `title`, `description`, `inputs`, or `error`                                                                                    | —                                |
| GET    | `/api/workflow-schema`                                | the format's JSON Schema, which the builder's forms are generated from                                                                                                     |
| GET    | `/api/projects/:id/catalog`                           | the agents and skills a project offers, each with where it comes from                                                                                                      |
| GET    | `/api/projects/:id/builder`                           | the names of its drafts                                                                                                                                                    |
| POST   | `/api/projects/:id/builder`                           | `{ name }`: starts a draft of a new workflow                                                                                                                               |
| GET    | `/api/projects/:id/builder/:name`                     | its draft, or else its file: text, what it says, graph, what the checks say                                                                                                |
| POST   | `/api/projects/:id/builder/:name/edits`               | `{ edits }`: applies [document edits](../../packages/schema/src/workflow-edit.ts) to its draft, all or none                                                                |
| POST   | `/api/projects/:id/builder/:name/text`                | `{ text, baseHash }`: puts its draft back to earlier text, for undo, remembering the file that text began from                                                             |
| POST   | `/api/projects/:id/builder/:name/discard`             | drops its draft                                                                                                                                                            |
| GET    | `/api/projects/:id/builder/:name/nodes/:node/context` | what the node's session loads, planned from its draft, else its file (below)                                                                                               | `ork context explain`            |
| POST   | `/api/projects/:id/builder/:name/save`                | `{ force? }`: writes the file; answers `saved: false` on errors, or a file that changed                                                                                    |
| GET    | `/api/runs`                                           | runs newest first, each with `live`; the [list fields](#list-routes), and `?limit` (20)                                                                                    | `ork ps --json`                  |
| GET    | `/api/runs/:id`                                       | one run, with `live` (`crashed` when its process is gone, `paused` when it is paused) and `paused`                                                                         | —                                |
| GET    | `/api/runs/:id/tree`                                  | the ownership tree; a fanned node has its items as children, and its list's count as `listed`                                                                              | `ork tree --json`                |
| GET    | `/api/runs/:id/graph`                                 | what its graph is drawn from: nodes, edges, channels                                                                                                                       |
| GET    | `/api/runs/:id/nodes/:node/context`                   | the same for a run's node, from its workflow file as it is now                                                                                                             | `ork context explain`            |
| GET    | `/api/runs/:id/events`                                | stored events; `?after`, `?node`, `?limit`, `?last` (the newest N)                                                                                                         | `ork logs --json`                |
| GET    | `/api/usage`                                          | the [usage report](../usage.md#reports); the [list fields](#list-routes)                                                                                                   |
| GET    | `/api/list-fields`                                    | each list's filter fields: `name`, `description`, `type`, `values?`, `all?`, from core's tables                                                                            | `--help` of each list            |
| GET    | `/api/triggers`                                       | how [triggers](../scheduler/watching.md#the-process) stand, and whether `ork watch` is running                                                                             |
| GET    | `/api/decisions`                                      | open decisions of live runs; the [list fields](#list-routes) (ANDed)                                                                                                       | `ork decide --list`              |
| GET    | `/api/decisions/:id`                                  | one decision, open or not, with its document, answer, who gave it, and their note                                                                                          | `ork logs <run>`                 |
| POST   | `/api/decisions/:id`                                  | `{ choose, note? }`: answers it as `ui` with the note, if any, and wakes the run                                                                                           | `ork decide --id --say`          |
| POST   | `/api/runs`                                           | `{ project, workflow, inputs?, driver?, inPlace?, allowDirty?, machineClaude? }`                                                                                           | `ork run --detach`               |
| POST   | `/api/runs/:id/resume`                                | `{ inputs?, driver?, inPlace?, allowDirty? }`                                                                                                                              | `ork resume --detach`            |
| POST   | `/api/runs/:id/stop`                                  | `{ node? }`: asks a live run, or one running node, to stop                                                                                                                 | `ork stop`                       |
| POST   | `/api/runs/:id/pause`                                 | `{ node? }`: pauses a live run, or one node                                                                                                                                | `ork pause`                      |
| POST   | `/api/runs/:id/continue`                              | `{ node? }`: lets it go on                                                                                                                                                 | `ork continue`                   |
| POST   | `/api/runs/:id/messages`                              | `{ node, body }` to a live run's leader or worker                                                                                                                          | `ork chat -m` (live)             |
| POST   | `/api/runs/:id/notes`                                 | `{ text, node?, kind?, severity?, rating? }`: a person's note, as the run's [feedback](../feedback.md)                                                                     | `ork feedback note`              |
| GET    | `/api/feedback`                                       | every [feedback](../feedback.md) item, dismissed ones too unless a filter narrows them, most recently seen first; the [list fields](#list-routes)                          | `ork feedback list --status all` |
| GET    | `/api/feedback/:id`                                   | an item, its records, which actions it allows and why not, where a lesson would go (below)                                                                                 | `ork feedback show`              |
| POST   | `/api/feedback/:id/status`                            | `{ status }`: `dismissed`, or `new` to restore a dismissed one                                                                                                             | `ork feedback dismiss`           |
| POST   | `/api/feedback/:id/accept`                            | `{ lesson, text?, workflow? }`: accepts it, as a lesson with `lesson: true`                                                                                                | `ork feedback accept`            |
| POST   | `/api/feedback/:id/apply`                             | `{ driver? }`: starts `ork feedback apply` in the background; 202 with `{ runId, root }`                                                                                   | `ork feedback apply`             |
| POST   | `/api/feedback/:id/publish/preview`                   | `{ hideNames }`: exactly what a publish would send, where, and its `digest`; reads only                                                                                    | `ork feedback publish`           |
| POST   | `/api/feedback/:id/publish`                           | `{ hideNames, digest }`: posts it with your `gh`, only when it is still what was previewed                                                                                 | `ork feedback publish`           |
| POST   | `/api/feedback/:id/split`                             | takes apart what triage merged into it                                                                                                                                     | `ork feedback split`             |
| GET    | `/api/projects/:id/follow-ups`                        | a project's [follow-ups](../follow-ups.md) after the due check, with whether `gh` could check the PRs; the [list fields](#list-routes), `status` also `open` (the default) | `ork follow-ups list`            |
| GET    | `/api/projects/:id/follow-ups/:followUp`              | one, with what each action allows and why not, why it is due, where it is kept, its delivery, and what to copy                                                             | `ork follow-ups show`            |
| POST   | `/api/projects/:id/follow-ups/:followUp`              | `{ action }`: `done`, `drop`, `reopen` or `due`                                                                                                                            | `ork follow-ups done` …          |
| POST   | `/api/projects/:id/follow-ups/:followUp/post`         | `{ confirm: true, digest }`: posts a github-channel draft with your `gh`, only when it is still the draft the digest stands for                                            | `ork follow-ups post --confirm`  |
| GET    | `/api/worktrees`                                      | each project Ork knows, its [worktrees](../worktrees.md#ork-worktrees) in core's words, or its `error`; the [list fields](#list-routes)                                    | `ork worktrees --json`           |
| POST   | `/api/worktrees/remove/plan`                          | `{ project, key, deleteBranch }`: one item's plan, whether it needs force, what it loses, and its `digest`                                                                 | `ork worktrees remove`           |
| POST   | `/api/worktrees/remove`                               | `{ project, key, deleteBranch, force, digest }`: removes it, only when the plan is still the one shown                                                                     | `ork worktrees remove`           |
| POST   | `/api/worktrees/clean/plan`                           | `{ project?, branches }`: each project's merged-only, unforced clean plan, and its `digest`                                                                                | `ork worktrees clean`            |
| POST   | `/api/worktrees/clean`                                | `{ project?, branches, digest }`: cleans it, only when the plan is still the one shown                                                                                     | `ork worktrees clean`            |
| GET    | `/api/links`                                          | links; `?run=` keeps one run's                                                                                                                                             |
| POST   | `/api/links`                                          | `{ a, b, maxMessages? }`, as `<run>/<node>`: [links](../messaging/links.md)                                                                                                |
| POST   | `/api/links/end`                                      | `{ a, b }`: ends the link                                                                                                                                                  |
| GET    | `/api/version`                                        | what is known of versions, from the update record, and the server's upgrade ([updates](../cli/updates.md#in-ork-ui))                                                       | `ork doctor`                     |
| POST   | `/api/upgrade/plan`                                   | asks the registry now; what an upgrade would do, with a `planId`                                                                                                           | `ork upgrade --check`            |
| POST   | `/api/upgrade`                                        | `{ planId }`: runs the plan's own command when it is still the plan; 202 with the job                                                                                      | `ork upgrade --yes`              |
| GET    | `/api/upgrade/stream`                                 | Server-Sent Events: the upgrade's output, then `end`                                                                                                                       | —                                |
| POST   | `/api/restart`                                        | 202 `{ port, pid }`, then `ork ui` restarts it onto the installed `ork`                                                                                                    | —                                |
| GET    | `/api/runs/:id/stream`                                | Server-Sent Events, below                                                                                                                                                  | `ork logs -f`                    |
| GET    | `/api/stream`                                         | Server-Sent Events, below                                                                                                                                                  | —                                |
| GET    | `/`, `/assets/…`                                      | the built UI (below), or the placeholder page without one                                                                                                                  | —                                |

- **Status codes.** A write that was taken is 202 (start, resume, stop, pause,
  continue, message) or 200 (an answer), with `{ runId }` or
  `{ decision, answer }`. A query or body the contract does not allow, an option
  a decision does not have, or a node without a session is 400; a missing run,
  decision, project, workflow or node is 404; a run in the wrong state (stopping
  one that ended, resuming one that runs or succeeded, messaging one that ended,
  pausing one already paused, continuing one that is not, stopping a node that
  is not running, a decision already answered or withdrawn) is 409
  ([run control](../run-control.md#commands)); a method a path does not take is
  405; a body over 1 MiB is 413.
- **Starting a run.** `project` is a registered project's id or root. `workflow`
  is a name in its workflows folder, or a path inside its root or its Ork
  folder; anything else is 404. The run starts in the project's root, with its
  output in the run's folder (`output.log`), and the answer comes once the run
  is recorded; a run that fails to start answers 400 with its output.
- **A project's workflows** are the `*.ork.yaml` files of its workflows folder
  ([workflows.ts](../../packages/server/src/workflows.ts)), each with its
  declared inputs, for starting one; a file that does not parse is listed with
  its first error.
- **Feedback** ([routes](../../packages/server/src/feedback-routes.ts)) goes
  through the same core functions as `ork feedback`, so the rules are the same:
  which actions an item allows comes from one rule
  ([actions.ts](../../packages/core/src/feedback/actions.ts)), and a refused one
  is 409 in its words. An item's detail adds, per workflow it was seen in, the
  lessons file a lesson would go to and its size against the cap; the project a
  fix would be proposed in, or why there's none; and a running fix's run. Apply
  starts `ork feedback apply <item> --run-id <id>` in that project as a detached
  run does, so its gate's keep or discard settles the item as in a terminal.
  Publish makes the preview again and refuses with 409, sending nothing, when
  its digest isn't the one the person saw.
- **Follow-ups** ([routes](../../packages/server/src/follow-up-routes.ts)) go
  through the same core functions as `ork follow-ups`
  ([change.ts](../../packages/core/src/follow-ups/change.ts)): a project is its
  id or root, a follow-up an id or unique prefix, and a refused action is 409 in
  its words. The list reads the pull requests first and only reports a `gh` that
  fails. Post sends nothing unless the digest is the draft's now. Details:
  [follow-ups](../follow-ups/surfaces.md#the-server).
- **Worktrees** ([routes](../../packages/server/src/worktrees-routes.ts)) go
  through the same core functions as `ork worktrees`
  ([remove.ts](../../packages/core/src/worktree/remove.ts)): a project is a root
  Ork knows (registered, or a stored run's), read in parallel, one git can't
  read answering with its `error`; an item is resolved by its `key` from a fresh
  listing, never a path taken from the request. Remove and clean plan again and
  refuse with 409, removing nothing, when the digest isn't the one shown, or
  while another write runs in that project; a plan that loses work is carried
  out only with `force`, and a refusal by core's rule (the main checkout, a run
  still going) is 400.
- **Node context** is `{ planned: true, explanation }` with each piece's words,
  or `{ planned: false, why }`; for a run, `changedSinceStart` names each file
  behind it changed after the run started
  ([context-routes.ts](../../packages/server/src/context-routes.ts)).
- **Events** are the stored events, already masked; the server sends nothing the
  store does not hold, except each `node.finished`'s `end` as an `EndView`
  (`kind`, `message`, `detail?`, plus the registry's `label`, `actor`,
  `transient`, `hint` and `docsAnchor`), read through core's `endOf` so a run
  stored before ends existed has one too. **The tree** carries the same `end` on
  each node that has finished, and a failed node's `now` is its message, not the
  raw error ([end-view.ts](../../packages/server/src/end-view.ts),
  [contract](../../packages/server/src/contract-ends.ts)). No endpoint is new.
- **The built UI** is the first folder that holds an `index.html`: `dist/ui`
  beside the published bundle, or `packages/ui/dist` from source once
  `pnpm ui:build` has run
  ([folder.ts](../../packages/cli/src/browser/folder.ts)). `/` is its page;
  `/assets/…` are its hashed files, cached as immutable; and only a file inside
  the folder of a type the build writes (HTML, JavaScript, CSS, fonts, images,
  text) is served, anything else is 404. Without a built UI the placeholder page
  lists the runs and open decisions live.
- **Messaging a finished run** (resuming its node's session) is not in the API
  yet; it answers 409 and names `ork chat` ([L26](../ui/limits.md)).

## List routes

The list routes ([query schemas](../../packages/server/src/contract-lists.ts),
[reading them](../../packages/server/src/list-query.ts)) are `runs`, `usage`,
`decisions`, a project's `follow-ups`, `feedback` and `worktrees`. Each takes
the fields of its core table by their flag names (`status`, `workflow`,
`project`, `since`, `until`, `kind`, `severity`, `due`, `for`, `run`; which ones
is per list, [list filters](../cli/list-filters.md#the-lists)) as query
parameters, with the CLI's value forms (`since=24h`, `since=2026-11-01`,
`status=all`), checked by core's `parseFilters` and applied by `applyFilters`:
the filter, then the list's own order, then `limit`. A value the table refuses
is 400 in the CLI's words ("--status takes one of …"). `GET /api/list-fields`
serves the tables' fields without their functions, so the UI builds its
[filter bar](../ui/design-filter-bar.md) without importing core. The older
parameters keep working and keep their defaults:

- `runs`: the 20 newest; `status` reads the live status a run shows (`paused`,
  `crashed`), core's `runStatus`.
- `usage`: `since` and `until` also take an ISO time; `since` also `all`.
- `feedback`: unfiltered answers every item, dismissed too, and the panel hides
  the dismissed itself; `status` narrows.
- `follow-ups`: `status` also takes `open` (due and waiting), the default. The
  path names the project; a `project` query for another one lists nothing.
- `since` and `until` are plain text in the query schemas, not regex-checked: a
  Zod refusal would carry Zod's words and the UI could not mark the field, so
  core's `parseFilters` is the only judge.
- The contract holds each list's field names as literals, because core's tables
  carry node-only code and the contract must stay browser-safe; the
  `GET /api/list-fields` test in `list-routes.test.ts` holds them equal to
  core's tables.
- `project` is a registered project's id or root; any other value is read as a
  root, as before ([L342](../gaps.md#limits)).
