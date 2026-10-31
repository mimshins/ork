# Projects: in the repository, or attached

Status: **Built**: places, `ork register`, `ork projects`, `ork init` recording
an in-repo project, and `ork migrate`
([place.ts](../packages/core/src/project/place.ts),
[register.ts](../packages/cli/src/project/register.ts),
[migrate.ts](../packages/cli/src/project/migrate.ts),
[move.ts](../packages/core/src/project/move.ts),
[draft.ts](../packages/cli/src/project/draft.ts),
[projects.ts](../packages/core/src/store/projects.ts),
[tests](../packages/cli/test/projects.test.ts),
[migrate tests](../packages/cli/test/migrate.test.ts),
[core tests](../packages/core/test/projects.test.ts)). Why:
[ADR-035](../decisions/ADR-035-projects-in-repo-or-attached.md),
[ADR-036](../decisions/ADR-036-ork-migrate.md).

A project is a git repository Ork runs workflows in. Ork keeps its own files for
it in one folder, in one of two places:

| Mode     | Ork's folder            | What is in the repository |
| -------- | ----------------------- | ------------------------- |
| in-repo  | `<root>/.ork/`          | that folder, committed    |
| attached | `~/.ork/projects/<id>/` | nothing                   |

Both folders hold the same things:

| Path           | What                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| `workflows/`   | the project's workflows; `ork run <name>` finds them                                     |
| `project.yaml` | the project's [rules](./project-rules.md)                                                |
| `runs/<run>/`  | each run's events copy, output log, plugins and long tool output                         |
| `lessons/`     | accepted lessons, one file per workflow ([context](./context.md))                        |
| `agents/`      | the project's own agents, the most local project source ([context](./context.md#agents)) |

## Registering

- **`ork register [path] [--id <id>] [--json]`** attaches the repository at
  `path` (default: the current folder): its main clone's git root, not a
  worktree. It creates `~/.ork/projects/<id>/workflows/` and records the
  project; the id is the clone's folder name, lowercased, made unique (`--id`
  picks one). Registering again prints the same project. A repository with
  `.ork/workflows/` or `.ork/project.yaml` is in-repo and is refused.
- **`ork init`** records the project at the current folder's git root as
  in-repo, then scaffolds `.ork/`; it refuses an attached project, so Ork never
  writes into it.
- **`ork projects [--json]`** lists registered projects: id, mode, root (marked
  missing when it is gone), and Ork's folder. **`ork projects forget <id>`**
  drops the record; the files and runs stay.
- The store keeps them in its `projects` table
  ([event store](./event-store.md)).

## Which project a folder is in

1. A folder inside an attached project's folder belongs to it.
2. Otherwise, the project at the folder's git root: the registered one, or an
   unregistered in-repo one (Ork works as before without registering).

Commands read the project of the workflow file (`validate`, `run`,
`context explain`, `chat`) or of the current folder (a workflow by name, `ps`,
`decide`, `link`, `doctor`, `agents`). A workflow is found by name in the
current folder's project's `workflows/`.

## An attached project's workflows

- **Paths** (skills, context) resolve as if the workflow were in
  `<root>/.ork/workflows/`, and stay inside the repository; `ork migrate` can
  move it there unchanged. `../../docs/process.md` is the repository's
  `docs/process.md`.
- **Runs** are recorded under the repository's root, like any run, and their
  folder is `~/.ork/projects/<id>/runs/<run>/`. A run started from anywhere
  works in the project: worktree nodes in worktrees beside the clone, the others
  at its root.
- **Rules** come from `~/.ork/projects/<id>/project.yaml`; problems are located
  as `~/.ork/projects/<id>/project.yaml:3:5`.
- **Agents** from the attached folder's `agents/` take the place of
  `.ork/agents`; the tools' folders in the repository are still read.
- **Not available:** `ork link` (nothing is linked into the repository) and its
  doctor checks.

## Migrating

`ork migrate` changes a project's layout and commits nothing: the result is left
in the working tree to review and commit
([ADR-036](../decisions/ADR-036-ork-migrate.md)).

- **`ork migrate`** moves an attached project's folder into `<root>/.ork/`, adds
  `.ork/runs/` to `.gitignore`, and records the project as in-repo; the store's
  runs of it point at their moved workflow files. An in-repo project has nothing
  to move.
- **`--agents`** also brings the agents and skills under `.ork/`
  ([agents/migrate.ts](../packages/core/src/agents/migrate.ts)): a tool folder
  that is a real folder, or a folder in the repository tool folders link to
  (`.ai/agents`), has its entries moved into `.ork/agents` or `.ork/skills` and
  becomes a link to it; every link to it then points at `.ork/`. Links leaving
  the repository and broken links are kept and listed.
- **The plan comes first.** It is shown, one line per move and link; a clash
  (something already where a file would go) or a live run of the project refuses
  it, and nothing moves. It asks before applying (`--yes` skips the question and
  is needed without a terminal); `--dry-run` only shows it. A folder is removed
  only once empty, and running it again plans what is left.
- **`--from-agents a,b [--reviewer r] [--name process]`** only drafts
  `workflows/<name>.ork.yaml` in the project's folder, never over a file, and
  validates it:

  | Node(s)            | What it does                                                                     |
  | ------------------ | -------------------------------------------------------------------------------- |
  | `a`, `b`, …        | a `claude.worker` per agent, in order, each in its worktree                      |
  | `ready`            | with a reviewer: a gate that sends the last agent's change to it                 |
  | the reviewer       | `readonly`, `session: resume`; `changes_requested` sends it back, `maxRounds: 3` |
  | `stage`            | `tool.git add -A` in the last agent's worktree                                   |
  | `approve`          | a gate showing the staged summary                                                |
  | `branch`, `commit` | `switch -c {{inputs.branch}}`, then `commit -m {{inputs.message}}`               |

  It takes the inputs `task`, `branch` and `message` and sets
  `rules.git.commit: never`: Ork commits nothing itself, and nothing is pushed.
  Agent names must be known (`ork agents list`) and cannot be the draft's own
  node ids.
