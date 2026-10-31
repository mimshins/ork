# ADR-035 — A project's files live in its repository or beside it, attached

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** projects / storage
- **RFC:** waived — the author chose "outside the repository" for projects that
  do not want Ork in them; the options are below
- **Builds on:** [ADR-024](./ADR-024-event-store.md) (one store for every
  project), [ADR-032](./ADR-032-project-rules.md) (project rules)

## Context

Ork kept everything for a project in its `.ork/`: workflows, `project.yaml`, run
folders, lessons and agents. se-backend has its own process and its own agent
tooling; the author's rule is that Ork must be able to run there "without side
effects", writing nothing into the repository, while a project that wants its
process reviewed like code keeps it in the repository.

## Decision

1. **Two modes, one layout.** A project is _in-repo_ (Ork's files in
   `<root>/.ork/`) or _attached_ (in `~/.ork/projects/<id>/`). Both folders hold
   the same things: `workflows/`, `project.yaml`, `runs/`, `lessons/`, `agents/`
   ([place.ts](../packages/core/src/project/place.ts)).
2. **`ork register [path] [--id]`** attaches a repository's main clone: it
   creates `~/.ork/projects/<id>/workflows/` and records the project, and writes
   nothing into the repository. A repository that already has `.ork/` workflows
   or rules stays in-repo. **`ork init`** records an in-repo project and refuses
   an attached one. **`ork projects`** lists them; `forget` drops a record and
   keeps the files.
3. **The store records projects** (migration 5, `projects`: id, root, mode,
   folder). A folder belongs to the attached project whose folder holds it, else
   to the project at its git root, registered or not; an unregistered project is
   in-repo, as before.
4. **An attached workflow reads the repository as if it were in
   `<root>/.ork/workflows/`.** Its skill and context paths resolve from there,
   so moving it into the repository (`ork migrate`) changes no path. Its runs,
   lessons and own agents are in the attached folder; its worktrees go beside
   the clone as always; a run started anywhere works in the project.

## Options considered

- **Attached only, outside every repository:** a project's process could not be
  reviewed like code. Rejected for two modes with one layout.
- **A marker file in the attached folder** naming the repository, instead of a
  store table: two sources of truth once the store lists projects for
  `ork projects` and the UI. Rejected; the store is already the one place every
  project's runs are.
- **Attached paths relative to the attached folder:** a workflow could not reach
  the repository's files without absolute paths, and moving it would break them.
  Rejected for the virtual `.ork/workflows/` folder.

## Rationale

The repository is the project's, not Ork's. Keeping one layout for both modes
makes the mode a matter of where a folder is, so every command works the same
way, and attaching then migrating is a move, not a rewrite.

## Consequences

- se-backend can be registered and run with nothing written into it; its rules
  (`commit: never`, its branch template) live in its attached `project.yaml`.
- Files kept in an attached folder other than its agents and lessons (a skill, a
  context file) cannot be referenced yet; they belong in the repository or the
  user's `~/.ork/` (gaps).
- `ork link` and its doctor checks do nothing for an attached project.
- `ork migrate` (planned) moves an attached project into `.ork/`.
