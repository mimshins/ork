# Project rules

Status: **Built**: `.ork/project.yaml`, a workflow's `rules:`, and the git rules
in the workspace ([project.ts](../packages/schema/src/project.ts),
[rules.ts](../packages/core/src/project/rules.ts),
[names.ts](../packages/core/src/worktree/names.ts),
[patch.ts](../packages/core/src/worktree/patch.ts),
[handoff.ts](../packages/core/src/worktree/handoff.ts),
[tests](../packages/core/test/rules.test.ts)). Rules for a project registered
from outside its repository come with `ork register` (planned). Why:
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
permissions: # tool rules every Claude node gets
  allow: []
  deny: ["Bash(git push *)"]
defaults: # as a workflow's defaults
  model: sonnet
context: [docs/process.md] # context files every node reads, from the project root
```

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
- `defaults`: the workflow's `defaults` win, key by key; a node's own settings
  (or its agent's) win over both.
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
| `branch`, `worktrees` | Templates over `{run}`, `{node}`, `{clone}` (the clone's folder name) and `{inputs.<name>}`. `worktrees` is relative to the clone.                                                                                    |

Under `commit: never`, a child that ran and was handed over is brought up to its
owner's state before it runs again (a `synced` worktree event); one whose patch
did not apply keeps its work. Ork stages files in its own worktrees
(`git add -A`) to see new ones; it commits nothing. A commit is then a step the
workflow declares: a [`tool.git`](./workflow-format.md) node after its gates
([ADR-034](../decisions/ADR-034-tool-git.md)).

**Checks** (`ork validate`): every placeholder is known and every
`{inputs.<name>}` is a workflow input; `branch` and `worktrees` need `{node}`
when a run can have more than one worktree (two worktree nodes, or a leader that
spawns workers); without `{run}` a warning says a second run stops while the
first one's branch or worktree exists; `worktrees` is relative; `merge: auto`
with `commit: never` is an error. When a node's worktree is made: the folder
must be beside the clone (inside its parent, outside the clone), and the branch
a name git accepts.

## Safety

Whatever the rules say:

- Ork never pushes.
- Ork never takes over a branch its run did not create: an existing branch stops
  the node. A resumed run checks its own branches out again.
- Every branch and worktree Ork creates is recorded (`worktree` `created`
  events), and [`ork worktrees`](./worktrees.md#ork-worktrees) lists and cleans
  what the runs recorded, plus any `ork/` branch.
- A worktree is never inside the clone.
