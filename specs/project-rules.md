# Project rules

Status: **Built**: `.ork/project.yaml`, a workflow's `rules:`, and the git rules
in the workspace ([project.ts](../packages/schema/src/project.ts),
[rules.ts](../packages/core/src/project/rules.ts),
[names.ts](../packages/core/src/worktree/names.ts),
[patch.ts](../packages/core/src/worktree/patch.ts),
[handoff.ts](../packages/core/src/worktree/handoff.ts),
[tests](../packages/core/test/rules.test.ts)), and [experiments](#experiments).
The rules reach the items of a `forEach` node too, with the item's id as
`{node}`, including `commit: never` and the patch merge
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
```

`followUps` says where a new [follow-up](./follow-ups.md#keeping-them) is also
written out: `store` (Ork's store only, the default), `file` (appended to
`file`, default `.ork/follow-ups.md`, in the session's worktree, committed with
the change) or `github` (an issue labelled `label`, default `ork-follow-up`,
through your `gh`).

The JSON Schema is
[project.schema.json](../packages/schema/project.schema.json).

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
- `permissions`: added together, the project's, the workflow's and each node's
  own `tools`; Claude Code lets `deny` win over `allow`.
- `context`: the project's files come before the workflow's `layers.context`,
  rebased onto the workflow's folder.

The project's rules are put under the workflow when it compiles, so
`ork validate`, `ork context explain` and the run all see the effective
workflow. An invalid `project.yaml` is an error on every workflow in the
project, located in the file (`.ork/project.yaml:3:11: …`).

## Git rules

| Rule                  | What Ork does                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit: auto`        | Commits what a session leaves, and before a leader delegates ([worktrees](./worktrees.md#after-a-node)).                                                                                                              |
| `commit: never`       | Runs no `git commit`. Worktrees are detached (no branch). A node's work stays uncommitted; its output has `worktree` (its path) and no `branch`. A child starts from its owner's commit plus its uncommitted changes. |
| `merge: auto`         | A passing child's branch is merged into its owner's worktree with `--no-ff`. Needs `commit: auto`.                                                                                                                    |
| `merge: patch`        | A passing child's changes (new files too) are applied to its owner's worktree, uncommitted, all or nothing; a part that does not apply is reported as a conflict, and the child's worktree is kept.                   |
| `merge: never`        | Nothing is handed over; each child's worktree is kept, for its owner or the user.                                                                                                                                     |
| `base`                | A ref (`origin/main`) or template; it must name a commit when the run starts. Ork never fetches.                                                                                                                      |
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

## Links

`links: off` leaves the message tools out for a node with no one to write to,
and refuses links to the run. The default is on
([messaging](./messaging/links.md)). A workflow's value wins.

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

Status: **Built** ([experiments.ts](../packages/core/src/experiments.ts),
[tests](../packages/core/test/experiments.test.ts)). No experiment ships yet.
Why: [ADR-066](../decisions/ADR-066-experiments-registry.md).

Work not ready for everyone sits on `main`, off until asked for:

```yaml
experimental: [some-feature]
```

or `ORK_EXPERIMENTAL=some-feature,other-feature` (spaces around names and empty
items are ignored). Both at once give the union. Outside a project only the
environment counts; the project file is `.ork/project.yaml` or an attached
project's own ([projects](./projects.md)).

- **One registry.** A name works only if `EXPERIMENTS` has it. An entry (name,
  summary, spec) comes with the change that adds its experiment.
- **One question.** A consumer calls `experimentOn(name, …)`, which reads the
  environment and takes the project's rules; nothing else reads
  `ORK_EXPERIMENTAL`. With any unknown name, every gate is off.
- **A gate that refuses** says so with `experimentOffMessage(name)`:
  `some-feature is experimental; turn it on with "experimental: [some-feature]" in .ork/project.yaml or ORK_EXPERIMENTAL=some-feature`.
- **An unknown name is an error** (`experiment.unknown`) on every workflow:
  `ork validate`, `ork run`, the builder, the MCP tools and triggers refuse it,
  with its source and the known names:
  ``.ork/project.yaml:3:5: names an unknown experiment `x`; known: …``, or
  ``ORK_EXPERIMENTAL names an unknown experiment `x`; known: …``.
  [`ork doctor`](./cli/worktrees-agents-context-and-doctor.md#doctor) reports it
  as a failed check.

The opt-in adds no event and isn't stored with a run: it is read each time a
workflow is checked, a resume included, on either driver alike. Nothing promotes
or removes an experiment yet ([G28](./gaps.md#gaps)).

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

Whatever the rules say:

- Ork never pushes.
- Ork never takes over a branch its run did not create: an existing branch stops
  the node. A resumed run checks its own branches out again.
- Every branch and worktree Ork creates is recorded (`worktree` `created`
  events), and [`ork worktrees`](./worktrees.md#ork-worktrees) lists and cleans
  what the runs recorded, plus any `ork/` branch.
- A worktree is never inside the clone.
