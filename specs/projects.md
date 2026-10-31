# Projects: in the repository, or attached

Status: **Built**: places, `ork register`, `ork projects`, and `ork init`
recording an in-repo project ([place.ts](../packages/core/src/project/place.ts),
[register.ts](../packages/cli/src/project/register.ts),
[projects.ts](../packages/core/src/store/projects.ts),
[tests](../packages/cli/test/projects.test.ts),
[core tests](../packages/core/test/projects.test.ts)). `ork migrate`, from
attached to in-repo, is planned. Why:
[ADR-035](../decisions/ADR-035-projects-in-repo-or-attached.md).

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
