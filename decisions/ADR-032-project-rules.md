# ADR-032 — Project rules: what Ork does on its own is the project's choice

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** projects / git, permissions
- **RFC:** waived — the author decided each choice directly; the options are
  below
- **Amends:** [ADR-020](./ADR-020-worktrees-beside-the-clone.md) (the `ork/`
  names become defaults; the safety rules stay)

## Context

Ork committed a node's work on `ork/<run>/<node>`, merged a passing child into
its owner with `--no-ff`, branched from `HEAD`, and named worktrees
`../<clone>-worktrees/ork-<run>-<node>`. Each of these is a policy, and real
projects have their own. se-backend's process says no one commits before a human
and then a reviewer approve; one task is one branch `<type>/<slug>` in
`../se-backend-worktrees/<type>-<slug>`, from `origin/main`. Ork could run none
of that. The author's rule: Ork is mechanism, the project is policy; a project
must be able to move its whole process into Ork.

## Decision

1. **A project's rules live in `.ork/project.yaml`**
   ([project.ts](../packages/schema/src/project.ts), published as
   `project.schema.json`): `git` (commit, merge, base, branch, worktrees),
   `permissions` (tool rules for every Claude node), `defaults`, and `context`
   files. Every key is optional; what is left out is Ork's behaviour before.
2. **A workflow overrides them** under its own `rules:`, key by key; its
   `defaults` and context win too, and permissions add up (the project's, the
   workflow's and the node's own). The project's rules are put under the
   workflow when it compiles
   ([rules.ts](../packages/core/src/project/rules.ts)), so every check and the
   run see the effective workflow.
3. **Git rules:**
   - `commit: never`: Ork runs no `git commit`. Worktrees are created detached,
     so no branch exists; a node's work stays uncommitted and its output carries
     its `worktree` path. A child starts from its owner's uncommitted work.
   - `merge: auto | patch | never`: a `--no-ff` merge (needs commits); the
     child's changes applied to its owner's worktree uncommitted, all or nothing
     (the default under `commit: never`); or no hand-over, each worktree kept.
     `merge: auto` with `commit: never` is an error.
   - `base`, `branch`, `worktrees`: templates over `{run}`, `{node}`, `{clone}`
     and `{inputs.<name>}`. `ork validate` checks the placeholders, requires
     `{node}` when a run can have more than one worktree, and warns without
     `{run}`. A worktree must land beside the clone, never inside it; a branch
     must be a valid name; the base must be a commit (Ork never fetches).
4. **Safety stays in Ork**, whatever the rules: it never pushes; it never takes
   over a branch its run did not create (an existing branch stops the node);
   every branch and worktree it creates is recorded in the run's events, and
   `ork worktrees` lists and cleans what the runs recorded, not what matches a
   prefix.

## Options considered

- **Rules only in workflows:** every workflow would repeat the same git rules,
  with no one place for a project's process. Rejected for a project file the
  workflow can override.
- **`commit: never` as shared checkouts only:** parallel writers would collide.
  Detached worktrees with patches keep them isolated without commits. Kept as an
  option (`isolation: shared`), not the only way.
- **Arbitrary branch names with the `ork/` prefix as the cleanup boundary:** a
  custom name would never be cleaned, or a project's own branch could be.
  Recording what Ork creates replaces the prefix.
- **A three-way patch apply** (`git apply --3way`): leaves conflict markers in
  the owner's worktree. Rejected for all-or-nothing, reported like a merge
  conflict.

## Rationale

Every side effect Ork has on a repository is someone's process. Making each one
a rule with today's behaviour as its default changes nothing for existing
projects, and lets a project with its own process (se-backend's "never commit")
run it in Ork without forking it. Safety is not a rule: what Ork may destroy or
publish stays fixed, so no project file can turn Ork against a repository's own
branches.

## Consequences

- se-backend's git process is expressible: `commit: never`, its branch and
  worktree templates, `base: origin/main`; an explicit commit step after the
  gates is a `tool.git` node ([ADR-034](./ADR-034-tool-git.md)).
- Under `commit: never`, Ork stages files in its own worktrees (`git add -A`) to
  see new ones in a patch; nothing is committed.
- Attached projects (rules outside the repo) come with `ork register`.
