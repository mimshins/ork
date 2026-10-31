# ADR-036 — `ork migrate`: move into the repository, never commit

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** projects / agents and skills
- **RFC:** waived — the author set the command's three jobs and that it commits
  nothing; the options are below
- **Builds on:** [ADR-031](./ADR-031-ork-is-the-origin.md) (`.ork/` is the
  origin), [ADR-035](./ADR-035-projects-in-repo-or-attached.md) (attached
  projects), [ADR-034](./ADR-034-tool-git.md) (`tool.git`)

## Context

A project can start attached, with Ork's files beside it, and later want its
process in the repository. A project such as se-backend keeps its agents and
skills in its own folder (`.ai/`) with every tool's folder linked to it;
`ork link` only creates links and keeps such a layout as it is (ADR-031), so
making `.ork/` the origin there is a migration, with its own command and
confirmation. And a project whose process lives in its agents (a documenter, an
implementer, a reviewer) needs a first workflow that runs that process with its
gates kept.

## Decision

1. **`ork migrate`** moves an attached project's folder into `<root>/.ork/` (its
   workflows, rules, runs, lessons and agents), adds `.ork/runs/` to
   `.gitignore`, and records the project as in-repo, with its runs' workflow
   files moved in the store too. An in-repo project has nothing to move.
2. **`--agents`** also brings the project's agents and skills under `.ork/`:
   each tool folder that is a real folder, or a folder in the repository that
   tool folders link to (`.ai/agents`), has its entries moved into `.ork/agents`
   or `.ork/skills` and becomes a link to it, and every link to it is pointed at
   `.ork/`. Links leaving the repository and broken links are kept and reported.
   The tools come from the layout registry, as for `ork link`.
3. **Plan, check, then move.** The whole plan is built first and shown. Any
   clash (something already where a file would go) or a live run of the project
   refuses it with nothing moved. It asks before applying (`--yes` to skip; it
   refuses without a terminal), and `--dry-run` only shows it. Files are moved,
   never copied over or deleted: a folder is only removed once empty.
4. **It commits nothing.** The moves, links and `.gitignore` entry are left in
   the working tree for the user to review and commit; running it again plans
   nothing.
5. **`--from-agents a,b [--reviewer r] [--name n]`** only drafts a workflow,
   `workflows/<n>.ork.yaml` in the project's folder (attached or in-repo), and
   validates it. The named agents work one after another, each a worker in its
   own worktree; with a reviewer, a human gate sends the last one's change to
   it, it resumes its session each round, and `changes_requested` sends the
   change back (`maxRounds: 3`); then `tool.git` stages the change, a second
   gate shows the staged summary, and the change is committed on a branch the
   run is given (`switch -c`, then `commit`). The draft sets
   `rules.git.commit: never`, so Ork itself commits nothing, and it never
   pushes.
6. **A readonly node follows its input through human gates** as well as control
   nodes (ADR-029), so a reviewer after a gate reads the change before it.

## Options considered

- **Copy instead of move:** keeps the old files working, but leaves two copies
  that drift, the problem ADR-031 removed. Rejected.
- **Commit the migration:** one step less, but Ork never commits on its own
  unless the project's rules say so; a migration touches the project's layout
  and is the user's to review. Rejected.
- **`git mv`:** stages the moves, which is half a commit. Rejected; git sees the
  renames when the user stages them.
- **Infer the draft's roles from agent names:** "reviewer" reviews. That is a
  policy about names; the user names the agents and the reviewer instead.
- **Draft into the repository always:** an attached project would gain a file.
  Rejected: the draft goes where the project's workflows are.

## Rationale

Moving with a checked plan keeps every file and every tool working through the
change: the links still lead to the same files, by way of `.ork/`. Leaving the
result uncommitted keeps the project's history the user's own. A drafted
workflow is a mechanism with the project's choices in it (which agents, which
reviewer, which branch), not a process Ork imposes.

## Consequences

- An attached project can move into its repository with one command, keeping its
  runs; `ork resume` finds a moved run's workflow.
- se-backend-style layouts (`.ai/` as the origin) become `.ork/`-origin layouts,
  with `.ai/agents` and `.ai/skills` as links, so existing paths keep working.
- A drafted workflow's agents each work in their own worktree; an earlier
  agent's files reach the last one only as reported artifacts
  ([gaps](../specs/gaps.md)).
- A move that fails halfway (a permission, a full disk) stops there: nothing is
  lost, and running `ork migrate` again plans what is left
  ([gaps](../specs/gaps.md)).
