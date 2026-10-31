# Project rules

Ork does a few things on its own while a workflow runs: it commits each node's
work, merges a passing child into its owner, and names branches and worktrees.
Each of these is your project's choice. Write the rules once in
`.ork/project.yaml`, commit it, and every workflow in the project follows them.
The contract is in [project rules](../../specs/project-rules.md).

## The rules file

Every key is optional; leave one out and Ork does what it does by default.

```yaml
# .ork/project.yaml
schemaVersion: 1
git:
  commit: auto # or never
  merge: auto # or patch, or never
  base: HEAD # e.g. origin/main
  branch: "ork/{run}/{node}"
  worktrees: "../{clone}-worktrees/ork-{run}-{node}"
permissions:
  deny: ["Bash(git push *)"]
defaults:
  model: sonnet
context: [docs/process.md]
```

- **`permissions`** are tool rules every Claude node gets, added to its own
  `tools`.
- **`defaults`** apply to every workflow; a workflow's own `defaults` win.
- **`context`** files, from the project root, are read by every node, before the
  workflow's own.

Add
`# yaml-language-server: $schema=https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/project.schema.json`
at the top for autocomplete. `ork validate` checks the file with every workflow
and points at the line of a mistake.

## Never committing

Some projects let no one commit until a human and a reviewer approve. With
`commit: never`, Ork runs no `git commit` at all:

```yaml
git:
  commit: never
```

- Each worktree is created **detached**: there is no branch to clean up.
- A node's work stays uncommitted in its worktree. Its output has `worktree`
  (the folder) instead of `branch`, so a later node or a gate can say
  `{{nodes.builder.output.worktree}}`.
- A child starts from its owner's work, committed or not, and a passing child's
  changes are applied to its owner's worktree, uncommitted (`merge: patch`, the
  default here). If they do not apply cleanly, nothing changes, the files are
  named, and the child's worktree is kept.
- Sessions are told not to commit.

The run's result is the root node's worktree with its changes uncommitted, for
you (or a later commit step) to review and commit.

## Merging, or not

- **`merge: auto`**: a passing child's branch is merged into its owner's
  worktree (`--no-ff`). Needs commits.
- **`merge: patch`**: its changes are applied, uncommitted.
- **`merge: never`**: nothing is handed over; each child's worktree is kept.

## Your own branch and worktree names

```yaml
git:
  base: origin/main
  branch: "{inputs.type}/{inputs.slug}"
  worktrees: "../{clone}-worktrees/{inputs.type}-{inputs.slug}"
```

Templates take `{run}` (the run id), `{node}`, `{clone}` (your clone's folder
name) and `{inputs.<name>}`. Worktrees always go beside your clone, never inside
it. If a run can make more than one worktree, the names need `{node}`;
`ork validate` tells you. Without `{run}`, a second run stops while the first
one's branch exists: Ork never takes over a branch it did not create.

`base` must be a commit you have: Ork never fetches, so run `git fetch` first.

## A workflow's own rules

A workflow can override the project's under `rules:`:

```yaml
rules:
  git: { merge: never }
  permissions: { deny: ["Bash(rm *)"] }
```

Its `git` keys win; permissions add up.

## What never changes

Whatever the rules say, Ork never pushes, never takes over a branch it did not
create, and records every branch and worktree it makes.
[`ork worktrees`](./worktrees.md) lists and cleans exactly those, whatever they
are called.

## Sessions across rounds

Separately from git, a node can keep its session when it runs again in a loop:

```yaml
reviewer:
  type: claude.worker
  agent: reviewer
  session: resume # check its own earlier findings in each round
```

Leaders resume by default and workers start fresh; `session` changes either.
