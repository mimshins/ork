# Project rules

Status: **Built**: `.ork/project.yaml`, a workflow's `rules:`, and the git rules
in the workspace ([project.ts](../packages/schema/src/project.ts),
[rules.ts](../packages/core/src/project/rules.ts),
[names.ts](../packages/core/src/worktree/names.ts),
[patch.ts](../packages/core/src/worktree/patch.ts),
[handoff.ts](../packages/core/src/worktree/handoff.ts),
[tests](../packages/core/test/rules.test.ts)), [experiments](#experiments), and
[permissions without asking](#permissions-without-asking). The rules reach the
items of a `forEach` node too, with the item's id as `{node}`, including
`commit: never` and the patch merge
([worktrees](./worktrees.md#a-node-run-once-per-item),
[tests](../packages/core/test/worktree-for-each.test.ts)). A project registered
from outside its repository keeps them in `~/.ork/projects/<id>/project.yaml`
([projects](./projects.md)). Why:
[ADR-032](../decisions/ADR-032-project-rules.md).

What Ork does on its own in a project (commit, merge, name branches and
worktrees) is the project's choice. Every key is optional; what is left out is
Ork's default, shown below.

```yaml
# .ork/project.yaml
schemaVersion: 1
git:
  commit: auto # auto | never
  merge: auto # auto | patch | never (default patch under commit: never)
  base: HEAD # the commit worktrees without an owner start from
  fetch: auto # auto | never: fetch a remote base such as origin/main first
  readonly: checkout # checkout | base: where an ownerless readonly node reads
  branch: "ork/{run}/{node}"
  worktrees: "../{clone}-worktrees/ork-{run}-{node}"
permissions: # tool rules every agent node gets
  allow: []
  deny: ["Bash(git push *)"]
defaults: # as a workflow's defaults
  model: sonnet
context: [docs/process.md] # context files every node reads, from the project root
experimental: [] # experiments this project turns on
followUps: { store: store } # where follow-ups are kept: store | file | github
agents: open # open | isolate: deny the agents of a workflow's other nodes
knowledge: any # any | ork-only: `ork feedback apply` writes only under .ork/
```

`followUps` says where a new [follow-up](./follow-ups.md#keeping-them) is also
written out: `store` (Ork's store only, the default), `file` (appended to
`file`, default `.ork/follow-ups.md`, in the session's worktree, committed with
the change) or `github` (an issue labelled `label`, default `ork-follow-up`,
through your `gh`).

JSON Schema: [project.schema.json](../packages/schema/project.schema.json).

## Precedence

A workflow overrides the project under its own `rules:`:

```yaml
rules:
  git: { merge: never }
  permissions: { deny: ["Bash(rm *)"] }
```

- `git` keys: the workflow's win, key by key.
- `defaults`: the workflow's `defaults` win, key by key, and `practices` one
  practice at a time; a node's own settings (or its agent's) win over both.
  `defaults.mcp` names the MCP servers a node's sessions load
  ([workflow format](./workflow-format.md)).
- `agents`: the workflow's value wins; `knowledge` has no workflow form.
- `permissions`: added together, the project's, the workflow's and each node's
  own `tools`; Claude Code lets `deny` win over `allow`. `unlisted` (`refuse` or
  `ask` a shell command no rule covers) is one value: the node's, else the
  workflow's, else the project's, else `refuse` on a `readonly` node
  ([permissions without asking](#permissions-without-asking)).
- `context`: the project's files come before the workflow's `layers.context`,
  rebased onto the workflow's folder.

The project's rules are put under the workflow when it compiles, so
`ork validate`, `ork context explain` and the run all see the effective
workflow. An invalid `project.yaml` is an error on every workflow in the
project, located in the file (`file`, `line`, `column` in `--json`), as is an
unknown experiment it names: `ork validate` prints `.ork/project.yaml:3:11 …`.

## Git rules

| Rule                  | What Ork does                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit: auto`        | Commits what a session leaves, and before a leader delegates ([worktrees](./worktrees.md#after-a-node)).                                                                                                              |
| `commit: never`       | Runs no `git commit`. Worktrees are detached (no branch). A node's work stays uncommitted; its output has `worktree` (its path) and no `branch`. A child starts from its owner's commit plus its uncommitted changes. |
| `merge: auto`         | A passing child's branch is merged into its owner's worktree with `--no-ff`. Needs `commit: auto`.                                                                                                                    |
| `merge: patch`        | A passing child's changes (new files too) are applied to its owner's worktree, uncommitted, all or nothing; a part that does not apply is reported as a conflict, and the child's worktree is kept.                   |
| `merge: never`        | Nothing is handed over; each child's worktree is kept, for its owner or the user.                                                                                                                                     |
| `base`                | A ref (`origin/main`) or template; it must name a commit when the run starts, after the fetch below.                                                                                                                  |
| `fetch: auto`         | The default. When `base` names a remote-tracking ref, `git fetch --no-tags <remote> +refs/heads/<b>:refs/remotes/<remote>/<b>` runs before it is resolved ([fetching](./project-rules/fetch.md#fetching)).            |
| `fetch: never`        | Ork fetches nothing; `base` is whatever the clone last fetched.                                                                                                                                                       |
| `readonly: checkout`  | The default. A `readonly` node with no owner and no upstream worktree reads the project checkout.                                                                                                                     |
| `readonly: base`      | Such a node reads one detached worktree at the base commit, shared by the run's readonly nodes ([worktrees](./worktrees.md#a-readonly-node-at-the-base)).                                                             |
| `branch`, `worktrees` | Templates over `{run}`, `{node}` (an item of a `forEach` node is `build.2`), `{clone}` (the clone's folder name) and `{inputs.<name>}`. `worktrees` is relative to the clone.                                         |

Under `commit: never`, a child that ran and was handed over is brought up to its
owner's state before it runs again (a `synced` worktree event); one whose patch
did not apply keeps its work. Ork stages files in its own worktrees
(`git add -A`) to see new ones; it commits nothing. A commit is then a step the
workflow declares: a [`tool.git`](./workflow-format.md) node after its gates
([ADR-034](../decisions/ADR-034-tool-git.md)).

**Checks** (`ork validate`): every placeholder is known and every
`{inputs.<name>}` is a workflow input; `branch` and `worktrees` need `{node}`
when a run can have more than one worktree (two worktree nodes, a worktree node
with `forEach`, which has one per item, or a leader that spawns workers);
without `{run}` a warning says a second run stops while the first one's branch
or worktree exists; `worktrees` is relative; `merge: auto` with `commit: never`
is an error. When a node's worktree is made: the folder must be beside the clone
(inside its parent, outside the clone), and the branch a name git accepts.

`fetch` and `readonly` are in [fetching the base](./project-rules/fetch.md).

## Permissions without asking

Status: **Built** on `claude-code`. A shell line a session asks about is read by
Ork's own reader: what the node's allow rules and Ork's shipped reads cover runs
without a prompt, a deny rule denies it, and a node with `unlisted: refuse` (a
`readonly` node's default) refuses the rest with a message. A prompt for a line
Ork read offers to allow its rules for the node, the run, or always, which
appends them to `permissions.allow` here; a rule allowed often is proposed as a
feedback item. The Codex, Command Code and omp guards allow the same shipped
reads inside the worktree (never `pnpm ork …`, which runs the project's own
script), and a call a driver's guard refused three times in a node is filed as a
`tool.refused` item on every driver but `claude-code`. The detail is in
[permissions without asking](./project-rules/permissions.md). Why:
[ADR-109](../decisions/ADR-109-permissions-without-asking.md).

## Links and reading

`links: off` leaves out the message tools for a node with no one to write to and
refuses links ([messaging](./messaging/links.md)); `reading: open` lets sessions
read through the shell, which the default `extract` refuses
([shell reads](./runtime/extract-reading-rules.md#shell-reads)). A workflow's
value wins. `sessions.freshOver` is in
[sessions rule](./project-rules/sessions.md).

## Agents and knowledge

`agents: isolate` denies a node's sessions the agents that fill the workflow's
other nodes (`Agent(<name>)` and `Task(<name>)`); a workflow's value wins.
`knowledge: ork-only`, the project's alone, holds `ork feedback apply` to the
Ork folder. Both are off by default
([agents and knowledge](./project-rules/agents-and-knowledge.md)).

## Quotas

```yaml
quotas:
  dayUsd: 5
  monthUsd: 50
  dayTokens: 5000000 # counted tokens: input, output and cache write
```

The most this project may spend on this machine, across runs, in dollars or
(`dayTokens`, on any driver) in counted tokens. The user's own caps in
`~/.ork/settings.yaml` apply too, so these can only lower what is spent
([limits across runs](./usage.md#limits-across-runs)).

## Calls

```yaml
calls:
  accept: [se-backend] # registered project ids that may call this project
```

Without it, any registered project may [call a workflow](./scheduler/calls.md)
here. With it, only those named may, and others fail with the reason. A call
from within the project is always allowed.

## Experiments

Status: **Built**. Work not ready for everyone sits on `main`, off until asked
for with `experimental: [name]` or `ORK_EXPERIMENTAL=name`; the detail is in
[experiments](./project-rules/experiments.md). Why:
[ADR-066](../decisions/ADR-066-experiments-registry.md).

## Machine rules

```yaml
heavy: [pnpm check, pnpm test, vitest run] # the full-suite commands
priority: low # low (the default) | normal
```

`heavy` lists the project's full-suite commands: a node with `verify:` may not
run them in its session, and each takes a machine-wide slot. `priority` is the
OS priority of what a run starts. Both are the project's alone: a workflow's
`rules:` doesn't carry them ([machine](./machine.md)).

## Triggers

What starts a run with nobody there isn't a rule: it's in `triggers.yaml`,
beside this file, and [accepted on each machine](./scheduler/watching.md#trust).
[Quotas](#quotas) hold a trigger until they reset. A change to `project.yaml`
doesn't turn a trigger off ([L119](./scheduler/watching-limits.md)).

## Safety

Whatever the rules say, Ork never pushes, and:

- Ork never takes over a branch its run did not create (an existing one stops
  the node); a resumed run checks its own out again.
- Every branch and worktree Ork creates is recorded (`worktree` `created`
  events), and [`ork worktrees`](./worktrees.md#ork-worktrees) lists and cleans
  what the runs recorded, plus any `ork/` branch.
- A worktree is never inside the clone.

## Contents

- [Experiments](./project-rules/experiments.md)
- [Fetching the base](./project-rules/fetch.md)
- [Permissions without asking](./project-rules/permissions.md)
- [Sessions rule](./project-rules/sessions.md)
- [Agents and knowledge rules](./project-rules/agents-and-knowledge.md)
